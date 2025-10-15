// content.js — 입력 "최종값" + 메뉴/액션 정보 풍부 수집 + SPA 라우팅 포착

// ── Polyfill ──────────────────────────────────────────────
(function ensureCssEscape() {
  if (typeof CSS === "undefined") { window.CSS = {}; }
  if (typeof CSS.escape !== "function") {
    CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_\-]/g, ch => `\\${ch}`);
  }
})();

// ── CSS/XPath ─────────────────────────────────────────────
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

// ── 공통 유틸 ─────────────────────────────────────────────
function textOf(node) {
  return (node?.textContent || "").replace(/\s+/g, " ").trim() || null;
}
function fnv1aHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function now() { return Date.now(); }
function pickDataAttrs(el, limit=20) {
  if (!el?.attributes) return {};
  const out = {};
  let n = 0;
  for (const attr of el.attributes) {
    if (attr.name.startsWith("data-")) {
      out[attr.name] = String(attr.value).slice(0, 200);
      if (++n >= limit) break;
    }
  }
  return out;
}
function bounding(el) {
  try { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }
  catch { return null; }
}

// ── 민감정보 마스킹(입력값) ───────────────────────────────
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

// ── 라벨/타입/식별자(입력) ────────────────────────────────
function getInputType(el) {
  if (el.tagName === "TEXTAREA") return "textarea";
  if (el.tagName === "SELECT") return "select";
  return (el.getAttribute("type") || "text").toLowerCase();
}
function getLabel(el) {
  if (el.labels && el.labels.length) { const t = textOf(el.labels[0]); if (t) return t; }
  if (el.id) {
    const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const t = textOf(byFor); if (t) return t;
  }
  const aria = el.getAttribute("aria-label"); if (aria?.trim()) return aria.trim();
  const ariaIds = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  if (ariaIds.length) {
    const joined = ariaIds.map(id => textOf(document.getElementById(id))).filter(Boolean).join(" ");
    if (joined) return joined;
  }
  const ph = el.getAttribute("placeholder"); if (ph?.trim()) return ph.trim();
  const title = el.getAttribute("title"); if (title?.trim()) return title.trim();
  const td = el.closest("td,th,div,li"); const prev = td?.previousElementSibling;
  const prevText = textOf(prev); if (prevText) return prevText;
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
  return "h-" + fnv1aHex(src);
}

// ── 큐 & 전송 ─────────────────────────────────────────────
let QUEUE = [];
const MAX_QUEUE = 40;
const FLUSH_MS = 5000;

function sendBatch(reason, events) {
  chrome.runtime.sendMessage({ type: "BATCH_EVENTS", payload: { reason, events } }).catch(()=>{});
}
function flush(reason="interval") {
  if (!QUEUE.length) return;
  const batch = QUEUE.splice(0, QUEUE.length);
  sendBatch(reason, batch);
}

// ── 입력: “최종값만” 수집 ────────────────────────────────
const INPUTS = "input, textarea";
const DEBOUNCE_MS = 600;
const timers = new WeakMap();

function scheduleFinalRecord(t) {
  clearTimeout(timers.get(t));
  timers.set(t, setTimeout(() => {
    recordInput(t, "change", t.value);
  }, DEBOUNCE_MS));
}
function recordInput(el, action, value, extra={}) {
  const css = cssPath(el), xp = xPath(el);
  QUEUE.push({
    url: location.href,
    timestamp: now(),
    action,
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
  });
  if (QUEUE.length >= MAX_QUEUE) flush("max");
}
addEventListener("input", (e) => { const t=e.target?.closest(INPUTS); if (t) scheduleFinalRecord(t); }, true);
addEventListener("blur",  (e) => { const t=e.target?.closest(INPUTS); if (!t) return; clearTimeout(timers.get(t)); recordInput(t,"change",t.value); }, true);
addEventListener("change",(e) => { const t=e.target?.closest("select"); if (!t) return; const opt=t.selectedOptions?.[0]; recordInput(t,"change",t.value,{selectedText:opt?.text}); }, true);
addEventListener("keydown",(e) => { if (e.key!=="Enter") return; const t=e.target?.closest(INPUTS); if (!t) return; clearTimeout(timers.get(t)); recordInput(t, "change", t.value); }, true);

// ── SPA 라우팅(p/a) 포착 ──────────────────────────────────
(function hookHistory(){
  function emitRoute(from, to) {
    sendBatch("route-change", [{
      url: to, timestamp: now(), action: "route_change",
      selector: { css: null, xpath: null }, tagName: "ROUTE",
      data: { from, to, title: document.title }
    }]);
  }
  const wrap = (name) => {
    const orig = history[name];
    history[name] = function(...args){
      const from = location.href;
      const ret = orig.apply(this, args);
      setTimeout(()=>{ const to = location.href; if (to!==from) emitRoute(from,to); }, 0);
      return ret;
    };
  };
  wrap("pushState"); wrap("replaceState");
  addEventListener("popstate", () => emitRoute("(popstate)", location.href));
})();

// ── 메뉴 수집 (좌측 내비 + 헤더/빵크럼/CTA 포함, 풍부 메타데이터) ───────────
const NAV_ROOT_SELECTOR = [
  "nav", "[role='navigation']", "aside",
  ".snb", ".lnb", ".sidebar", ".side", ".left-menu", ".menu-wrap", ".navigation",
  "[data-menu-root]"
].join(",");
const MENU_ITEM_SELECTOR = `
  a[href],
  [role="menuitem"],
  [role="treeitem"],
  button,[role="button"],
  .el-menu-item,.ant-menu-item,
  [data-az-menu]
`.replace(/\s+/g," ");

const MENU_DEDUP = new WeakMap();
function shouldRecord(el){ const n=now(), p=MENU_DEDUP.get(el)||0; MENU_DEDUP.set(el,n); return (n-p)>400; }
function isLeftNavBox(root) {
  try {
    const r = root.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0) || 1024;
    return r.left < vw * 0.25 && r.width < Math.min(420, vw * 0.4);
  } catch { return false; }
}
function findNavRoot(el){ return el?.closest(NAV_ROOT_SELECTOR) || null; }
function leafLabel(item){ const a=item.matches("a[href]")?item:item.querySelector("a[href]"); return textOf(a||item); }
function sectionLabel(navRoot, item) {
  if (!navRoot) return null;
  let li=item.closest("li"), topLi=null;
  while (li && navRoot.contains(li)) { topLi=li; li=li.parentElement?.closest?.("li")||null; }
  if (topLi) {
    const header = topLi.querySelector(":scope > a,:scope > button,:scope > [role='menuitem'],:scope > [role='treeitem'],:scope > .label,:scope > span,:scope > strong");
    const tx = textOf(header) || textOf(topLi); if (tx) return tx;
  }
  const navLabel = navRoot.getAttribute("aria-label") || textOf(navRoot.querySelector("h1,h2,h3,.menu-title,.title,[role='heading']"));
  return navLabel || null;
}
function isLeafMenu(item) {
  const li = item.closest("li");
  const href = (item.getAttribute("href")||"").trim();
  const hasSub = !!(li && li.querySelector(":scope > ul, :scope > ol"));
  const toggler = !href || href==="#" || href.startsWith("javascript:");
  return !(hasSub && toggler);
}
function menuIdentifier(el){
  if (el.id) return `#${el.id}`;
  const name=el.getAttribute("name"); if (name) return `name=${name}`;
  const aria=el.getAttribute("aria-label"); if (aria) return `aria-label=${aria}`;
  const dt=el.getAttribute("data-testid"); if (dt) return `data-testid=${dt}`;
  const key=el.getAttribute("data-az-key"); if (key) return `data-az-key=${key}`;
  const href=el.getAttribute("href"); if (href) return `href=${href}`;
  const raw=(el.outerHTML||el.className||"")+"|"+location.pathname;
  return "m-"+fnv1aHex(raw);
}
function menuTrailFrom(el){
  const trail=[]; let cur=el;
  while (cur && cur!==document.body) {
    if (["LI","A","BUTTON","DIV","SPAN","P"].includes(cur.tagName)) {
      const t=textOf(cur); if (t && !trail.includes(t)) trail.unshift(t);
    }
    if (cur.matches("nav,[role='menubar'],[role='navigation'],aside")) break;
    cur=cur.parentElement;
  }
  return trail.slice(-5);
}

function recordMenu(el, kind="auto") {
  const navRoot = findNavRoot(el);
  const leftNav = navRoot && isLeftNavBox(navRoot);
  if (navRoot && !isLeafMenu(el)) return; // 토글 제외

  const css = cssPath(el), xp = xPath(el);
  const href = el.getAttribute("href") || el.getAttribute("data-href") || null;

  const trail = menuTrailFrom(el);
  const group = leftNav ? sectionLabel(navRoot, el) : null;
  const leaf  = leafLabel(el);
  const label = [group, leaf].filter(Boolean).join(" > ") || leaf || group || null;

  const meta = {
    identifier: menuIdentifier(el),
    label,
    href,
    role: el.getAttribute("role") || null,
    ariaLabel: el.getAttribute("aria-label") || null,
    dataset: pickDataAttrs(el),
    className: el.className || null,
    tagName: el.tagName,
    menuTrail: trail,
    kind: leftNav ? "left_nav" : kind,   // left_nav / header / breadcrumb / cta / auto ...
    bounds: bounding(el),
    indexInParent: (function(){ try{ return Array.from(el.parentElement?.children||[]).indexOf(el);}catch{return -1;}})(),
    pageContext: {
      title: document.title,
      path: location.pathname,
      search: location.search
    }
  };

  // Service Worker에서 풍부 로그도 보이도록 event.data.meta로 보냄
  sendBatch("menu-click", [{
    url: location.href,
    timestamp: now(),
    action: "menu_click",
    selector: { css, xpath: xp },
    tagName: el.tagName,
    data: meta
  }]);
}

addEventListener("click", (e) => {
  const el = e.target?.closest(MENU_ITEM_SELECTOR);
  if (!el) return;
  if (!shouldRecord(el)) return;
  recordMenu(el, "auto");
}, true);

// ── 프론트 보조 훅(원하면 호출): window.dispatchEvent(new CustomEvent('az:menu', {detail:{...}}))
window.addEventListener("az:menu", (ev) => {
  const d = ev?.detail || {};
  const fake = document.createElement("a");
  if (d.href) fake.setAttribute("href", d.href);
  if (d["data-az-key"]) fake.setAttribute("data-az-key", d["data-az-key"]);
  if (d.role) fake.setAttribute("role", d.role);
  fake.textContent = d.label || d.text || "";
  document.body.appendChild(fake); // for css/xpath path origination (optional)
  try {
    recordMenu(fake, d.kind || "custom");
  } finally {
    fake.remove();
  }
});

// ── 주기/가시성/요청 플러시 ───────────────────────────────
setInterval(() => flush("interval"), FLUSH_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush("hidden"); });
chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === "FLUSH_REQUEST") flush("request"); });
