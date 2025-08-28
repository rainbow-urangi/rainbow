// content.js — 최종값만 수집(디바운스) + 라벨/식별자 강화

// ── CSS/XPath ───────────────────────────────────────────
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

// ── 라벨/타입/식별자(강화) ────────────────────────────────
function getInputType(el) {
  if (el.tagName === "TEXTAREA") return "textarea";
  if (el.tagName === "SELECT") return "select";
  return (el.getAttribute("type") || "text").toLowerCase();
}
function textOf(node) {
  return (node?.textContent || "").replace(/\s+/g, " ").trim() || null;
}
function getLabel(el) {
  // 1) 연결된 <label>
  if (el.labels && el.labels.length) {
    const t = textOf(el.labels[0]);
    if (t) return t;
  }
  if (el.id) {
    const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const t = textOf(byFor);
    if (t) return t;
  }
  // 2) aria*
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  const ariaIds = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  if (ariaIds.length) {
    const joined = ariaIds.map(id => textOf(document.getElementById(id))).filter(Boolean).join(" ");
    if (joined) return joined;
  }
  // 3) placeholder/title
  const ph = el.getAttribute("placeholder"); if (ph?.trim()) return ph.trim();
  const title = el.getAttribute("title"); if (title?.trim()) return title.trim();
  // 4) 테이블/그리드형: 같은 행의 선행 셀 텍스트
  const td = el.closest("td,th,div,li");
  const prev = td?.previousElementSibling;
  const prevText = textOf(prev);
  if (prevText) return prevText;
  // 5) form-group 류 래퍼에서 label/span 찾기
  const group = el.closest(".form-group,.field,.form-item,.row,.control-group");
  if (group) {
    const cand = group.querySelector("label,.label,.control-label,.field-label,.title");
    const t = textOf(cand);
    if (t) return t;
  }
  return null;
}

// 36자 이하 UID (id/name/aria/placeholder 우선, 없거나 길면 해시)
function fnv1aHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
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
  return "h-" + fnv1aHex(src); // ≤ 10자, 전체 "h-xxxxxxxx" 형태
}

// ── 큐 & 전송 ─────────────────────────────────────────────
let QUEUE = [];
const MAX_QUEUE = 40;
const FLUSH_MS = 5000;

function record(el, action, value, extra={}) {
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
function flush(reason="interval") {
  if (!QUEUE.length) return;
  const batch = { reason, events: QUEUE.splice(0, QUEUE.length) };
  chrome.runtime.sendMessage({ type: "BATCH_EVENTS", payload: batch }).catch(()=>{});
}

// ── 이벤트: “최종값만” 수집 (디바운스 + blur/submit 플러시) ──
const INPUTS = "input, textarea";
const INPUT_LIKE = "input, textarea, select";
const DEBOUNCE_MS = 600;
const timers = new WeakMap();

function scheduleFinalRecord(t) {
  clearTimeout(timers.get(t));
  timers.set(t, setTimeout(() => {
    record(t, "change", t.value); // 최종값으로 1회만
  }, DEBOUNCE_MS));
}

// 타이핑 중간값은 안 보냄. 멈추면 change 1회만 전송.
addEventListener("input", (e) => {
  const t = e.target?.closest(INPUTS);
  if (!t) return;
  scheduleFinalRecord(t);
}, true);

// 포커스 잃을 때 즉시 전송
addEventListener("blur", (e) => {
  const t = e.target?.closest(INPUTS);
  if (!t) return;
  clearTimeout(timers.get(t));
  record(t, "change", t.value);
}, true);

// select 박스는 change 자체가 최종
addEventListener("change", (e) => {
  const t = e.target?.closest("select");
  if (!t) return;
  const opt = t.selectedOptions?.[0];
  record(t, "change", t.value, { selectedText: opt?.text });
}, true);

// Enter로 폼 제출하는 케이스 커버
addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const t = e.target?.closest(INPUTS);
  if (!t) return;
  clearTimeout(timers.get(t));
  record(t, "change", t.value);
}, true);

// 주기/가시성/요청 플러시
setInterval(() => flush("interval"), FLUSH_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush("hidden");
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "FLUSH_REQUEST") flush("request");
});
