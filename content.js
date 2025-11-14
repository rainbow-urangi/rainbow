// content.js — Full Event + Final Value, Session/Env, Menu/State, Route/PageView (safe)

/***** 설정 *****/
const CONFIG = {
  CAPTURE_MODE: 'BOTH',     // 'FINAL_ONLY' | 'PER_EVENT' | 'BOTH'
  KEY_SAMPLING_MS: 120,      // key/input 이벤트 샘플링 간격(ms)
  BUCKET_RATE: 10,           // 요소/이벤트타입별 초당 허용 이벤트
  BUCKET_SIZE: 20,           // 버킷 용량
  FINAL_DEBOUNCE_MS: 600     // 최종값 디바운스
};

/***** CSS.escape 폴리필 *****/
(function ensureCssEscape(){
  if (typeof CSS === "undefined") window.CSS = {};
  if (typeof CSS.escape !== "function") {
    CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_\-]/g, ch => `\\${ch}`);
  }
})();

/***** 유틸 *****/
const now = () => Date.now();
const textOf = n => (n?.textContent || "").replace(/\s+/g," ").trim() || null;

function cssPath(el){
  if (!(el instanceof Element)) return "";
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts=[];
  while (el && el.nodeType===1 && parts.length<8){
    let part = el.nodeName.toLowerCase();
    if (el.classList.length) part += "."+[...el.classList].map(CSS.escape).join(".");
    const sib=[...(el.parentNode?.children||[])].filter(x=>x.nodeName===el.nodeName);
    if (sib.length>1) part += `:nth-of-type(${sib.indexOf(el)+1})`;
    parts.unshift(part); el=el.parentElement;
  }
  return parts.join(" > ");
}
function xPath(el){
  if (!(el instanceof Element)) return "";
  if (el.id) return `//*[@id="${el.id}"]`;
  const segs=[];
  for (; el && el.nodeType===1; el=el.parentNode){
    let i=1; for(let s=el.previousSibling; s; s=s.previousSibling)
      if (s.nodeType===1 && s.nodeName===el.nodeName) i++;
    segs.unshift(`${el.nodeName.toLowerCase()}[${i}]`);
  }
  return "/"+segs.join("/");
}
function datasetAttrs(el, prefix='data-'){
  const out={}; if(!el?.attributes) return out;
  for (const a of el.attributes) if (a.name.startsWith(prefix)) out[a.name]=String(a.value).slice(0,500);
  return out;
}
function formContext(el){
  const f = el?.closest?.('form');
  return f ? { selector: cssPath(f), id: f.id||null, name: f.getAttribute('name')||null, action: f.getAttribute('action')||null } : null;
}
function bounding(el){
  try{
    const r=el.getBoundingClientRect();
    return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) };
  }catch{ return null; }
}
function getShadowPath(el){
  const chain=[]; let node=el;
  while (node){
    const root = node.getRootNode?.();
    if (root && root.host){ chain.unshift(cssPath(root.host)); node=root.host; }
    else node=node.parentElement;
  }
  return chain;
}
function getFramePath(win){
  try{
    const chain=[]; let w=win;
    while (w && w.frameElement){ chain.unshift(cssPath(w.frameElement)); w=w.parent; }
    return chain;
  }catch{ return []; }
}
function maskValue(el, v){
  const type=(el?.getAttribute?.('type')||"").toLowerCase();
  const name=(el?.getAttribute?.('name')||"").toLowerCase();
  if (type==="password" || /pass|pwd|ssn|credit|주민|비번/i.test(name)) return "*****";
  if (typeof v==="string" && v.includes("@")){
    const [id,dom]=v.split("@"); return (id?.slice(0,2)||"*")+"***@"+(dom?.split(".")[0]?.[0]||"*")+"***";
  }
  return v;
}
function isSensitive(el){
  const type=(el?.getAttribute?.('type')||"").toLowerCase();
  const name=(el?.getAttribute?.('name')||"").toLowerCase();
  return type==="password" || /pass|pwd|ssn|credit|주민|비번/i.test(name);
}

/***** 세션/환경 *****/
function uuid(){ return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)); }

const PageSession = {
  installId: null,       // 영구
  browserSessionId: null,// 브라우저 세션(백그라운드가 발급)
  tabId: null,
  pageSessionId: uuid(), // 탭 내 페이지 세션
  env: null
};

async function ensureInstallId(){
  return new Promise(res=>{
    chrome.storage.local.get(['install_id'], r=>{
      if (r.install_id) { PageSession.installId=r.install_id; return res(r.install_id); }
      const id=uuid(); chrome.storage.local.set({install_id:id}, ()=>{ PageSession.installId=id; res(id); });
    });
  });
}
function collectEnv(){
  const ua = navigator.userAgent || "";
  const lang = navigator.language || (navigator.languages||[])[0] || null;
  const tzoffset = new Date().getTimezoneOffset(); // minutes
  const dpr = window.devicePixelRatio || 1;
  const scr = { sw: screen.width, sh: screen.height, vw: innerWidth, vh: innerHeight, dpr };
  // 간단 파서(정교함보단 존재 여부)
  let os=null, osver=null, br=null, brver=null;
  try{
    if (navigator.userAgentData) {
      br = navigator.userAgentData.brands?.[0]?.brand || 'Chromium';
      brver = navigator.userAgentData.brands?.[0]?.version || null;
      os = navigator.userAgentData.platform || null;
    } else {
      if (/Windows NT/.test(ua)) os='Windows';
      else if (/Mac OS X/.test(ua)) os='macOS';
      else if (/Linux/.test(ua)) os='Linux';
      else if (/Android/.test(ua)) os='Android';
      else if (/iPhone|iPad|iPod/.test(ua)) os='iOS';
      if (/Chrome\/([\d.]+)/.exec(ua)) { br='Chrome'; brver=RegExp.$1; }
      else if (/Edg\/([\d.]+)/.exec(ua)) { br='Edge'; brver=RegExp.$1; }
      else if (/Firefox\/([\d.]+)/.exec(ua)) { br='Firefox'; brver=RegExp.$1; }
    }
  }catch{}
  return { os, osver, br, brver, lang, tzoffset, ua, ...scr };
}

/***** 안전한 세션/환경 getter (PageSession 미초기화 대비) *****/
function getSafeSessionMeta() {
  const ps = (typeof PageSession !== "undefined" && PageSession) ? PageSession : null;
  return {
    session: {
      install_id: ps?.installId ?? null,
      browser_session_id: ps?.browserSessionId ?? null,
      tab_id: ps?.tabId ?? null,
      page_session_id: ps?.pageSessionId ?? null
    },
    env: ps?.env ?? collectEnv()
  };
}

/***** 배치 큐 *****/
let QUEUE=[]; const MAX_QUEUE=40;
function flush(reason="interval"){
  if (!QUEUE.length) return;
  const batch = { reason, events: QUEUE.splice(0, QUEUE.length) };
  try{ chrome.runtime.sendMessage({ type:"BATCH_EVENTS", payload: batch }); }catch{}
}
setInterval(()=> flush("interval"), 5000);
addEventListener("pagehide", ()=> flush("pagehide"));
document.addEventListener("visibilitychange", ()=>{ if (document.visibilityState==="hidden") flush("hidden"); });
chrome.runtime.onMessage.addListener((msg)=>{ if (msg?.type==="FLUSH_REQUEST") flush("request"); });

/***** 공통 기록 함수 *****/
function record(el, action, value, extra={}) {
  const css = el ? cssPath(el) : null, xp = el ? xPath(el) : null;
  const data = {
    value: (value!==undefined && el) ? maskValue(el, value) : (value ?? undefined),
    attributes: {
      type: el?.getAttribute?.('type') || undefined,
      name: el?.getAttribute?.('name') || undefined,
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
    meta: getSafeSessionMeta(),  // ← 안전하게 세션/환경 주입
    ...extra
  };

  const rec = {
    url: location.href,
    timestamp: now(),
    action,                      // 'change' | 'menu_click' | 'event' | ...
    selector: { css, xpath: xp },
    tagName: el?.tagName || null,
    data
  };
  QUEUE.push(rec);
  if (QUEUE.length>=MAX_QUEUE) flush("max");
}

/***** 레이트리밋/샘플링 *****/
const buckets = new WeakMap();
function allowEvent(el, type){
  const k = el || document.body;
  let b = buckets.get(k);
  const t = now();
  if (!b) b = { t, tokens: CONFIG.BUCKET_SIZE };
  const dt = Math.max(0, t - b.t)/1000;
  b.tokens = Math.min(CONFIG.BUCKET_SIZE, b.tokens + dt*CONFIG.BUCKET_RATE);
  b.t = t;
  if (b.tokens >= 1){ b.tokens -= 1; buckets.set(k,b); return true; }
  buckets.set(k,b); return false;
}

/***** 최종값(기존) *****/
const INPUTS = "input, textarea"; const FINAL_TIMERS = new WeakMap();
function scheduleFinalRecord(t){
  clearTimeout(FINAL_TIMERS.get(t));
  FINAL_TIMERS.set(t, setTimeout(()=> record(t,"change", t.value), CONFIG.FINAL_DEBOUNCE_MS));
}
if (CONFIG.CAPTURE_MODE!=='PER_EVENT'){
  addEventListener("input",(e)=>{ const t=e.target?.closest(INPUTS); if(t) scheduleFinalRecord(t); }, true);
  addEventListener("blur",(e)=>{ const t=e.target?.closest(INPUTS); if(!t) return; clearTimeout(FINAL_TIMERS.get(t)); record(t,"change",t.value); }, true);
  addEventListener("keydown",(e)=>{ if(e.key!=="Enter") return; const t=e.target?.closest(INPUTS); if(!t) return; clearTimeout(FINAL_TIMERS.get(t)); record(t,"change",t.value); }, true);
  addEventListener("change",(e)=>{ const t=e.target?.closest("select"); if(!t) return; const opt=t.selectedOptions?.[0]; record(t,"change",t.value,{ selectedText: opt?.text||null }); }, true);
}

/***** 전량 이벤트 *****/
if (CONFIG.CAPTURE_MODE!=='FINAL_ONLY'){
  let lastKeyTs = 0;
  ['keydown','keyup','input'].forEach(evt=>{
    addEventListener(evt, (e)=>{
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !allowEvent(t, evt)) return;
      const ts = now();
      if (evt!=='keydown' && (ts - lastKeyTs) < CONFIG.KEY_SAMPLING_MS) return;
      lastKeyTs = ts;

      const instant = { type: evt };
      if (!isSensitive(t)){
        if (evt==='keydown' || evt==='keyup'){
          instant.key = e.key; instant.ctrl=e.ctrlKey; instant.alt=e.altKey; instant.shift=e.shiftKey;
        }
        if (evt==='input'){ instant.length = (t.value||'').length; }
      } else {
        instant.sensitive = true;
      }
      record(t, 'event', undefined, { instant });
    }, true);
  });

  ['focus','blur'].forEach(evt=>{
    addEventListener(evt, (e)=>{
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !allowEvent(t, evt)) return;
      record(t, 'event', undefined, { instant: { type: evt } });
    }, true);
  });

  ['mousedown','mouseup','click','dblclick','contextmenu'].forEach(evt=>{
    addEventListener(evt,(e)=>{
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !allowEvent(t, evt)) return;
      const p={ type:evt, button:e.button, x:e.clientX, y:e.clientY };
      record(t, 'event', undefined, { instant: p });
    }, true);
  });

  addEventListener('change',(e)=>{
    const t = e.target instanceof Element ? e.target : null;
    if (!t || !allowEvent(t,'change')) return;
    let extra = { type:'change' };
    if (t.tagName==='SELECT'){ const opt=t.selectedOptions?.[0]; extra.selectedText=opt?.text||null; }
    record(t, 'event', undefined, { instant: extra });
  }, true);
}

/***** 메뉴 클릭(라벨/루트/경로 + meta/a11y/폼/셰도우/프레임 보강) *****/
const NAV_ROOT_SELECTOR = 'nav,[role="navigation"],aside,.sidebar,.menu,.navigation';
const MENU_ITEM_SELECTOR = 'a[href], [role="menuitem"], [role="treeitem"], button, [role="button"], .el-menu-item, .ant-menu-item, [data-az-menu]';
const MENU_DEDUP = new WeakMap();
function shouldRecordMenu(el){ const n=now(), p=MENU_DEDUP.get(el)||0; MENU_DEDUP.set(el,n); return (n-p)>400; }
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
  if (!el || !shouldRecordMenu(el)) return;
  const root = navRootOf(el);
  const labelFallback = el.getAttribute('title')
    || el.getAttribute('aria-label')
    || Object.values(datasetAttrs(el)).find(Boolean)
    || textOf(el);

  const payload = {
    identifier: (el.id?`#${el.id}`:null)
             || (el.getAttribute('name')?`name=${el.getAttribute('name')}`:null)
             || (el.getAttribute('data-testid')?`data-testid=${el.getAttribute('data-testid')}`:null)
             || (el.getAttribute('aria-label')?`aria-label=${el.getAttribute('aria-label')}`:null)
             || (el.getAttribute('href')?`href=${el.getAttribute('href')}`:null),
    label: labelFallback || null,
    href: el.getAttribute('href')||null,
    role: el.getAttribute('role')||null,
    // a11y/attr/testids/form/frame/shadow/meta/title/referrer
    a11y: {
      role: el.getAttribute('role') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      ariaLabelledby: el.getAttribute('aria-labelledby') || null
    },
    attributes: {
      type: el.getAttribute('type') || undefined,
      name: el.getAttribute('name') || undefined,
      id: el.id || undefined,
      class: el.className || undefined
    },
    testids: datasetAttrs(el),
    navRoot: root ? cssPath(root) : null,
    liTrail: liTrail(el, root),
    className: el.className||null,
    bounds: bounding(el),
    framePath: getFramePath(window),
    shadowPath: getShadowPath(el),
    form: formContext(el),
    meta: getSafeSessionMeta(),
    title: document.title,
    referrer: document.referrer||null
  };

  chrome.runtime.sendMessage({ type:"BATCH_EVENTS", payload:{ reason:"menu-click", events:[{
    url: location.href, timestamp: now(), action:"menu_click",
    selector:{ css: cssPath(el), xpath: xPath(el) }, // background에서 보강 유무와 무관
    tagName: el.tagName, data: payload
  }] }});
}, true);

/***** 라우팅/페이지뷰 *****/
(function hookHistory(){
  function emit(from,to){
    chrome.runtime.sendMessage({ type:"BATCH_EVENTS", payload:{ reason:"route-change", events:[{
      url: to, timestamp: now(), action:"route_change",
      selector:{ css:null, xpath:null }, tagName:"ROUTE",
      data:{ from, to, title: document.title, framePath: getFramePath(window), meta: getSafeSessionMeta() }
    }] }});
  }
  const wrap = name=>{
    const orig=history[name];
    history[name]=function(...args){ const from=location.href; const ret=orig.apply(this,args); setTimeout(()=>{ const to=location.href; if (to!==from) emit(from,to); },0); return ret; };
  };
  wrap("pushState"); wrap("replaceState");
  addEventListener("popstate", ()=> emit("(popstate)", location.href));
})();
(function pageView(){
  const send = ()=> chrome.runtime.sendMessage({ type:"BATCH_EVENTS", payload:{ reason:"page-view", events:[{
    url: location.href, timestamp: now(), action:"page_view",
    selector:{ css:null, xpath:null }, tagName:"PAGE",
    data:{ title: document.title, referrer: document.referrer||null, viewport:{w: innerWidth, h: innerHeight}, framePath: getFramePath(window),
           meta: getSafeSessionMeta() }
  }] }});
  if (document.readyState==="complete" || document.readyState==="interactive") send();
  else addEventListener("DOMContentLoaded", send, { once:true });
})();

/***** 세션/환경 초기화 및 백그라운드와 핸드셰이크 *****/
(async function init(){
  await ensureInstallId();
  PageSession.env = collectEnv();
  chrome.runtime.sendMessage({ type:"HELLO" }, (res)=>{
    if (res){ PageSession.browserSessionId=res.browser_session_id || null; PageSession.tabId=res.tab_id ?? null; }
  });
})();

// ------- 로그인 아이디 저장(폼 제출 시) -------
(function captureLoginIdOnSubmit(){
  function isLoginForm(form){
    return !!form.querySelector('input[type="password"]');
  }
  function findUserField(form){
    const cand = form.querySelector(
      [
        'input[type="email"]',
        'input[name*="user"]',
        'input[name*="login"]',
        'input[name*="account"]',
        'input[name*="id"]',
        'input[id*="user"]',
        'input[id*="login"]',
        'input[id*="account"]',
        'input[id*="id"]',
        'input[type="text"]'
      ].join(',')
    );
    return cand || null;
  }
  function getUserId(form){
    const el = findUserField(form);
    const v = el?.value?.trim();
    if (!v) return null;
    return v;
  }

  // 1) form submit
  document.addEventListener('submit', (e)=>{
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!isLoginForm(form)) return;
    const uid = getUserId(form);
    if (uid) chrome.storage.local.set({ loginId: uid });
  }, true);

  // 2) submit 버튼 클릭(일부 사이트는 JS로 제출)
  document.addEventListener('click', (e)=>{
    const btn = e.target?.closest('button, input[type="submit"]');
    if (!btn) return;
    const form = btn.form || btn.closest('form');
    if (form && isLoginForm(form)) {
      const uid = getUserId(form);
      if (uid) chrome.storage.local.set({ loginId: uid });
    }
  }, true);
})();
