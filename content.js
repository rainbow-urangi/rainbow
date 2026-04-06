// content.js — Rows emitter with snapshots, final-value debounce, menu trail, SPA routing

(() => {
  // ───────────────── Config ─────────────────
  const ALLOWED_HOSTS = ["c4web.c4mix.com"];
  // const ALLOWED_HOSTS = ["jcampusv2.jangan.ac.kr", "jangan.ap.panopto.com"];
  if (!ALLOWED_HOSTS.includes(location.hostname)) {
    return; // 다른 사이트에서는 아무 것도 하지 않고 종료
  }
  const INGEST_API_KEY = "local-dev-test-key-12345";
  // const INGEST_URL = `http://localhost:8080/ingest/batch?api_key=${INGEST_API_KEY}`;
  const CONFIG = {
    TENANT_ID: "test_company",   // ← 배포 시 회사별로 변경
    CAPTURE_MODE: 'FINAL_ONLY',       // 'FINAL_ONLY' | 'PER_EVENT' | 'BOTH'
    KEY_SAMPLING_MS: 120,
    FINAL_DEBOUNCE_MS: 600
  };
  const SNAPSHOT = {
    ENABLED: true,
    AFTER_DELAY_MS: 250,
    MAX_CHARS: 500000
  };

  let isUnloading = false;
  const PAGE_VIEW_DEDUPE_MS = 1200;
  let lastPageViewAt = 0;
  let lastPageViewUrl = null;

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
  let PENDING_LOGIN_ID = null;
  let WORKFLOW_INDEX = 1;          // 워크플로우 인덱스 (submit 경계마다 증가)
  const FINAL_TIMERS = new WeakMap();
  const LAST_SENT = new WeakMap();
  let lastKeyTs = 0;

  // ───────────────── Utils ─────────────────
  const pad = (n, w=2) => String(n).padStart(w, "0");

  /*
  CHANGE NOTE: code_after/content.js 에서는 UTC 기준 초 단위 문자열만 만들었습니다.

  LEGACY_FROM_code_after:
  function dtUtc(ms) {
      const d = new Date(ms || Date.now());
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ` +
            `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  
  현재는 dtUtc9()로 바뀌었습니다.
  변경 이유:
  - 이벤트 충돌과 정렬 불일치를 줄이기 위해 ms 단위를 남긴다.
  - 운영 화면 기준 시간대와 맞추기 위해 KST(+09:00)로 직렬화한다.
  */
  function dtUtc9(ms) {
    const d = new Date(ms || Date.now());
    const kst = new Date(d.getTime() + (9 * 60 * 60 * 1000));
    return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth()+1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}.${pad(kst.getUTCMilliseconds(), 3)}`;
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

    if ((el.tagName || '').toLowerCase() === 'select') {
      const selectedTexts = Array.from(el.selectedOptions).map(opt => opt.text);
      if (selectedTexts.length > 0) {
        return clampText(selectedTexts.join(', '), MAX_ELEMENT_TEXT_CHARS);
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

  // GIT HISTORY NOTE (2ec7e8b -> 5918e02)
  // 초기 커밋의 라벨 추출은 "semantic HTML이 어느 정도 정직하다"는 가정 위에 있었습니다.
  // 실제 운영 페이지에서는 table 기반 폼, fieldset/legend, dl/dt/dd, inline text, select2 같은 커스텀 위젯이 많았고,
  // label[for]나 placeholder만으로는 associated_label 누락이 빈번했습니다.
  //
  // 그래서 현재 구현은 다음 방향으로 확장됐습니다.
  // 1) 기존 semantic 경로(label/aria/placeholder)를 먼저 시도한다.
  // 2) 실패하면 layout 기반 힌트(table, fieldset, dl, sibling text, container title)를 넓게 훑는다.
  // 3) 마지막에 name/id까지 fallback 하여 "완전 null" 비율을 줄인다.
  //
  // 주의:
  // - 정확도보다 회수율(recall)을 올린 형태라, 잘못된 상위 텍스트를 집어올 위험도 같이 커졌다.
  // - 라벨 오탐을 디버깅할 때는 "어느 분기에서 반환됐는지"를 먼저 확인해야 한다.
  //
  // LEGACY SUMMARY FROM 2ec7e8b:
  // - placeholder
  // - label[for=id]
  // - wrapping label
  // - aria-label / aria-labelledby
  // - 근접 container label
  // - placeholder fallback

  /*
  CHANGE NOTE: code_after 의 라벨 추출은 semantic 구조(label/aria/placeholder) 위주였습니다.
  실제 운영 페이지에서 table 폼, fieldset, select2, 동적 위젯이 많아서 회수율이 부족해졌고,
  현재는 layout 기반 탐색까지 포함하는 쪽으로 확장됐습니다.

  LEGACY_FROM_code_after:
  function associatedLabelOf(el){
    if (!isInputLike(el)) return null;

    const placeholder = clampText(el.getAttribute?.('placeholder') || null, MAX_ASSOC_LABEL_CHARS);

    const id = el.id;
    if (id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const t = clampText(visibleTextOf(lbl) || textOf(lbl), MAX_ASSOC_LABEL_CHARS);
        if (t) return t;
      } catch {}
    }

    const wrap = el.closest?.('label');
    if (wrap) {
      const t = clampText(visibleTextOf(wrap) || textOf(wrap), MAX_ASSOC_LABEL_CHARS);
      if (t) return t;
    }

    const aria = clampText(el.getAttribute?.('aria-label') || null, MAX_ASSOC_LABEL_CHARS);
    if (aria) return aria;

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
        const prior = nodes.filter(n => (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));

        for (let i = prior.length - 1; i >= 0; i--) {
          const t = clampText(visibleTextOf(prior[i]) || textOf(prior[i]), MAX_ASSOC_LABEL_CHARS);
          if (t) return t;
        }

        for (let i = nodes.length - 1; i >= 0; i--) {
          const t = clampText(visibleTextOf(nodes[i]) || textOf(nodes[i]), MAX_ASSOC_LABEL_CHARS);
          if (t) return t;
        }
      }
    } catch {}

    return placeholder || null;
  }

  현재 추가된 탐색 범위:
  - select2 container
  - radio/checkbox legend
  - table th/td
  - dl dt/dd
  - inline sibling text
  - generic container title
  - name/id fallback
  - custom widget wrapper fallback
  */
  function associatedLabelOf(el){
    if (!isInputLike(el)) return null;

    const clean = (v) => clampText(v, MAX_ASSOC_LABEL_CHARS);

    // select2 처리 (clean 정의 후에 위치)
    const select2Container = el.closest('.select2-container');
    if (select2Container) {
      const originalId = select2Container.id?.replace('s2id_', '');
      if (originalId) {
        const lbl = document.querySelector(`label[for="${originalId}"]`);
        const t = clean(visibleTextOf(lbl) || textOf(lbl));
        if (t) return t;
      }
      // 이전 형제에서 label 찾기
      let prev = select2Container.previousElementSibling;
      while (prev) {
        const t = clean(visibleTextOf(prev) || textOf(prev));
        if (t) return t;
        prev = prev.previousElementSibling;
      }
    }
  
    const byId = (id) => {
      if (!id) return null;
      const n = document.getElementById(id);
      return clean(visibleTextOf(n) || textOf(n));
    };
  
    // 0) placeholder fallback
    const placeholder = clean(el.getAttribute?.('placeholder') || null);
  
    // 1) explicit label[for=id]
    const id = el.id;
    if (id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const t = clean(visibleTextOf(lbl) || textOf(lbl));
        if (t) return t;
      } catch {}
    }
  
    // 2) wrapped by label
    const wrap = el.closest?.('label');
    if (wrap) {
      const t = clean(visibleTextOf(wrap) || textOf(wrap));
      if (t) return t;
    }
  
    // 3) aria-label / aria-labelledby
    const aria = clean(el.getAttribute?.('aria-label') || null);
    if (aria) return aria;
  
    const labelledby = (el.getAttribute?.('aria-labelledby') || '').trim();
    if (labelledby) {
      const parts = labelledby
        .split(/\s+/)
        .filter(Boolean)
        .map(byId)
        .filter(Boolean);
      if (parts.length) return clean(parts.join(' '));
    }
  
    // 4) radio/checkbox group legend
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    if (type === 'radio' || type === 'checkbox') {
      const fs = el.closest?.('fieldset');
      const lg = fs?.querySelector?.('legend');
      const lt = clean(visibleTextOf(lg) || textOf(lg));
      if (lt) return lt;
  
      // table-row question text (p/th)
      const tr = el.closest?.('tr');
      const q = tr?.querySelector?.('th, p');
      const qt = clean(visibleTextOf(q) || textOf(q));
      if (qt) return qt;
    }
  
    // 5) table layout: th + td input
    // try {
    //   const td = el.closest?.('td');
    //   if (td) {
    //     const tdHint = td.querySelector?.(
    //       'span.pc_hidden,label,.label,[class*="label"],.title,[class*="title"]'
    //     );
    //     const tdHintText = clean(visibleTextOf(tdHint) || textOf(tdHint));
    //     if (tdHintText) return tdHintText;
  
    //     const tr = td.closest?.('tr');
    //     const th = tr?.querySelector?.('th');
    //     const thText = clean(visibleTextOf(th) || textOf(th));
    //     if (thText) return thText;
    //   }
    // } catch {}
    // 5) table layout — 컬럼 인덱스 기반 헤더 탐색
    // colspan을 고려한 컬럼 인덱스 계산
    function getColIndex(cell) {
      const row = cell.parentElement;
      if (!row) return -1;
      let idx = 0;
      for (const child of row.children) {
        if (child === cell) return idx;
        idx += parseInt(child.getAttribute('colspan') || '1', 10);
      }
      return -1;
    }

    // 컬럼 인덱스로 헤더 행의 셀 찾기
    function getHeaderCellAt(table, colIdx) {
      const theadRow = table.querySelector('thead tr');
      const fallbackRow = table.querySelector('tr');
      const row = theadRow || fallbackRow;
      if (!row) return null;

      let pos = 0;
      for (const cell of row.children) {
        if (pos === colIdx) return cell;
        pos += parseInt(cell.getAttribute('colspan') || '1', 10);
      }
      return null;
    }
    try {
      const cell = el.closest?.('td, th');  // td와 th 모두 처리
      if (cell) {
        // 셀 안에 직접 hint 텍스트가 있으면 우선 사용
        const hint = cell.querySelector?.(
          'span.pc_hidden,label,.label,[class*="label"],.title,[class*="title"]'
        );
        const hintText = clean(visibleTextOf(hint) || textOf(hint));
        if (hintText) return hintText;

        // 같은 행에 th가 있으면 사용 (기존 로직 유지)
        if (cell.tagName.toLowerCase() === 'td') {
          const tr = cell.closest('tr');
          const th = tr?.querySelector('th');
          const thText = clean(visibleTextOf(th) || textOf(th));
          if (thText) return thText;
        }

        // 현재 셀이 속한 tr의 바로 이전 tr을 헤더 행으로 사용
        const currentTr = cell.closest('tr');
        const prevTr = currentTr?.previousElementSibling;
        
        if (prevTr && prevTr.tagName.toLowerCase() === 'tr') {
          // colspan 계산 없이 DOM 순서 그대로 매칭
          const cellIndex = [...currentTr.children].indexOf(cell);
          const headerCell = prevTr.children[cellIndex];
        
          if (headerCell) {
            const ariaLabel = headerCell.getAttribute?.('aria-label');
            if (ariaLabel) {
              const colon = ariaLabel.indexOf(':');
              const t = clean(colon >= 0 ? ariaLabel.slice(0, colon) : ariaLabel);
              if (t) return t;
            }
            const t = clean(textOf(headerCell));
            if (t) return t;
          }
        }

        // prevTr이 없으면 table 전체 기준으로 fallback
        if (!prevTr) {
          const table = cell.closest('table');
          if (table) {
            const colIdx = getColIndex(cell);
            if (colIdx >= 0) {
              const headerCell = getHeaderCellAt(table, colIdx);
              if (headerCell && headerCell !== cell) {
                const ariaLabel = headerCell.getAttribute?.('aria-label');
                if (ariaLabel) {
                  const colon = ariaLabel.indexOf(':');
                  const t = clean(colon >= 0 ? ariaLabel.slice(0, colon) : ariaLabel);
                  if (t) return t;
                }
                const t = clean(textOf(headerCell));
                if (t) return t;
              }
            }
          }
        }
      }
    } catch {}

    // 5-2) ARIA 그리드 (div 기반 그리드)
    try {
      const gridCell = el.closest('[role="gridcell"],[role="cell"]');
      if (gridCell) {
        const grid = gridCell.closest('[role="grid"],[role="treegrid"]');
        if (grid) {
          const colIdx = parseInt(gridCell.getAttribute('aria-colindex') || '-1', 10) - 1;
          if (colIdx >= 0) {
            const headers = grid.querySelectorAll('[role="columnheader"]');
            const t = clean(visibleTextOf(headers[colIdx]) || textOf(headers[colIdx]));
            if (t) return t;
          }
        }
      }
    } catch {}
  
    // 6) definition list: dt + dd
    const dd = el.closest?.('dd');
    if (dd) {
      const dl = dd.parentElement;
      if (dl) {
        const dts = [...dl.children].filter((n) => (n.tagName || '').toLowerCase() === 'dt');
        const dds = [...dl.children].filter((n) => (n.tagName || '').toLowerCase() === 'dd');
        const idx = dds.indexOf(dd);
        if (idx >= 0 && dts[idx]) {
          const t = clean(visibleTextOf(dts[idx]) || textOf(dts[idx]));
          if (t) return t;
        }
      }
    }
  
    // 7) inline left text: "전공 <input ...>"
    let prev = el.previousSibling;
    while (prev) {
      if (prev.nodeType === Node.TEXT_NODE) {
        const t = clean(prev.textContent);
        if (t) return t;
      } else if (prev.nodeType === Node.ELEMENT_NODE) {
        const tag = (prev.tagName || '').toLowerCase();
        if (!['input','textarea','select','button','option'].includes(tag)) {
          const t = clean(visibleTextOf(prev) || textOf(prev));
          if (t) return t;
        }
      }
      prev = prev.previousSibling;
    }
  
    // 8) common container label/title
    try {
      const container =
        el.closest('.form-group,.field,.field-row,.row,td,th,div,form,fieldset') || null;
      if (container) {
        const nodes = [
          ...container.querySelectorAll(
            'label,[role="label"],.label,[class*="label"],.title,[class*="title"],h1,h2,h3,h4,h5,h6,p'
          ),
        ].filter((n) => n && n !== el);
  
        const prior = nodes.filter(
          (n) => (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
  
        for (let i = prior.length - 1; i >= 0; i--) {
          const t = clean(visibleTextOf(prior[i]) || textOf(prior[i]));
          if (t) return t;
        }
  
        for (let i = nodes.length - 1; i >= 0; i--) {
          const t = clean(visibleTextOf(nodes[i]) || textOf(nodes[i]));
          if (t) return t;
        }
      }
    } catch {}
  
    // 9) fallback: placeholder -> name -> id
    const name = clean(el.getAttribute?.('name') || null);
    if (placeholder) return placeholder;
    if (name) return name;

    // 10) 커스텀 위젯 컨테이너 수준으로 올라가서 라벨 탐색
    // id/name 없는 동적 생성 input (select2, tom-select 등)이 여기 도달
    if (!el.id && !el.getAttribute('name')) {
      // 위젯 컨테이너 후보: aria 속성이 있거나 role이 있는 가장 가까운 조상
      const widgetRoot =
        el.closest('[aria-haspopup],[role="combobox"],[role="listbox"],[role="group"]') ||
        el.parentElement?.parentElement?.parentElement; // 최대 3단계 위까지

      if (widgetRoot) {
        // 컨테이너의 이전 형제에서 라벨 텍스트 탐색
        let sib = widgetRoot.previousElementSibling;
        let depth = 0;
        while (sib && depth < 3) {
          const tag = (sib.tagName || '').toLowerCase();
          if (!['input','textarea','select','button'].includes(tag)) {
            const t = clean(visibleTextOf(sib) || textOf(sib));
            if (t) return t;
          }
          sib = sib.previousElementSibling;
          depth++;
        }

        // 컨테이너를 감싸는 행(tr/div)/그룹에서 label 탐색
        const row = widgetRoot.closest('tr,td,.form-group,.field,.row,[class*="field"]');
        if (row) {
          const lbl = row.querySelector('label,th,.label,[class*="label"],.title,[class*="title"]');
          if (lbl && lbl !== widgetRoot) {
            const t = clean(visibleTextOf(lbl) || textOf(lbl));
            if (t) return t;
          }
        }
      }
    }

    return clean(el.id || null);
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
  function isToggleInput(el){
    if (!(el instanceof Element)) return false;
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && ['checkbox', 'radio'].includes(type)) return true;
    if (tag === 'label'){
      const ctrl = el.control || (el.htmlFor ? document.getElementById(el.htmlFor) : null);
      if (ctrl && ['checkbox', 'radio'].includes((ctrl.type || '').toLowerCase())) return true;
    }
    return false;
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
    const type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && /password/i.test(type)) return null;
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
      return el.checked ? (el.value || 'on') : 'off';
    }
    if (tag === 'input' || tag === 'textarea') return el.value ?? null;
    if (tag === 'select') {
      const selectedOption = el.options[el.selectedIndex];
      return selectedOption ? (selectedOption.text || el.value) : el.value ?? null;
    }
    if (el.isContentEditable) return el.innerText || el.textContent || null;
    return null;
  }

  // 🔥 NEW: input/button/div/grid 대응용 value extractor
  function extractBestValue(el) {
    if (!el) return null;

    // 1) input / textarea / contenteditable
    let v = normalizeInputValue(el);
    if (v !== null && v !== undefined) return v;

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
    const eventTsMs = Date.now();
    const before = takeDomSnapshot(el);
    setTimeout(()=>{ const after = takeDomSnapshot(el); try{ done({ dom_before: before, dom_after: after, eventTsMs }); }catch{}; }, SNAPSHOT.AFTER_DELAY_MS);
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
  function stageLoginId(raw) {
    const v = (typeof raw === 'string' && raw.trim()) ? raw.trim().slice(0, 128) : null;
    if (!v) return null;
    PENDING_LOGIN_ID = v;
    return v
  }
  function commitLoginId(raw = PENDING_LOGIN_ID) {
    const v = stageLoginId(raw);
    if (!v) return null;
    LOGIN_ID = v;
    try {
      chrome.storage.local.set({ loginId: v })
    } catch {}
    return v;
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
        commitLoginId(v);
      }
    }catch{}
  }
  /*
  CHANGE NOTE: code_after 에는 클라이언트 workflow index 저장/복원 개념이 없었습니다.

  LEGACY_FROM_code_after:
  // 없음: submit 이후 다음 페이지에서도 같은 업무 흐름 번호를 이어가기 위한
  // storage.local 기반 workflowState 관리가 없었음
  현재는 browser_id 기준으로 workflowState를 저장하고 복원합니다.
  의도:
  - 페이지 이동 후에도 같은 브라우저 흐름 안에서 workflow index를 이어가기 위함
  - 서버의 actor workflow 계산과 클라이언트 submit 경계를 함께 활용하기 위함
  부작용:
  - submit이 없는 탐색형 업무는 index가 오래 유지될 수 있다.
  - storage.local 값이 남아 있으면 다음 세션에도 이어질 수 있다.
  */
  async function loadWorkflowIndex() {
    try {
      const { workflowState } = await chrome.storage.local.get('workflowState');
      if (workflowState?.browserId === BROWSER_ID && workflowState?.index >= 1) {
        WORKFLOW_INDEX = workflowState.index;
      }
    } catch {}
  }
  function incrementWorkflowIndex() {
    WORKFLOW_INDEX += 1;
    try {
      chrome.storage.local.set({ workflowState: { browserId: BROWSER_ID, index: WORKFLOW_INDEX } });
    } catch {}
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
      if (val) stageLoginId(val);
    }, true);
  }
  function captureLoginIdOnBlur() {
    addEventListener('blur', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      const t = (el.type || '').toLowerCase();
      if (t !== 'text' && t !== 'email') return;
      const n = (el.getAttribute('name') || '').toLowerCase();
      const i = (el.id || '').toLowerCase();
      const p = (el.getAttribute('placeholder') || '').toLowerCase();
      if (!/(login|userid|user|email|account|아이디|사번)/.test(n+i+p)) return;
      const val = (el.value || '').trim();
      if (val.length < 3) return;
      const v = val.slice(0, 128);
      chrome.storage.local.set({ loginId: v });
      LOGIN_ID = v;
      stageLoginId(val);
    }, true); // capture:true → onBlur buildRow 이전에 실행
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
    const eventTsMs = Number.isFinite(extra?.eventTsMs) ? extra.eventTsMs : Number.isFinite(extra?.snapshot?.eventTsMs) ? extra.snapshot.eventTsMs : Date.now();
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
      AZ_event_time: dtUtc9(eventTsMs),
      AZ_event_ts_ms: eventTsMs,
      AZ_workflow_index: WORKFLOW_INDEX,
      AZ_tenant_id: CONFIG.TENANT_ID,

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
    const el = (e.composedPath && e.composedPath()[0]) instanceof Element ? e.composedPath()[0] : (e.target instanceof Element ? e.target : null);
    if (!el || isToggleInput(el)) return;

    let clickableBase = el.closest(CLICKABLE_SELECTOR)

    // 비 표준 태그 버튼 처리
    if (!clickableBase) {
      const cls = (el.className || '').toString().toLowerCase();
      if (cls.includes('btn') || cls.includes('button')|| cls.includes('nav') || cls.includes('menu') || el.hasAttribute('tabindex')) {
        clickableBase = el;
      }
    }

    if (!clickableBase) return; // 기능이 없는 요소 드랍

    // 드롭다운 메뉴 항목 클릭 시 즉시 텍스트 캡쳐
    // 드롭다운 메뉴 Selector 정의 (role 기반 포함)
    const MENU_SELECTOR = [
      '.dropdown-menu a',
      '.dropdown-menu button',
      '.dropdown-menu [role="menuitem"]',
      '.dropdown-menu [role="option"]',
      '[role="menuitem"]',
      '[role="option"]',
      'select'
    ].join(', ');

    const menuItem = el.closest?.(MENU_SELECTOR);
    // 우선 순위: 보이는 텍스트(visibleTextOf)>기본 텍스트(textOf)>aria-label>title(attr 포함)>innerText
    if (menuItem) {
      const itemText = (
        visibleTextOf(menuItem) ||
        textOf(menuItem) ||
        menuItem.getAttribute?.('aria-label') ||
        menuItem.title ||
        menuItem.innerText ||
        ''
      ).trim() || null; // 빈 문자열이면 null
  
      withDomSnapshot(menuItem, snap => {
        const row = buildRow(menuItem, 'menu', 'menu_click', itemText, { snapshot: snap });
        // buildRow가 element_text를 못 채운 케이스 대비
        if (!row.AZ_element_text) row.AZ_element_text = itemText;
        sendRows([row]);
      });
      return; // 드롭다운 항목은 여기서 종료(아래 로직 중복 기록 방지)
    }

    const isMenu = isMenuElement(clickableBase);

    if (isMenu) {
      withDomSnapshot(clickableBase, snap => {
        const row = buildRow(clickableBase, 'menu', 'menu_click', textOf(clickableBase), { snapshot: snap });
        sendRows([row]);
      });
    } else {
      const _t = (clickableBase.tagName || '').toLowerCase();
      if (_t === 'body' || _t === 'html') return;
      const clickText = visibleTextOf(clickableBase) || textOf(clickableBase) || null;
      const row = buildRow(clickableBase, 'event', 'click', null);
      if (!row.AZ_element_text && clickText) row.AZ_element_text = clickText;
      sendRows([row]);
    }
  }

  // focus 이벤트 (노이즈 고려)
  function onFocus(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    if (!isInputLike(el)) return;
    if (isToggleInput(el)) return;
    if (isSensitive(el)) return;
    sendRows([buildRow(el, 'event', 'focus', null)]);
  }

  function onBlur(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    if (!isInputLike(el) ||
        isToggleInput(el) ||
        isSensitive(el)) return;
    const v = extractBestValue(el);
    if (v === null || v === undefined) return;
    if ((v ?? '') === (LAST_SENT.get(el) ?? '')) return;
    LAST_SENT.set(el, v);
    withDomSnapshot(el, snap => {
      const row = buildRow(el, 'event', 'blur', v, { snapshot: snap });
      sendRows([row]);
    });
  }

  // function onInput(e) {
  //   const el = e.target instanceof Element ? e.target : null;
  //   if (!el) return;
  //   if (isToggleInput(el)) return;
  //   if (!isInputLike(el)) return;
  //   if (isSensitive(el)) return;
  //   const now = Date.now();
  //   if ((now - lastKeyTs) < CONFIG.KEY_SAMPLING_MS) return;
  //   lastKeyTs = now;

  //   const v = extractBestValue(el);
  //   if (CONFIG.CAPTURE_MODE !== 'FINAL_ONLY') {
  //     sendRows([buildRow(el, 'input', 'change', v)]);
  //   }
  //   clearTimeout(FINAL_TIMERS.get(el));
  //   FINAL_TIMERS.set(el, setTimeout(() => {
  //     const val = extractBestValue(el);
  //     if (!val && val !== 0 && val !== false) return;
  //     if ((val ?? '') === (LAST_SENT.get(el) ?? '')) return;
  //     LAST_SENT.set(el, val);
  //     withDomSnapshot(el, snap => {
  //       const r = buildRow(el, 'input', 'change', val, { snapshot: snap });
  //       sendRows([r]);
  //     });
  //   }, CONFIG.FINAL_DEBOUNCE_MS));
  // }

  function onKeydown(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;

    // Enter 키를 사용하여 제출/이동 시 클릭과 동일하게 처리
    if ((e.key === 'Enter' || e.key === ' ') && !isInputLike(el)) {
      flushInputNow(el, 'change');
    }

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
    if (e.key === 'Enter' && isInputLike(el) && !isSensitive(el)) {
      // 1) 입력값 즉시 flush
      flushInputNow(el, 'change');
    
      // 2) 검색 액션을 클릭 유사 이벤트로 1건 기록
      const searchBtn =
        document.querySelector('#search_course') ||
        document.querySelector('[onclick*="fnSearch"]') ||
        document.querySelector('a.btn.btn_sm.btn_bg_gray');
    
      if (searchBtn instanceof Element) {
        const label = (visibleTextOf(searchBtn) || textOf(searchBtn) || 'Enter Search').trim();
    
        const row = buildRow(searchBtn, 'event', 'click', null);
        row.AZ_element_text = label;
        row.AZ_associated_label = label;
        row.AZ_event_subtype = 'enter_search'; // Enter 유입 구분용
        sendRows([row]);
      }
    }
  }

  /*
  CHANGE NOTE: code_after 와 초기 커밋의 submit/input/page_view 처리는 지금보다 단순했습니다.
  현재는 submitter 텍스트를 보강하고, submit 이후 workflow index 를 증가시키며,
  page_view도 최초 진입/탭 복귀/중복 억제를 나눠 처리합니다.
  
  LEGACY_FROM_code_after:
  function onSubmit(e) {
    const f = e.target instanceof HTMLFormElement ? e.target : null;
    if (!f) return;
    withDomSnapshot(f, snap => {
      const row = buildRow(f, 'event', 'submit', null, { snapshot: snap });
      sendRows([row]);
    });
  }
  
  LEGACY_FROM_code_after:
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
    LEGACY_FROM_code_after:
    function sendPageView() {
      const row = buildRow(document.documentElement, 'page', 'page_view', null);
      row.AZ_element_uid = 'PAGE';
      row.AZ_selector_css = 'PAGE';
      row.AZ_selector_xpath = '/html[1]';
      row.AZ_element_tag = 'html';
      sendRows([row]);
    }
  
    현재 구조의 의도:
    - submit 버튼 텍스트까지 남겨 후처리 해석력을 높임
    - submit 이후 다음 이벤트를 새 workflow로 넘김
    - page_view를 initial/resume/once 흐름으로 분리해 중복과 누락을 같이 줄임
    */
  function onSubmit(e) {
    const f = e.target instanceof HTMLFormElement ? e.target : null;
    if (!f) return;

    // 실제 submit 요소 찾기
    const submitter = e.submitter instanceof Element ? e.submitter : null;
    const submitterBase = (submitter && submitter.closest)
      ? (submitter.closest(CLICKABLE_SELECTOR) || submitter) : submitter;

    // 버튼 내부 자식(span, i) 텍스트 추출
    const submitterText = submitterBase ? visibleTextOf(submitterBase) : null;
    
    withDomSnapshot(f, snap => {
      const row = buildRow(f, 'event', 'submit', null, { snapshot: snap });
      // 텍스트 보강
      if (submitterText) row.AZ_element_text = submitterText;
      sendRows([row]);
      commitLoginId();
      incrementWorkflowIndex(); // submit 경계 → 다음 이벤트부터 새 워크플로우
    });
  }

  function emitPageView(state = document.visibilityState, subtype = null) {
    const row = buildRow(document.documentElement, 'page', 'page_view', state);
    row.AZ_element_uid = 'PAGE';
    row.AZ_selector_css = 'PAGE';
    row.AZ_selector_xpath = '/html[1]';
    row.AZ_element_tag = 'html';
    if (subtype) row.AZ_event_subtype = subtype;
    sendRows([row]);
  
    lastPageViewAt = Date.now();
    lastPageViewUrl = location.href;
  }
  
  function emitResumePageView(reason) {
    if (window !== window.top) return;
    if (isUnloading) return;
    if (document.visibilityState !== 'visible') return;
  
    const now = Date.now();
    if (lastPageViewUrl === location.href && (now - lastPageViewAt) < PAGE_VIEW_DEDUPE_MS) {
      return;
    }
  
    emitPageView('visible', reason);
  }
  
  function sendPageView() {
    emitPageView(document.visibilityState, 'initial');
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

  function findNavLikeTarget(t) {
    if (!(t instanceof Element)) return null;
  
    // 1) 일반 링크 + javascript 링크 + role 기반
    const el = t.closest(
      'a[href],a[href^="javascript:"],button,' +
      '[role="tab"],[role="menuitem"],[role="link"],[onclick],[data-url],[data-href]'
    );
    if (!el) return null;
  
    // 2) 메뉴/탭 컨텍스트 판정 (ul/li 포함)
    const inMenuLike = !!el.closest(
      'nav,[role="navigation"],[role="tablist"],[role="menu"],' +
      'ul,ol,.menu,.submenu,.tab,.tabs,.tabmenu,[class*="menu"],[class*="tab"],[class*="nav"]'
    );
  
    return inMenuLike ? el : null;
  }
  
  function extractTargetUrl(el) {
    if (!el) return null;
    const href = el.getAttribute?.('href') || null;
  
    // javascript:changeToDoList('complete') 같은 케이스도 기록
    if (href && href.startsWith('javascript:')) return href;
  
    return (
      href ||
      el.getAttribute?.('data-url') ||
      el.getAttribute?.('data-href') ||
      null
    );
  }

  function flushInputNow(el, action = 'change') {
    if (!el || !(el instanceof Element)) return;
    if (!isInputLike(el) || isToggleInput(el) || isSensitive(el)) return;
  
    const val = extractBestValue(el);
    if (val === null || val === undefined) return;
    if ((val ?? '') === (LAST_SENT.get(el) ?? '')) return;
  
    clearTimeout(FINAL_TIMERS.get(el));
    LAST_SENT.set(el, val);
  
    const row = buildRow(el, 'input', action, val); // withDomSnapshot 쓰지 않음
    sendRows([row]); // 즉시 전송
  }

  // ─────────────── Init ───────────────
  (async function init(){
  if (window === window.top) {
    // pagehide에서 종료 플래그도 세팅 (중복 전송 방지 일관성)
    window.addEventListener('pagehide', () => { isUnloading = true; }, { capture: true });
    window.addEventListener('beforeunload', () => { isUnloading = true; }, { capture: true });

    document.addEventListener('pointerdown', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
    
      const a = findNavLikeTarget(t);   // 단일 판정만 사용
      if (!a) return;
    
      const href = extractTargetUrl(a); // javascript: 포함
      const label = (visibleTextOf(a) || a.textContent || '').trim();
      if (!label) return;
    
      chrome.runtime.sendMessage({
        type: 'NAV_CLICK_STORE',
        payload: {
          ts: Date.now(),
          from_url: location.href,
          href: href || location.href,
          label
        }
      });
    }, { capture: true });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== 'AZ_PAGE_RESUME_HINT') return;
      if (!msg?.tab_changed) return; // tab_id 변경 신호만 허용
      emitResumePageView(msg.reason || 'tab_switch');
    });
  }

  function sendPageViewOnce() {
    if (window !== window.top) return;
  
    // 같은 문서에서 중복 전송 방지(예: 일부 사이트에서 content script가 재주입되는 케이스 대비)
    const key = '__az_page_view_sent__';
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1');
  
    emitPageView(document.visibilityState, 'first_in_doc');
  }

    await ensureInstallId();
    await loadLoginId();
    await handshake();
    await loadWorkflowIndex();
    guessLoginId();
    captureLoginIdOnSubmit();
    captureLoginIdOnBlur();
    injectFetchHook();
    sendPageViewOnce();

    try {
      const res = await chrome.runtime.sendMessage({ type: 'NAV_CLICK_POP' });
      const p = res?.payload;
      if (p && Date.now() - p.ts < 10_000) { // 10초 이내만 유효
        const row = buildRow(document.documentElement, 'event', 'click', p.label);
        row.AZ_element_uid = 'PAGE';
        row.AZ_element_tag = 'html';
        row.AZ_associated_label = p.label;
        row.AZ_referrer_url = p.from_url;   // 있으면 좋음(컬럼 없으면 무시)
        row.AZ_target_url = p.href;         // 있으면 좋음
        sendRows([row]);
      }
    } catch (_) {}

    addEventListener('pointerdown', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
    
      const isSearchTrigger = !!t.closest('#search_course, [onclick*="fnSearch"], a.btn.btn_sm.btn_bg_gray');
      if (!isSearchTrigger) return;
    
      const searchInput = document.querySelector('#search_word');
      if (searchInput instanceof Element) flushInputNow(searchInput, 'change');
    }, true);

    addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', () => {
      if (window !== window.top) return;
      if (isUnloading) return;
      const row = buildRow(document.documentElement, 'event', 'visibility_change', document.visibilityState);
      sendRows([row]);
    }, true);
    // focus 이벤트 (노이즈 고려)
    addEventListener('focus', onFocus, true);
    // addEventListener('blur', onBlur, true); // blur는 업무 의미보다 노이즈가 많아 기본 수집에서 제외
    // addEventListener('input', onInput, true);
    addEventListener('change', (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el ||
          !isInputLike(el) ||
          isSensitive(el)) return;

      const tag = (el.tagName || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();

      const isInstantChange = tag === 'select' || isToggleInput(el) || ['file', 'color', 'range', 'date', 'time', 'datetime-local', 'month', 'week'].includes(type);

      if (isInstantChange) {
        const val = extractBestValue(el);
        if (val === null && val !== 0 && val !== false) return;
        if ((val ?? '') === (LAST_SENT.get(el) ?? '')) return;
        LAST_SENT.set(el, val);
        setTimeout(() => {
          withDomSnapshot(el, snap => {
            sendRows([buildRow(el, 'input', 'change', val, { snapshot: snap })]); 
          });
        }, 50); 
        return;
      }
      // if (isToggleInput(el)) {
      //   const val = extractBestValue(el);
      //   if (!val && val !== 0 && val !== false) return;
      //   if ((val ?? '') === (LAST_SENT.get(el) ?? '')) return;
      //   LAST_SENT.set(el, val);
      //   withDomSnapshot(el, snap => {
      //     sendRows([buildRow(el, 'input', 'change', val, { snapshot: snap })]);
      //   });
      //   return;
      // }

      clearTimeout(FINAL_TIMERS.get(el));
      FINAL_TIMERS.set(el, setTimeout(() => {
        const val = extractBestValue(el);
        if (!val && val !== 0 && val !== false) return;
        if ((val ?? '') === (LAST_SENT.get(el) ?? '')) return;
        LAST_SENT.set(el, val);
        withDomSnapshot(el, snap => {
          sendRows([buildRow(el, 'input', 'change', val, { snapshot: snap })]);
        });
      }, 300));
    }, true);
    
    addEventListener('keydown', onKeydown, true);
    addEventListener('submit', onSubmit, true);

    setupSpaHooks();

    // if (window === window.top) { // 최상위 본창일 때만 페이지 뷰 수집
    //   if (document.readyState === 'complete' || document.readyState === 'interactive') sendPageView();
    //   else addEventListener('DOMContentLoaded', sendPageView, { once: true });
    // }
  })();
})();
