// content.js — Rows emitter with snapshots, final-value debounce, menu trail, SPA routing

(() => {
  // ───────────────── Config ─────────────────
  const ALLOWED_HOSTS = ["c4web.c4mix.com"];
  if (!ALLOWED_HOSTS.includes(location.hostname)) {
    return; // 다른 사이트에서는 아무 것도 하지 않고 종료
  }
  
  const CONFIG = {
    CAPTURE_MODE: 'FINAL_ONLY',       // 'FINAL_ONLY' | 'PER_EVENT' | 'BOTH'
    KEY_SAMPLING_MS: 120,
    FINAL_DEBOUNCE_MS: 600
  };
  const SNAPSHOT = {
    ENABLED: true,
    AFTER_DELAY_MS: 250,
    MAX_CHARS: 500000
  };

  // CSS.escape polyfill
  if (typeof CSS === "undefined") window.CSS = {};
  if (typeof CSS.escape !== "function") {
    CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_\-]/g, ch => `\\${ch}`);
  }

  // ───────────────── IDs/State ─────────────────
  const INSTALL_KEY = 'AZ_INSTALL_ID';
  const PAGE_SESSION_ID = crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2));
  window.__AZ_PAGE_SESSION_ID = PAGE_SESSION_ID;

  let INSTALL_ID = null;
  let BROWSER_ID = null;
  let TAB_ID = null;
  let LOGIN_ID = 'unknown';        // storage.local 에서 로드/캡처
  const FINAL_TIMERS = new WeakMap();
  let lastKeyTs = 0;

  // ───────────────── Utils ─────────────────
  const pad = (n, w=2) => String(n).padStart(w, "0");
  function dtUtc(ms) {
    const d = new Date(ms || Date.now());
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ` +
           `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  function textOf(n){ return (n?.textContent || "").replace(/\s+/g," ").trim() || null; }

  function cssPath(el){
    if (!(el instanceof Element)) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts=[];
    let cur=el, depth=0;
    while (cur && cur.nodeType===1 && depth<8){
      let part = cur.nodeName.toLowerCase();
      if (cur.classList.length) part += "."+[...cur.classList].map(CSS.escape).join(".");
      const sib=[...(cur.parentNode?.children||[])].filter(x=>x.nodeName===cur.nodeName);
      if (sib.length>1) part += `:nth-of-type(${sib.indexOf(cur)+1})`;
      parts.unshift(part); cur=cur.parentElement; depth++;
    }
    return parts.join(" > ");
  }
  function xPath(el){
    if (!(el instanceof Element)) return null;
    if (el.id) return `//*[@id="${el.id}"]`;
    const segs=[]; let cur=el;
    while (cur && cur.nodeType===1){
      let i=1; for(let s=cur.previousSibling; s; s=s.previousSibling)
        if (s.nodeType===1 && s.nodeName===cur.nodeName) i++;
      segs.unshift(`${cur.nodeName.toLowerCase()}[${i}]`);
      cur=cur.parentNode;
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
    try{
      while (node){
        const root = node.getRootNode?.();
        if (root && root.host){ chain.unshift(cssPath(root.host)); node=root.host; }
        else node=node.parentElement;
      }
    }catch{}
    return chain;
  }
  function getFramePath(win){
    try{
      const chain=[]; let w=win;
      while (w && w.frameElement){ chain.unshift(cssPath(w.frameElement)); w=w.parent; }
      return chain;
    }catch{ return []; }
  }
  function isSensitive(el){
    const type=(el?.getAttribute?.('type')||"").toLowerCase();
    const name=(el?.getAttribute?.('name')||"").toLowerCase();
    return type==="password" || /pass|pwd|ssn|credit|주민|비번/i.test(name);
  }
  function maskValue(el, v){
    if (isSensitive(el)) return "*****";
    return v;
  }
  function normalizeInputValue(el) {
    if (!el) return null;
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute && el.getAttribute('type')) || '';
    if (tag === 'input' && /password/i.test(type)) return null; // never capture passwords
    if (tag === 'input' || tag === 'textarea') return el.value ?? null;
    if (el.isContentEditable) return el.innerText || el.textContent || null;
    return null;
  }
  function isMenuElement(el) {
    if (!el) return false;
    if (el.tagName === 'A') return true;
    const role = el.getAttribute?.('role');
    if (role && /menuitem|tab|button/i.test(role)) return true;
    return (el.closest && !!el.closest('nav, .nav, .navbar, [role="menubar"], [role="navigation"]'));
  }
  function navRootOf(el){ return el?.closest('nav,[role="navigation"],aside,.sidebar,.menu,.navigation') || null; }
  function liTrail(el, root){
    const trail=[]; let cur=el?.closest('li,[role="menuitem"],[role="treeitem"],a,button') || el;
    while (cur && (!root || root.contains(cur))){
      const t=textOf(cur); if (t && !trail.includes(t)) trail.unshift(t);
      cur = cur.parentElement?.closest?.('li,[role="menuitem"],[role="treeitem"]') || null;
    }
    return trail.slice(-5);
  }

  // ───────────────── DOM Snapshot ─────────────────
  function bestSnapshotRoot(el){
    try{
      return el?.closest?.('form,[role="dialog"],[data-reactroot],#app,main,body') || document.body || document.documentElement;
    }catch{ return document.documentElement; }
  }
  function takeDomSnapshot(el){
    if (!SNAPSHOT.ENABLED) return null;
    let root = bestSnapshotRoot(el);
    let html = (root?.outerHTML) || document.documentElement.outerHTML || "";
    if (SNAPSHOT.MAX_CHARS && html.length > SNAPSHOT.MAX_CHARS){
      html = html.slice(0, SNAPSHOT.MAX_CHARS) + '\n<!-- clipped -->';
    }
    return html;
  }
  function withDomSnapshot(el, done){
    const before = takeDomSnapshot(el);
    setTimeout(()=>{ const after = takeDomSnapshot(el); try{ done({ dom_before: before, dom_after: after }); }catch{}; }, SNAPSHOT.AFTER_DELAY_MS);
  }

  // ===== API 응답 body 캡처 (page world fetch hook) =====
  function injectFetchHook() {
    try {
      const script = document.createElement("script");
      script.textContent = "(" + function () {
        if (!window.fetch) return;
        const ORIG_FETCH = window.fetch;
        const MAX_API_BODY = 100000;

        window.fetch = async function (...args) {
          const res = await ORIG_FETCH.apply(this, args);

          try {
            let url = res.url;
            if (!url && typeof args[0] === "string") url = args[0];
            if (!url && args[0] instanceof Request) url = args[0].url || null;

            // c4web.c4mix.com 만 수집
            if (!url || !url.includes("c4web.c4mix.com")) {
              return res;
            }

            const cloned = res.clone();
            const ct = (cloned.headers.get("content-type") || "").toLowerCase();

            // 텍스트/JSON 계열만 저장
            if (!ct.includes("json") && !ct.startsWith("text/") && !ct.includes("xml")) {
              return res;
            }

            let bodyText = await cloned.text();
            if (bodyText && bodyText.length > MAX_API_BODY) {
              bodyText = bodyText.slice(0, MAX_API_BODY) + "\n/* clipped */";
            }

            // 페이지 월드 -> content script로 전달
            window.postMessage(
              {
                source: "az-extension",
                type: "AZ_FETCH_BODY",
                url,
                status: res.status,
                method:
                  (args[1] && args[1].method) ||
                  (args[0] && args[0].method) ||
                  "GET",
                body: bodyText,
              },
              "*"
            );
          } catch (e) {
            console.warn("[az-fetch-hook] failed", e);
          }

          return res;
        };
      } + ")();";

      (document.documentElement || document.head || document.body).appendChild(script);
      script.remove();
    } catch (e) {
      console.warn("[injectFetchHook] failed", e);
    }
  }

  // 페이지 월드에서 postMessage로 보내주는 fetch body 수신
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "az-extension" || data.type !== "AZ_FETCH_BODY") return;

    const { url, status, method, body } = data;

    // API 응답 전용 row 생성
    const row = buildRow(
      null,          // el 없음
      "api",         // logicalType
      "api_response",// action
      null,
      {
        snapshot: { api_response_body: body }
      }
    );

    row.AZ_api_url    = url;
    row.AZ_api_status = status;
    row.AZ_api_method = method;

    // host/path는 buildRow에서 page_url 기준으로 이미 채우고 있고,
    // server.js enrichRow()가 AZ_api_url로부터 host/path 파생도 해줍니다.
    sendRows([row]);
  });

  // ───────────────── Install/Handshake/Login ─────────────────
  async function ensureInstallId(){
    try {
      const got = await chrome.storage.local.get([INSTALL_KEY]);
      if (got && got[INSTALL_KEY]) INSTALL_ID = got[INSTALL_KEY];
      else {
        INSTALL_ID = crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2));
        await chrome.storage.local.set({ [INSTALL_KEY]: INSTALL_ID });
      }
    } catch {
      INSTALL_ID = crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2));
    }
    window.__AZ_INSTALL_ID = INSTALL_ID;
  }
  async function loadLoginId(){
    try{
      const { loginId } = await chrome.storage.local.get("loginId");
      const s = (typeof loginId==="string" && loginId.trim()) ? loginId.trim() : null;
      if (s) LOGIN_ID = s.slice(0,128);
    }catch{}
  }
  function guessLoginId(){
    try{
      const candidates = [...document.querySelectorAll('input,textarea')];
      const score = f =>{
        const n=(f.getAttribute('name')||'').toLowerCase();
        const i=(f.id||'').toLowerCase();
        const p=(f.getAttribute('placeholder')||'').toLowerCase();
        const t=(f.type||'').toLowerCase();
        let s=0;
        if (/(login|userid|user|email|account|아이디|사번)/.test(n+i+p)) s+=2;
        if (t==='text' || t==='email') s+=1;
        if ((f.value||'').length>=3) s+=2;
        return s;
      };
      const field = candidates.sort((a,b)=>score(b)-score(a))[0];
      const val = (field?.value||'').trim();
      if (val) {
        const v = val.slice(0,128);
        chrome.storage.local.set({ loginId: v });
        LOGIN_ID = v;
      }
    }catch{}
  }
  function captureLoginIdOnSubmit(){
    addEventListener('submit', (e)=>{
      const f = e.target instanceof HTMLFormElement ? e.target : null;
      if (!f) return;
      const idField = f.querySelector('input[type="text"],input[type="email"],input[name*="id"],input[name*="user"],input[name*="login"]');
      const val = (idField?.value||'').trim();
      if (val) {
        const v = val.slice(0,128);
        chrome.storage.local.set({ loginId: v });
        LOGIN_ID = v;
      }
    }, true);
  }
  async function handshake() {
    try {
      const ack = await chrome.runtime.sendMessage({ type: 'HELLO' });
      if (ack) {
        BROWSER_ID = ack?.payload?.browser_session_id || ack?.browser_session_id || null;
        TAB_ID     = ack?.payload?.tab_id            || ack?.tab_id            || null;
      }
    } catch {}
  }

  // ───────────────── Row Builder ─────────────────
  function elementUid(el) {
    if (!el) return null;
    if (el.id) return `id=${el.id}`;
    const href = el.getAttribute?.('href'); if (href) return `href=${href}`;
    const name = el.getAttribute?.('name'); if (name) return `name=${name}`;
    const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0,3).join('.');
    return (el.tagName || 'el').toLowerCase() + (cls ? '.'+cls : '');
  }
  function buildRow(el, logicalType, action, inputValue, extra={}) {
    const menuRoot = logicalType === 'menu' ? navRootOf(el) : null;
    const menuTrail = logicalType === 'menu' ? liTrail(el, menuRoot) : null;
    const framePath = JSON.stringify(getFramePath(window));
    const shadowPath = JSON.stringify(getShadowPath(el));
    const url = location.href;

    const row = {
      AZ_event_time: dtUtc(Date.now()),

      // element
      AZ_element_type: logicalType || 'event',
      AZ_event_action: action || null,
      AZ_event_subtype: extra.event_subtype || null,
      AZ_element_uid: elementUid(el),
      AZ_element_label: textOf(el) || el?.getAttribute?.('aria-label') || null,
      AZ_element_tag: (el?.tagName || '').toLowerCase() || null,

      // page
      AZ_url: url,
      AZ_url_host: (()=>{ try { return new URL(url).host; } catch { return null; } })(),
      AZ_url_path: (()=>{ try { return new URL(url).pathname; } catch { return null; } })(),
      AZ_page_title: document.title || null,
      AZ_referrer: document.referrer || null,

      // selectors
      AZ_selector_css: cssPath(el),
      AZ_selector_xpath: xPath(el),
      AZ_data_testid: el?.getAttribute?.('data-testid') || el?.getAttribute?.('data-test-id') || null,

      // input
      AZ_data: (inputValue !== undefined && inputValue !== null) ? maskValue(el, inputValue) : null,

      // session
      AZ_session_install_id: INSTALL_ID,
      AZ_session_browser_id: BROWSER_ID,
      AZ_session_tab_id: TAB_ID,
      AZ_session_page_id: PAGE_SESSION_ID,

      // login
      AZ_login_id: LOGIN_ID || 'unknown',

      // viewport
      AZ_viewport_w: window.innerWidth || null,
      AZ_viewport_h: window.innerHeight || null,

      // extra context
      AZ_nav_root: menuRoot ? cssPath(menuRoot) : null,
      AZ_menu_li_trail: menuTrail ? JSON.stringify(menuTrail) : null,
      AZ_form_selector: formContext(el)?.selector || null,
      AZ_form_name: formContext(el)?.name || null,
      AZ_form_action: formContext(el)?.action || null,
      AZ_frame_path: framePath,
      AZ_shadow_path: shadowPath,

      // locators_json (object; server handles JSON or string)
      AZ_locators_json: {
        a11y: {
          role: el?.getAttribute?.('role') || null,
          ariaLabel: el?.getAttribute?.('aria-label') || null,
          ariaLabelledby: el?.getAttribute?.('aria-labelledby') || null
        },
        testids: datasetAttrs(el),
        attrs: {
          id: el?.id || null,
          name: el?.getAttribute?.('name') || null,
          class: (el?.className || '').toString() || null
        },
        bounds: bounding(el),
        session: {
          install_id: INSTALL_ID,
          browser_session_id: BROWSER_ID,
          tab_id: TAB_ID,
          page_session_id: PAGE_SESSION_ID
        },
        env: {
          os: navigator.platform || null,
          br: 'Chromium',
          brver: (navigator.userAgent || '').match(/Chrome\/(\S+)/)?.[1] || null,
          lang: navigator.language || null,
          tzoffset: new Date().getTimezoneOffset(),
          ua: navigator.userAgent,
          sw: screen.width, sh: screen.height, vw: window.innerWidth, vh: window.innerHeight,
          dpr: window.devicePixelRatio
        }
      }
    };

    // snapshot (server.js가 AZ_dom_*/AZ_snapshot_*/*snapshot.api_response_body 수용)
    if (extra.snapshot) {
      row.snapshot = {
        dom_before: extra.snapshot.dom_before || null,
        dom_after: extra.snapshot.dom_after || null,
        api_response_body: extra.snapshot.api_response_body ?? null
      };
    }

    return row;
  }

  async function sendRows(rows){
    if (!rows?.length) return;
    try { await chrome.runtime.sendMessage({ type: 'BATCH_EVENTS', rows }); }
    catch (e) { console.warn('[BATCH_EVENTS] send failed', e); }
  }

  // ───────────────── Handlers ─────────────────
  function onClick(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const isMenu = isMenuElement(el);

    if (isMenu) {
      withDomSnapshot(el, snap => {
        const row = buildRow(el, 'menu', 'menu_click', textOf(el), { snapshot: snap });
        sendRows([row]);
      });
    } else {
      const row = buildRow(el, 'event', 'click', null);
      sendRows([row]);
    }
  }

  function onFocus(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    sendRows([buildRow(el, 'event', 'focus', null)]);
  }
  function onBlur(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const v = normalizeInputValue(el);
    withDomSnapshot(el, snap => {
      const row = buildRow(el, 'event', 'blur', v, { snapshot: snap });
      sendRows([row]);
    });
  }

  function onInput(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const now = Date.now();
    if ((now - lastKeyTs) < CONFIG.KEY_SAMPLING_MS) return;
    lastKeyTs = now;

    const v = normalizeInputValue(el);
    if (CONFIG.CAPTURE_MODE !== 'FINAL_ONLY') {
      sendRows([buildRow(el, 'input', 'change', v)]);
    }
    clearTimeout(FINAL_TIMERS.get(el));
    FINAL_TIMERS.set(el, setTimeout(() => {
      const val = normalizeInputValue(el);
      withDomSnapshot(el, snap => {
        const r = buildRow(el, 'input', 'change', val, { snapshot: snap });
        sendRows([r]);
      });
    }, CONFIG.FINAL_DEBOUNCE_MS));
  }

  function onKeydown(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    if (CONFIG.CAPTURE_MODE !== 'FINAL_ONLY') {
      const r = buildRow(el, 'event', 'keydown', e.key);
      r.AZ_key = e.key;
      r.AZ_key_mods = [
        e.ctrlKey ? 'Ctrl' : null,
        e.metaKey ? 'Meta' : null,
        e.altKey ? 'Alt' : null,
        e.shiftKey ? 'Shift' : null
      ].filter(Boolean).join('+') || null;
      sendRows([r]);
    }
    if (e.key === 'Enter') {
      clearTimeout(FINAL_TIMERS.get(el));
      const val = normalizeInputValue(el);
      withDomSnapshot(el, snap => {
        const r = buildRow(el, 'input', 'change', val, { snapshot: snap });
        sendRows([r]);
      });
    }
  }

  function onSubmit(e) {
    const f = e.target instanceof HTMLFormElement ? e.target : null;
    if (!f) return;
    withDomSnapshot(f, snap => {
      const row = buildRow(f, 'event', 'submit', null, { snapshot: snap });
      sendRows([row]);
    });
  }

  // Page view
  function sendPageView() {
    const row = buildRow(document.documentElement, 'page', 'page_view', null);
    row.AZ_element_uid = 'PAGE';
    row.AZ_selector_css = 'PAGE';
    row.AZ_selector_xpath = '/html[1]';
    row.AZ_element_tag = 'html';
    sendRows([row]);
  }

  // SPA route change
  function setupSpaHooks() {
    try {
      const emitRoute = (from, to) => {
        const r = buildRow(document.documentElement, 'page', 'route_change', null);
        r.AZ_route_from = from;
        r.AZ_route_to = to;
        sendRows([r]);
      };
      const wrap = (name) => {
        const orig = history[name].bind(history);
        history[name] = function(...args){
          const from = location.href;
          const ret = orig(...args);
          const to = location.href;
          if (to !== from) emitRoute(from, to);
          return ret;
        };
      };
      wrap('pushState'); wrap('replaceState');
      window.addEventListener('popstate', () => emitRoute('(popstate)', location.href), true);
    } catch {}
  }

  // FLUSH_REQUEST 호환(현 구조에선 즉시 전송이라 실질 no-op)
  chrome.runtime.onMessage.addListener((msg)=>{
    if (msg?.type === 'FLUSH_REQUEST') {
      // no-op: rows는 즉시 전송
    }
  });

  // ─────────────── Init ───────────────
  (async function init(){
    await ensureInstallId();
    await loadLoginId();
    await handshake();
    guessLoginId();
    captureLoginIdOnSubmit();
    injectFetchHook();

    addEventListener('click', onClick, true);
    addEventListener('focus', onFocus, true);
    addEventListener('blur', onBlur, true);
    addEventListener('input', onInput, true);
    addEventListener('change', onInput, true);
    addEventListener('keydown', onKeydown, true);
    addEventListener('submit', onSubmit, true);

    setupSpaHooks();

    if (document.readyState === 'complete' || document.readyState === 'interactive') sendPageView();
    else addEventListener('DOMContentLoaded', sendPageView, { once: true });
  })();
})();
