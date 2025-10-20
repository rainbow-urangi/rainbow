// content.js — Robust capture for Selenium replay
// (입력 최종값/메뉴/라우팅/페이지뷰 + 로케이터/컨텍스트/후행신호/프레임/섀도우)

// ---- CSS.escape 폴리필 ----
(function ensureCssEscape(){
  if (typeof CSS === "undefined") window.CSS = {};
  if (typeof CSS.escape !== "function") {
    CSS.escape = (s)=> String(s).replace(/[^a-zA-Z0-9_\-]/g, ch => `\\${ch}`);
  }
})();

// ---- 공용 유틸 ----
const now = ()=> Date.now();
const textOf = (n)=> (n?.textContent || "").replace(/\s+/g," ").trim() || null;

function cssPath(el){
  if (!(el instanceof Element)) return "";
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts=[];
  while (el && el.nodeType === 1 && parts.length < 8) {
    let part = el.nodeName.toLowerCase();
    if (el.classList.length) part += "." + [...el.classList].map(CSS.escape).join(".");
    const sib=[...(el.parentNode?.children||[])].filter(x=>x.nodeName===el.nodeName);
    if (sib.length > 1) part += `:nth-of-type(${sib.indexOf(el)+1})`;
    parts.unshift(part); el = el.parentElement;
  }
  return parts.join(" > ");
}
function xPath(el){
  if (!(el instanceof Element)) return "";
  if (el.id) return `//*[@id="${el.id}"]`;
  const segs=[];
  for (; el && el.nodeType === 1; el = el.parentNode){
    let i=1;
    for(let s=el.previousSibling; s; s=s.previousSibling)
      if(s.nodeType===1 && s.nodeName===el.nodeName) i++;
    segs.unshift(`${el.nodeName.toLowerCase()}[${i}]`);
  }
  return "/"+segs.join("/");
}
function datasetAttrs(el, prefix='data-'){
  const out={}; if(!el?.attributes) return out;
  for (const a of el.attributes) if (a.name.startsWith(prefix)) out[a.name] = String(a.value).slice(0,200);
  return out;
}
function formContext(el){
  const f = el?.closest?.('form');
  return f ? { selector: cssPath(f), id: f.id||null, name: f.getAttribute('name')||null, action: f.getAttribute('action')||null } : null;
}
function bounding(el){
  try{
    const r = el.getBoundingClientRect();
    return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) };
  }catch{ return null; }
}
function getShadowPath(el){
  const chain=[];
  let node = el;
  while (node) {
    const root = node.getRootNode?.();
    if (root && root.host) { chain.unshift(cssPath(root.host)); node = root.host; }
    else node = node.parentElement;
  }
  return chain;
}
function getFramePath(win){
  try{
    const chain=[]; let w=win;
    while (w && w.frameElement) { chain.unshift(cssPath(w.frameElement)); w = w.parent; }
    return chain;
  }catch{ return []; }
}

// ---- 민감정보 마스킹 ----
function maskValue(el, v){
  const type=(el.getAttribute('type')||"").toLowerCase();
  const name=(el.getAttribute('name')||"").toLowerCase();
  if (type==="password" || /pass|pwd|ssn|card|credit|주민|비번/i.test(name)) return "*****";
  if (typeof v === "string" && v.includes("@")){
    const [id, dom] = v.split("@"); return (id?.slice(0,2)||"*")+"***@"+(dom?.split(".")[0]?.[0]||"*")+"***";
  }
  return v;
}

// ---- 배치 큐 ----
let QUEUE=[]; const MAX_QUEUE=40; const FLUSH_MS=5000;

function record(el, action, value, extra={}){
  const css=el?cssPath(el):null, xp=el?xPath(el):null;
  const rec={
    url: location.href,
    timestamp: now(),
    action,
    selector: { css, xpath: xp },
    tagName: el?.tagName || null,
    data: {
      value: value!=null && el ? maskValue(el, value) : (value ?? undefined),
      attributes: {
        type: el?.getAttribute('type') || undefined,
        name: el?.getAttribute('name') || undefined,
        id: el?.id || undefined,
        class: el?.className || undefined
      },
      a11y: {
        role: el?.getAttribute?.('role') || null,
        ariaLabel: el?.getAttribute?.('aria-label') || null,
        ariaLabelledby: el?.getAttribute?.('aria-labelledby') || null
      },
      testids: el ? datasetAttrs(el) : {},
      form: el ? formContext(el) : null,
      shadowPath: el ? getShadowPath(el) : [],
      framePath: getFramePath(window),
      bounds: el ? bounding(el) : null,
      ...extra
    }
  };
  QUEUE.push(rec);
  if (QUEUE.length >= MAX_QUEUE) flush("max");
}
function flush(reason="interval"){
  if (!QUEUE.length) return;
  const batch = { reason, events: QUEUE.splice(0, QUEUE.length) };
  try{ chrome.runtime.sendMessage({ type:"BATCH_EVENTS", payload: batch }); }catch{}
}

// ---- 입력: 최종값만 ----
const INPUTS = "input, textarea";
const DEBOUNCE_MS = 600;
const timers = new WeakMap();

function scheduleFinalRecord(t){
  clearTimeout(timers.get(t));
  timers.set(t, setTimeout(()=>{
    record(t, "change", t.value);
  }, DEBOUNCE_MS));
}
addEventListener("input",(e)=>{ const t=e.target?.closest(INPUTS); if(t) scheduleFinalRecord(t); },true);
addEventListener("blur",(e)=>{ const t=e.target?.closest(INPUTS); if(!t) return; clearTimeout(timers.get(t)); record(t,"change",t.value); },true);
addEventListener("keydown",(e)=>{ if(e.key!=="Enter") return; const t=e.target?.closest(INPUTS); if(!t) return; clearTimeout(timers.get(t)); record(t,"change",t.value); },true);
addEventListener("change",(e)=>{ const t=e.target?.closest("select"); if(!t) return; const opt=t.selectedOptions?.[0]; record(t,"change",t.value,{ selectedText: opt?.text||null }); },true);

// ---- 메뉴 클릭 ----
const NAV_ROOT_SELECTOR = 'nav,[role="navigation"],aside,.sidebar,.menu,.navigation';
const MENU_ITEM_SELECTOR = 'a[href], [role="menuitem"], [role="treeitem"], button, [role="button"], .el-menu-item, .ant-menu-item, [data-az-menu]';
const MENU_DEDUP=new WeakMap();
function shouldRecord(el){ const n=now(), p=MENU_DEDUP.get(el)||0; MENU_DEDUP.set(el,n); return (n-p)>400; }
function navRootOf(el){ return el?.closest(NAV_ROOT_SELECTOR) || null; }
function liTrail(el, root){
  const trail=[]; let cur=el.closest('li,[role="menuitem"],[role="treeitem"],a,button');
  while (cur && (!root || root.contains(cur))){
    const t=textOf(cur); if (t && !trail.includes(t)) trail.unshift(t);
    cur = cur.parentElement?.closest?.('li,[role="menuitem"],[role="treeitem"]') || null;
  }
  return trail.slice(-5);
}
addEventListener("click",(e)=>{
  const el = e.target?.closest(MENU_ITEM_SELECTOR);
  if (!el || !shouldRecord(el)) return;
  const root = navRootOf(el);
  const payload = {
    identifier: (el.id?`#${el.id}`:null) || (el.getAttribute('name')?`name=${el.getAttribute('name')}`:null) || (el.getAttribute('data-testid')?`data-testid=${el.getAttribute('data-testid')}`:null) || (el.getAttribute('aria-label')?`aria-label=${el.getAttribute('aria-label')}`:null) || (el.getAttribute('href')?`href=${el.getAttribute('href')}`:null),
    label: textOf(el),
    href: el.getAttribute('href')||null,
    role: el.getAttribute('role')||null,
    navRoot: root ? cssPath(root) : null,
    liTrail: liTrail(el, root),
    dataset: datasetAttrs(el),
    className: el.className||null,
    bounds: bounding(el)
  };
  chrome.runtime.sendMessage({ type:"BATCH_EVENTS", payload:{ reason:"menu-click", events:[{
    url: location.href,
    timestamp: now(),
    action: "menu_click",
    selector: { css: cssPath(el), xpath: xPath(el) },
    tagName: el.tagName,
    data: payload
  }] }});
}, true);

// ---- 라우팅/페이지뷰 ----
(function hookHistory(){
  function emit(from,to){
    chrome.runtime.sendMessage({ type:"BATCH_EVENTS", payload:{ reason:"route-change", events:[{
      url: to, timestamp: now(), action:"route_change",
      selector:{ css:null, xpath:null }, tagName:"ROUTE",
      data:{ from, to, title: document.title, framePath: getFramePath(window) }
    }] }});
  }
  const wrap = (name)=>{
    const orig=history[name];
    history[name] = function(...args){ const from=location.href; const ret=orig.apply(this,args); setTimeout(()=>{ const to=location.href; if (to!==from) emit(from,to); },0); return ret; };
  };
  wrap("pushState"); wrap("replaceState");
  addEventListener("popstate", ()=> emit("(popstate)", location.href));
})();
(function pageView(){
  const send = ()=> chrome.runtime.sendMessage({ type:"BATCH_EVENTS", payload:{ reason:"page-view", events:[{
    url: location.href, timestamp: now(), action:"page_view",
    selector:{ css:null, xpath:null }, tagName:"PAGE",
    data:{ title: document.title, referrer: document.referrer||null, viewport:{w: innerWidth, h: innerHeight}, framePath: getFramePath(window) }
  }] }});
  if (document.readyState==="complete" || document.readyState==="interactive") send();
  else addEventListener("DOMContentLoaded", send, { once:true });
})();

// ---- 후행 신호(토스트/모달/헤딩) ----
(function observePostState(){
  const mo = new MutationObserver(()=>{
    const heading = document.querySelector('h1,h2,[role="heading"]');
    const modal = document.querySelector('[role="dialog"], .modal, .ant-modal, .el-dialog');
    const toast = document.querySelector('.toast, .ant-message, .el-message, [role="alert"]');
    if (heading || modal || toast) {
      const hint = {
        title: heading ? textOf(heading)?.slice(0,80) : null,
        modal: modal ? textOf(modal)?.slice(0,120) : null,
        alert: toast ? textOf(toast)?.slice(0,120) : null
      };
      chrome.runtime.sendMessage({ type:"BATCH_EVENTS", payload:{ reason:"post-state", events:[{
        url: location.href, timestamp: now(), action:"post_state",
        selector:{ css:null, xpath:null }, tagName:"STATE",
        data:{ postHints: hint, framePath: getFramePath(window) }
      }] }});
    }
  });
  mo.observe(document.documentElement, { subtree:true, childList:true });
})();

// ---- 플러시 트리거 ----
setInterval(()=> flush("interval"), FLUSH_MS);
document.addEventListener("visibilitychange", ()=>{ if (document.visibilityState==="hidden") flush("hidden"); });
addEventListener("pagehide", ()=> flush("pagehide"));
chrome.runtime.onMessage.addListener((msg)=>{ if (msg?.type==="FLUSH_REQUEST") flush("request"); });
