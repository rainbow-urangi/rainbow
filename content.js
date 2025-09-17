// content.js — 입력 "최종값" + 메뉴 클릭 수집 + 라벨/식별자 강화

// ── CSS.escape 폴리필(일부 환경 대비) ─────────────────────
(function ensureCssEscape() {
  if (typeof CSS === "undefined") { window.CSS = {}; }
  if (typeof CSS.escape !== "function") {
    CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_\-]/g, ch => `\\${ch}`);
  }
})();

// ── CSS/XPath 생성기 ───────────────────────────────────────
function cssPath(el) {
  if (!(el instanceof Element)) return "";
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  while (el && el.nodeType === 1 && parts.length < 8) {
    let part = el.nodeName.toLowerCase();
    if (el.classList.length) part += "." + [...el.classList].map(c => CSS.escape(c)).join(".");
    const siblings = [...(el.parentNode?.children || [])].filter(n => n.nodeName === el.nodeName);
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(el)+1})`;
    parts.unshift(part);
    el = el.parentElement;
  }
  return parts.join(" > ");
}
function xPath(el) {
  if (!(el instanceof Element)) return "";
  if (el.id) return `//*[@id="${el.id}"]`;
  const segs = [];
  for (; el && el.nodeType === 1; el = el.parentNode) {
    let i = 1;
    for (let sib = el.previousSibling; sib; sib = sib.previousSibling)
      if (sib.nodeType === 1 && sib.nodeName === el.nodeName) i++;
    segs.unshift(`${el.nodeName.toLowerCase()}[${i}]`);
  }
  return "/" + segs.join("/");
}

// ── 공통 유틸 ──────────────────────────────────────────────
function textOf(node) {
  return (node?.textContent || "").replace(/\s+/g, " ").trim() || null;
}
function fnv1aHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── 민감정보 마스킹 ───────────────────────────────────────
function maskValue(el, v) {
  const type = (el.getAttribute("type") || "").toLowerCase();
  const name = (el.getAttribute("name") || "").toLowerCase();
  if (type === "password") return "*****";
  if (/pass|pwd|ssn|card|credit|주민|비번/i.test(name)) return "*****";
  if (typeof v === "string" && v.includes("@")) {
    const [id, dom] = v.split("@");
    return (id?.slice(0,2) || "*") + "***@" + (dom?.split(".")[0]?.[0] || "*") + "***";
  }
  return v;
}

// ── 입력 라벨/타입/식별자 ─────────────────────────────────
function getInputType(el) {
  if (el.tagName === "TEXTAREA") return "textarea";
  if (el.tagName === "SELECT") return "select";
  return (el.getAttribute("type") || "text").toLowerCase();
}
function getLabel(el) {
  // 1) 연결된 <label>
  if (el.labels && el.labels.length) {
    const t = textOf(el.labels[0]); if (t) return t;
  }
  if (el.id) {
    const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const t = textOf(byFor); if (t) return t;
  }
  // 2) aria*
  const aria = el.getAttribute("aria-label"); if (aria?.trim()) return aria.trim();
  const ariaIds = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  if (ariaIds.length) {
    const joined = ariaIds.map(id => textOf(document.getElementById(id))).filter(Boolean).join(" ");
    if (joined) return joined;
  }
  // 3) placeholder/title
  const ph = el.getAttribute("placeholder"); if (ph?.trim()) return ph.trim();
  const title = el.getAttribute("title"); if (title?.trim()) return title.trim();
  // 4) 테이블/그리드 인접 셀
  const td = el.closest("td,th,div,li");
  const prev = td?.previousElementSibling;
  const prevText = textOf(prev); if (prevText) return prevText;
  // 5) form-group 류
  const group = el.closest(".form-group,.field,.form-item,.row,.control-group");
  if (group) {
    const cand = group.querySelector("label,.label,.control-label,.field-label,.title");
    const t = textOf(cand); if (t) return t;
  }
  return null;
}
function bestIdentifierRaw(el) {
  if (el.id) return `#${el.id}`;
  const name = el.getAttribute("name"); if (name) return `name=${name}`;
  const aria = el.getAttribute("aria-label"); if (aria) return `aria-label=${aria}`;
  const ph = el.getAttribute("placeholder"); if (ph) return `placeholder=${ph}`;
  const dt = el.getAttribute("data-testid"); if (dt) return `data-testid=${dt}`;
  return null;
}
function getIdentifier(el, cssSel, xpSel) {
  const cand = bestIdentifierRaw(el);
  if (cand && cand.length <= 36) return cand;
  const src = (cand || cssSel || xpSel || "") + "|" + location.host + "|" + el.tagName + "|" + getInputType(el);
  return "h-" + fnv1aHex(src); // ≤ 10자 해시 접두
}

// ── 큐 & 전송 ─────────────────────────────────────────────
let QUEUE = [];
const MAX_QUEUE = 40;
const FLUSH_MS = 5000;

function record(el, action, value, extra = {}) {
  const css = cssPath(el);
  const xp  = xPath(el);
  const rec = {
    url: location.href,
    timestamp: Date.now(),
    action, // "change" 위주(최종값)
    selector: { css, xpath: xp },
    tagName: el.tagName,
    data: {
      value: value != null ? maskValue(el, value) : undefined,
      inputType: getInputType(el),
      label: getLabel(el),
      identifier: getIdentifier(el, css, xp),
      attributes: {
        type: el.getAttribute("type") || undefined,
        name: el.getAttribute("name") || undefined,
        id: el.id || undefined,
        class: el.className || undefined
      },
      ...extra
    }
  };
  QUEUE.push(rec);
  if (QUEUE.length >= MAX_QUEUE) flush("max");
}
function flush(reason = "interval") {
  if (!QUEUE.length) return;
  const batch = { reason, events: QUEUE.splice(0, QUEUE.length) };
  chrome.runtime.sendMessage({ type: "BATCH_EVENTS", payload: batch }).catch(() => {});
}

// ── 입력: “최종값만” 수집(디바운스 + blur/enter/select) ──
const INPUTS = "input, textarea";
const DEBOUNCE_MS = 600;
const timers = new WeakMap();

function scheduleFinalRecord(t) {
  clearTimeout(timers.get(t));
  timers.set(t, setTimeout(() => record(t, "change", t.value), DEBOUNCE_MS));
}

addEventListener("input", (e) => {
  const t = e.target?.closest(INPUTS);
  if (!t) return;
  scheduleFinalRecord(t);
}, true);

addEventListener("blur", (e) => {
  const t = e.target?.closest(INPUTS);
  if (!t) return;
  clearTimeout(timers.get(t));
  record(t, "change", t.value);
}, true);

addEventListener("change", (e) => {
  const t = e.target?.closest("select");
  if (!t) return;
  const opt = t.selectedOptions?.[0];
  record(t, "change", t.value, { selectedText: opt?.text });
}, true);

addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const t = e.target?.closest(INPUTS);
  if (!t) return;
  clearTimeout(timers.get(t));
  record(t, "change", t.value);
}, true);

// ── 메뉴 클릭 수집(프론트 수정 없이) ─────────────────────
const MENU_SELECTOR = `
  a[href],
  [role="menuitem"],
  nav *[data-menu],
  [data-testid*="menu"],
  [aria-haspopup="menu"],
  button,
  [role="button"]
`.replace(/\s+/g, " ");

function getMenuLabel(el) {
  const aria = el.getAttribute("aria-label"); if (aria?.trim()) return aria.trim();
  const title = el.getAttribute("title"); if (title?.trim()) return title.trim();
  const txt = textOf(el); if (txt) return txt;
  const svgTitle = el.querySelector("svg title"); const svgt = textOf(svgTitle); if (svgt) return svgt;
  return null;
}
function getMenuTrail(el) {
  const trail = []; let cur = el;
  while (cur && cur !== document.body) {
    if (["LI","A","BUTTON","DIV","SPAN","P"].includes(cur.tagName)) {
      const t = textOf(cur); if (t && !trail.includes(t)) trail.unshift(t);
    }
    if (cur.matches("nav, [role='menubar'], [role='navigation']")) break;
    cur = cur.parentElement;
  }
  return trail.slice(-4);
}
function getMenuIdentifier(el) {
  if (el.id) return `#${el.id}`;
  const name = el.getAttribute("name"); if (name) return `name=${name}`;
  const aria = el.getAttribute("aria-label"); if (aria) return `aria-label=${aria}`;
  const dt = el.getAttribute("data-testid"); if (dt) return `data-testid=${dt}`;
  const href = el.getAttribute("href"); if (href) return `href=${href}`;
  const raw = (el.outerHTML || el.className || "") + "|" + location.pathname;
  return "m-" + fnv1aHex(raw);
}
const MENU_DEDUP = new WeakMap();
function shouldRecordMenu(el) {
  const now = Date.now();
  const last = MENU_DEDUP.get(el) || 0;
  MENU_DEDUP.set(el, now);
  return (now - last) > 500;
}

addEventListener("click", (e) => {
  const el = e.target?.closest(MENU_SELECTOR);
  if (!el) return;

  const href = el.getAttribute("href");
  if (href && /^#?$/.test(href.trim())) return; // 빈 해시 제외
  if (!shouldRecordMenu(el)) return;

  const payload = {
    url: location.href,
    timestamp: Date.now(),
    action: "menu_click",
    selector: { css: cssPath(el), xpath: xPath(el) },
    tagName: el.tagName,
    data: {
      identifier: getMenuIdentifier(el),
      label: getMenuLabel(el),
      href: href || null,
      role: el.getAttribute("role") || null,
      menuTrail: getMenuTrail(el)
    }
  };

  // 메뉴 클릭은 즉시 전송(단건)
  chrome.runtime.sendMessage({
    type: "BATCH_EVENTS",
    payload: { reason: "menu-click", events: [payload] }
  }).catch(() => {});
}, true);

// ── 주기/가시성/요청 플러시 ───────────────────────────────
setInterval(() => flush("interval"), FLUSH_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush("hidden");
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "FLUSH_REQUEST") flush("request");
});
