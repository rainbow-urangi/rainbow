// ── 간단한 CSS/XPath 생성기 ───────────────────────────────
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
  const isPwd = type === "password";
  const mayPII = /pass|pwd|ssn|card|credit|주민|비번/i.test(name);
  if (isPwd || mayPII) return "*****";
  if (typeof v === "string" && v.includes("@")) {
    const [id, dom] = v.split("@");
    return (id?.slice(0,2) || "*") + "***@" + (dom?.split(".")[0]?.[0] || "*") + "***";
  }
  return v;
}

// ── 큐 & 전송 ─────────────────────────────────────────────
let QUEUE = [];
const MAX_QUEUE = 40;
const FLUSH_MS = 5000;

function record(el, action, value, extra={}) {
  const rec = {
    url: location.href,
    timestamp: Date.now(),
    action,
    selector: { css: cssPath(el), xpath: xPath(el) },
    tagName: el.tagName,
    data: {
      value: value != null ? maskValue(el, value) : undefined,
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

// ── 이벤트 바인딩 (MVP: click/input/change) ─────────────
const inputSel = "input, textarea, select, button";

addEventListener("click", (e) => {
  const t = e.target?.closest(inputSel);
  if (t) record(t, "click");
}, true);

addEventListener("input", (e) => {
  const t = e.target?.closest("input, textarea");
  if (t) record(t, "input", t.value);
}, true);

addEventListener("change", (e) => {
  const t = e.target?.closest("input, textarea, select");
  if (!t) return;
  if (t.tagName === "SELECT") {
    const opt = t.selectedOptions?.[0];
    record(t, "change", t.value, { selectedText: opt?.text });
  } else {
    record(t, "change", t.value);
  }
}, true);

// ── 주기/가시성/요청 트리거 플러시 ───────────────────────
setInterval(() => flush("interval"), FLUSH_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush("hidden");
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "FLUSH_REQUEST") flush("request");
});
