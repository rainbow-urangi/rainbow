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

  // ───────────────── Visible Text & Associated Label ─────────────────
  // 고객 요청:
  //  (A) 클릭 가능한 요소의 화면 노출 텍스트 → events.element_text
  //  (B) 입력 필드의 라벨/placeholder → events.associated_label
  const MAX_ELEMENT_TEXT_CHARS = 2048;
  const MAX_ASSOC_LABEL_CHARS  = 2048;

  // 클릭 가능한 요소(버튼/링크 등). 클릭 시 e.target이 span/icon일 수 있어 closest로 끌어올려 사용
  const CLICKABLE_SELECTOR =
    'button,a,[role="button"],[role="link"],[role="menuitem"],[role="tab"],' +
    'input[type="button"],input[type="submit"],input[type="reset"],input[type="image"]';

  function clampText(s, maxLen){
    if (s == null) return null;
    const t = String(s).replace(/\s+/g, ' ').trim();
    if (!t) return null;
    return t.length > maxLen ? t.slice(0, maxLen) : t;
  }

  function isClickableElement(el){
    if (!(el instanceof Element)) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'button' || tag === 'a') return true;
    if (tag === 'input') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['button','submit','reset','image'].includes(type)) return true;
    }
    const role = el.getAttribute?.('role') || '';
    if (role && /button|link|menuitem|tab/i.test(role)) return true;
    if (typeof el.onclick === 'function') return true;
    return false;
  }

  // "사용자에게 보이는" 텍스트: innerText 우선 + fallback(textContent/aria-label)
  function visibleTextOf(el){
    if (!(el instanceof Element)) return null;

    // input[type=button|submit|reset]은 value가 화면 텍스트
    if ((el.tagName || '').toLowerCase() === 'input') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['button','submit','reset'].includes(type)) {
        const v = clampText(el.value, MAX_ELEMENT_TEXT_CHARS);
        if (v) return v;
      }
    }

    let t = null;
    try { t = el.innerText; } catch { /* ignore */ }
    t = clampText(t, MAX_ELEMENT_TEXT_CHARS);
    if (t) return t;

    t = clampText(el.textContent, MAX_ELEMENT_TEXT_CHARS);
    if (t) return t;

    t = clampText(el.getAttribute?.('aria-label') || null, MAX_ELEMENT_TEXT_CHARS);
    return t;
  }

  function isInputLike(el){
    if (!(el instanceof Element)) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function associatedLabelOf(el){
    if (!isInputLike(el)) return null;

    // 0) placeholder (요청사항: label이 없으면 placeholder)
    const placeholder = clampText(el.getAttribute?.('placeholder') || null, MAX_ASSOC_LABEL_CHARS);

    // 1) label[for=id]
    const id = el.id;
    if (id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const t = clampText(visibleTextOf(lbl) || textOf(lbl), MAX_ASSOC_LABEL_CHARS);
        if (t) return t;
      } catch { /* ignore */ }
    }

    // 2) wrapping label
    const wrap = el.closest?.('label');
    if (wrap) {
      const t = clampText(visibleTextOf(wrap) || textOf(wrap), MAX_ASSOC_LABEL_CHARS);
      if (t) return t;
    }

    // 3) aria-label
    const aria = clampText(el.getAttribute?.('aria-label') || null, MAX_ASSOC_LABEL_CHARS);
    if (aria) return aria;

    // 4) aria-labelledby
    const labelledby = (el.getAttribute?.('aria-labelledby') || '').trim();
    if (labelledby) {
      const ids = labelledby.split(/\s+/).filter(Boolean);
      const parts = ids
        .map((i) => document.getElementById(i))
        .filter(Boolean)
        .map((n) => clampText(visibleTextOf(n) || textOf(n), MAX_ASSOC_LABEL_CHARS))
        .filter(Boolean);
      if (parts.length) return clampText(parts.join(' '), MAX_ASSOC_LABEL_CHARS);
    }

    // 5) 근접 라벨 후보(부트스트랩 input-group / 커스텀 폼 대응)
    //    - label 태그뿐 아니라 .input-group-addon/.input-group-text 등도 지원
    //    - 동일 컨테이너 내 라벨이 여러 개면 "현재 입력 바로 앞" 텍스트 우선
    try {
      const container =
        el.closest('.input-group') ||
        el.closest('.form-group') ||
        el.closest('td,th,div,form,fieldset') ||
        null;

      if (container) {
        const selector = [
          'label',
          '[role="label"]',
          '.input-group-addon',
          '.input-group-text',
          '.input-group-prepend',
          '.input-group-append',
          '.label',
          '[class*="label"]',
          '[class*="Label"]',
          '.title',
          '[class*="title"]',
          '[class*="Title"]'
        ].join(',');

        const nodes = [...container.querySelectorAll(selector)].filter(n => n && n !== el);

        // 입력 요소 "앞쪽" 후보 중 가장 가까운 것(마지막)을 선택
        const prior = nodes.filter(n => (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
        for (let i = prior.length - 1; i >= 0; i--) {
          const t = clampText(visibleTextOf(prior[i]) || textOf(prior[i]), MAX_ASSOC_LABEL_CHARS);
          if (t) return t;
        }

        // 앞쪽 후보가 없으면 전체 후보 중 마지막이라도 사용
        for (let i = nodes.length - 1; i >= 0; i--) {
          const t = clampText(visibleTextOf(nodes[i]) || textOf(nodes[i]), MAX_ASSOC_LABEL_CHARS);
          if (t) return t;
        }
      }
    } catch { /* ignore */ }

    // 6) fallback: placeholder
    return placeholder || null;
  }


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

  // 🔥 NEW: input/button/div/grid 대응용 value extractor
  function extractBestValue(el) {
  if (!el) return null;

  // 1) input / textarea / contenteditable
  let v = normalizeInputValue(el);
  if (v) return v;

  // 2) aria-value 계열 (grid, slider 등)
  const ariaVal =
    el.getAttribute?.('aria-valuetext') ||
    el.getAttribute?.('aria-value');
  if (ariaVal) return ariaVal;

  // 3) 자기 자신 텍스트
  const txt = textOf(el);
  if (txt) return txt;

  // 4) 주변 input/select 탐색 (버튼 → 검색어)
  const near = el.closest('form,div')?.querySelector(
    'input:not([type=password]), textarea, select'
  );
  if (near) {
    const nv = normalizeInputValue(near);
    if (nv) return nv;
  }

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

  // ===== API 응답 body 캡처 (CSP-safe: background에서 MAIN world로 설치) =====
  let __azFetchHookRequested = false;

  async function injectFetchHook() {
    if (__azFetchHookRequested) return;
    __azFetchHookRequested = true;

    try {
      await chrome.runtime.sendMessage({ type: "AZ_INJECT_FETCH_HOOK" });
    } catch (e) {
      console.warn("[AZ] fetch hook inject request failed", e);
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

    // element_text / associated_label (DB 컬럼: events.element_text / events.associated_label)
    const clickableBase = (el && el.closest) ? (el.closest(CLICKABLE_SELECTOR) || el) : el;
    const element_text = (clickableBase && isClickableElement(clickableBase)) ? visibleTextOf(clickableBase) : null;
    const associated_label = (el && isInputLike(el)) ? associatedLabelOf(el) : null;

    const row = {
      AZ_event_time: dtUtc(Date.now()),

      // element
      AZ_element_type: logicalType || 'event',
      AZ_event_action: action || null,
      AZ_event_subtype: extra.event_subtype || null,
      AZ_element_uid: elementUid(el),
      AZ_element_label: textOf(el) || el?.getAttribute?.('aria-label') || null,
      AZ_element_text: element_text,
      AZ_associated_label: associated_label,
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
    const v = extractBestValue(el);
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

    const v = extractBestValue(el);
    if (CONFIG.CAPTURE_MODE !== 'FINAL_ONLY') {
      sendRows([buildRow(el, 'input', 'change', v)]);
    }
    clearTimeout(FINAL_TIMERS.get(el));
    FINAL_TIMERS.set(el, setTimeout(() => {
      const val = extractBestValue(el);
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
      const val = extractBestValue(el);
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
        r.AZ_page_title = document.title || null;
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
