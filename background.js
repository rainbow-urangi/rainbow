// background.js — Expanded CSV + SNAPSHOT pass-through + API latency/host
/***** 업로드/내보내기 설정 *****/
const REALTIME_UPLOAD = true;
const INGEST_URL = "http://34.22.96.191:8080/ingest/batch";
const INGEST_API_KEY = "9F2A4C7D1E8B0FA3D6C4B1E7A9F03D2";

/***** 유틸 *****/
const pad=(n,z=2)=>String(n).padStart(z,"0");
function dt0(ms){ const d=new Date(ms||Date.now()); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }
function csvEscape(v){ if(v==null) return ""; const s=typeof v==="string"?v:JSON.stringify(v); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
function tsFile(){ const d=new Date(); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
function downloadText(filename, text, mime="text/csv"){ const url="data:"+mime+";charset=utf-8,"+encodeURIComponent("\ufeff"+text); chrome.downloads.download({url,filename,saveAs:false},()=>{ if (chrome.runtime.lastError) console.error("[DOWNLOAD]", chrome.runtime.lastError.message);}); }
function sameHost(u1,u2){ try{ return new URL(u1).host===new URL(u2).host; }catch{return true;} }
function urlPath(u){ try{ return new URL(u).pathname; }catch{return null;} }
function urlHost(u){ try{ return new URL(u).host; }catch{return null;} }
function pickTestId(obj){ if(!obj) return null; return obj["data-testid"]||obj["data-test-id"]||obj["data-qa"]||obj["data-cy"]||null; }
function firstNonEmpty(...a){ return a.find(x=>x!=null && String(x).trim()!=="") ?? null; }
function isSensitiveAttr(attrs){
  const t=(attrs?.type||"").toLowerCase(); const n=(attrs?.name||"").toLowerCase();
  return t==="password" || /pass|pwd|ssn|credit|주민|비번/i.test(n);
}
const ALLOWED_KEYS = new Set(["Enter","Tab","Escape","Backspace","Delete","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"]);

/***** 브라우저 세션 ID *****/
const BROWSER_SESSION_ID = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  if (msg?.type==="HELLO"){
    sendResponse?.({ browser_session_id: BROWSER_SESSION_ID, tab_id: sender?.tab?.id ?? null });
  }
  return true;
});

/***** API 매핑(지연 포함) *****/
const lastApiByTab = new Map(); // tabId -> { url, method, status, startTs, endTs, latencyMs }
chrome.webRequest.onBeforeRequest.addListener((details)=>{
  if (details.tabId>=0 && ["xmlhttprequest","fetch","beacon","ping","main_frame"].includes(details.type)){
    lastApiByTab.set(details.tabId, { url: details.url, method: details.method, status: null, startTs: details.timeStamp, endTs: null, latencyMs: null });
    chrome.tabs.sendMessage(details.tabId, { type:"FLUSH_REQUEST" }).catch(()=>{});
  }
},{ urls:["<all_urls>"] });

chrome.webRequest.onCompleted.addListener((details)=>{
  if (details.tabId>=0){
    const prev = lastApiByTab.get(details.tabId) || {};
    const startTs = prev.startTs ?? details.timeStamp;
    const endTs   = details.timeStamp;
    lastApiByTab.set(details.tabId, {
      url: details.url, method: details.method, status: details.statusCode,
      startTs, endTs, latencyMs: Math.max(0, Math.round(endTs - startTs))
    });
  }
},{ urls:["<all_urls>"] });

chrome.webRequest.onErrorOccurred?.addListener((details)=>{
  if (details.tabId>=0){
    const prev = lastApiByTab.get(details.tabId) || {};
    const startTs = prev.startTs ?? details.timeStamp;
    const endTs   = details.timeStamp;
    lastApiByTab.set(details.tabId, {
      url: details.url, method: details.method, status: -1,
      startTs, endTs, latencyMs: Math.max(0, Math.round(endTs - startTs))
    });
  }
},{ urls:["<all_urls>"] });

/***** 버퍼/업로드 *****/
let DB_BUFFER = [];

async function realtimeUpload(rows, reason){
  if (!REALTIME_UPLOAD || !rows.length) return;
  try{
    const body = JSON.stringify({ reason, rows, ts: Date.now() });
    const headers = { "Content-Type":"application/json" };
    if (INGEST_API_KEY) headers["x-api-key"]=INGEST_API_KEY;
    const res = await fetch(INGEST_URL, { method:"POST", headers, body });
    if (!res.ok) console.warn("[INGEST] non-200", res.status);
  }catch(e){ console.warn("[INGEST] failed", e); }
}

function logAndBuffer(reason, rows){
  if (!rows.length) return;
  console.group(`[DB ROWS] reason=${reason} count=${rows.length}`);
  try{
    console.table(rows, [
      "AZ_event_action","AZ_event_subtype","AZ_url","AZ_url_host","AZ_url_path",
      "AZ_element_type","AZ_element_uid","AZ_element_label",
      "AZ_api_method","AZ_api_status","AZ_api_path","AZ_api_latency_ms",
      "AZ_login_id","AZ_event_time"
    ]);
  }finally{ console.groupEnd(); }
  DB_BUFFER.push(...rows);
  realtimeUpload(rows, reason);
}

/***** CSV 헤더(확장) *****/
const CSV_HEADERS = [
  // 기존 19개
  "AZ_api_url","AZ_api_method","AZ_api_status","AZ_api_path",
  "AZ_ip_address","AZ_url","AZ_login_id","AZ_event_time",
  "AZ_element_uid","AZ_element_type","AZ_element_label","AZ_data",
  "AZ_frame_path","AZ_shadow_path","AZ_form_selector",
  "AZ_locators_json","AZ_nav_root","AZ_menu_li_trail","AZ_post_hints",
  // 확장 메타
  "AZ_event_action","AZ_event_subtype",
  "AZ_page_title","AZ_referrer","AZ_viewport_w","AZ_viewport_h",
  "AZ_url_host","AZ_url_path",
  "AZ_api_host","AZ_api_latency_ms",
  "AZ_session_install_id","AZ_session_browser_id","AZ_session_tab_id","AZ_session_page_id",
  "AZ_selector_css","AZ_selector_xpath","AZ_element_tag",
  "AZ_a11y_role","AZ_aria_label","AZ_aria_labelledby",
  "AZ_form_name","AZ_form_action","AZ_data_testid","AZ_input_length","AZ_is_sensitive",
  "AZ_key","AZ_key_mods",
  "AZ_menu_section","AZ_menu_item",
  "AZ_route_from","AZ_route_to",
  // (신규) 스냅샷
  "AZ_dom_before","AZ_dom_after","AZ_api_response_body"
];

function exportDbCsv(){
  const lines=[CSV_HEADERS.join(",")];
  for (const r of DB_BUFFER) lines.push(CSV_HEADERS.map(h=>csvEscape(r[h])).join(","));
  downloadText(`az_db_rows_${tsFile()}.csv`, lines.join("\n"));
}
function safeExportAllCsv(){
  try{
    if (!DB_BUFFER.length){ downloadText(`az_readme_${tsFile()}.txt`,"No logs yet. Interact, then export.","text/plain"); return; }
    exportDbCsv();
  }catch(e){ console.error("[EXPORT] failed", e); }
}
chrome.action.onClicked.addListener(()=> safeExportAllCsv());
chrome.commands.onCommand.addListener((cmd)=>{ if (cmd==="export-csv") safeExportAllCsv(); });

/***** 공통 변환 *****/
function attachApi(url, tabId){
  const api = lastApiByTab.get(tabId) || {};
  const same = api.url && sameHost(api.url, url);
  return {
    AZ_api_url:    same ? api.url : null,
    AZ_api_method: api.method || null,
    AZ_api_status: api.status ?? null,
    AZ_api_path:   same && api.url ? urlPath(api.url) : null,
    AZ_api_host:   same && api.url ? urlHost(api.url) : null,
    AZ_api_latency_ms: same ? (api.latencyMs ?? null) : null
  };
}
function baseCommon(ev, tabId, loginId){
  const d   = ev.data || {};
  const url = ev.url || "";
  const ts  = ev.timestamp || Date.now();
  const sess= d.meta?.session || {};
  return {
    AZ_ip_address: null, // 확장에서는 수집 불가(서버에서 채우기)
    AZ_url: url, AZ_url_host: urlHost(url), AZ_url_path: urlPath(url),
    AZ_login_id: loginId, AZ_event_time: dt0(ts),
    AZ_selector_css: ev.selector?.css || null, AZ_selector_xpath: ev.selector?.xpath || null,
    AZ_element_tag: (ev.tagName||"").toUpperCase() || null,
    AZ_frame_path: JSON.stringify(d.framePath || []),
    AZ_shadow_path: JSON.stringify(d.shadowPath || []),
    AZ_form_selector: d.form ? (d.form.selector || null) : null,
    AZ_form_name: d.form ? (d.form.name || null) : null,
    AZ_form_action: d.form ? (d.form.action || null) : null,
    AZ_a11y_role: d.a11y?.role ?? d.role ?? null,
    AZ_aria_label: d.a11y?.ariaLabel ?? null,
    AZ_aria_labelledby: d.a11y?.ariaLabelledby ?? null,
    AZ_session_install_id: sess.install_id || null,
    AZ_session_browser_id: sess.browser_session_id || null,
    AZ_session_tab_id: sess.tab_id ?? null,
    AZ_session_page_id: sess.page_session_id || null,
    AZ_data_testid: pickTestId(d.testids || d.dataset),
    AZ_locators_json: JSON.stringify({
      a11y: d.a11y || null, testids: d.testids || d.dataset || null, attrs: d.attributes || null, bounds: d.bounds || null,
      session: d.meta?.session || null, env: d.meta?.env || null
    }),
    // snapshot pass-through
    AZ_dom_before: d.snapshot?.dom_before ?? null,
    AZ_dom_after: d.snapshot?.dom_after ?? null,
    AZ_api_response_body: d.snapshot?.api_response_body ?? null
  };
}

/***** 이벤트 → AZ 행 변환 *****/
function eventToDbRow(ev, tabId, loginId="unknown"){
  const a = ev.action;
  const t = (ev.tagName||"").toUpperCase();
  const d = ev.data || {};
  const url = ev.url || "";
  const base = { ...baseCommon(ev, tabId, loginId), ...attachApi(url, tabId),
    AZ_element_uid: (d.identifier || ev.selector?.css || ev.selector?.xpath || "").toString().slice(0,256),
    AZ_element_type: null, AZ_element_label: null, AZ_data: null,
    AZ_nav_root: d.navRoot || null, AZ_menu_li_trail: null, AZ_post_hints: null,
    AZ_event_action: a || null, AZ_event_subtype: null,
    AZ_page_title: null, AZ_referrer: null, AZ_viewport_w: null, AZ_viewport_h: null,
    AZ_input_length: null, AZ_is_sensitive: null, AZ_key: null, AZ_key_mods: null,
    AZ_menu_section: null, AZ_menu_item: null, AZ_route_from: null, AZ_route_to: null
  };

  // 메뉴 클릭
  if (a==="menu_click"){
    const label = d.label || null;
    const liTrail = Array.isArray(d.liTrail)?d.liTrail:[];
    // 간단 정규화(섹션/아이템)
    const section = liTrail.slice(-1)[0] || label || null;
    const item = label && section && !section.includes(label) ? label : null;

    return {
      ...base,
      AZ_element_type: "menu",
      AZ_element_label: label,
      AZ_data: [
        d.href ? `href=${d.href}` : null,
        liTrail.length ? `trail=${liTrail.join(" > ")}` : null,
        d.role ? `role=${d.role}` : null
      ].filter(Boolean).join(" | ").slice(0,1000),
      AZ_menu_li_trail: liTrail.length ? JSON.stringify(liTrail) : null,
      AZ_menu_section: section || null,
      AZ_menu_item: item || null,
      AZ_page_title: d.title || null
    };
  }

  // 페이지 뷰
  if (a==="page_view"){
    const vp = d.viewport || {};
    const sess = d.meta?.session || {};
    return {
      ...base,
      AZ_element_uid: "PAGE",
      AZ_element_type: "page",
      AZ_page_title: d.title || null,
      AZ_referrer: d.referrer || null,
      AZ_viewport_w: vp.w ?? null,
      AZ_viewport_h: vp.h ?? null,
      AZ_session_install_id: sess.install_id || base.AZ_session_install_id,
      AZ_session_browser_id: sess.browser_session_id || base.AZ_session_browser_id,
      AZ_session_tab_id: (sess.tab_id ?? base.AZ_session_tab_id),
      AZ_session_page_id: sess.page_session_id || base.AZ_session_page_id
    };
  }

  // 라우팅
  if (a==="route_change"){
    return {
      ...base,
      AZ_element_uid: "ROUTE",
      AZ_element_type: "route",
      AZ_event_subtype: "spa",
      AZ_page_title: d.title || null,
      AZ_route_from: d.from || null,
      AZ_route_to: d.to || null
    };
  }

  // form submit (스냅샷 포함)
  if (a==="submit"){
    return {
      ...base,
      AZ_element_type: "event",
      AZ_event_subtype: "submit"
    };
  }

  // 입력/확정값
  if ((["INPUT","TEXTAREA","SELECT"].includes(t) && ["input","change"].includes(a)) || a==="change"){
    const type = (d.attributes?.type || d.inputType || t.toLowerCase() || "").slice(0,32);
    const value = d.value===undefined ? null : d.value;
    const sens = isSensitiveAttr(d.attributes);
    return {
      ...base,
      AZ_element_type: type,
      AZ_element_label: d.label ?? null,
      AZ_data: value,
      AZ_input_length: typeof value==="string" ? value.length : null,
      AZ_is_sensitive: sens ? 1 : 0
    };
  }

  // 전량 이벤트
  if (a==="event"){
    const payload = d.instant || {};
    let key=null, mods=null, subtype = payload.type || null, inputLen=null;
    if (subtype==="keydown" || subtype==="keyup"){
      if (ALLOWED_KEYS.has(payload.key)){ key = payload.key; }
      const m=[]; if(payload.ctrl) m.push("ctrl"); if(payload.alt) m.push("alt"); if(payload.shift) m.push("shift");
      mods = m.length?m.join("+"):null;
    }
    if (subtype==="input") inputLen = typeof payload.length==="number" ? payload.length : null;

    return {
      ...base,
      AZ_element_type: "event",
      AZ_event_subtype: subtype,
      AZ_key: key, AZ_key_mods: mods,
      AZ_input_length: inputLen,
      AZ_data: payload ? JSON.stringify(payload) : null
    };
  }

  return null;
}

/***** 메시지 수신 *****/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async ()=>{
    if (msg?.type !== "BATCH_EVENTS") return;
    const reason = msg.payload?.reason || "";
    const events = Array.isArray(msg.payload?.events) ? msg.payload.events : [];
    const { loginId } = await chrome.storage.local.get("loginId");
    const lid = (typeof loginId==="string" && loginId.trim()) ? loginId.trim() : "unknown";
    const tabId = sender?.tab?.id ?? -1;
    const rows=[];
    for (const ev of events){
      const row = eventToDbRow(ev, tabId, lid);
      if (row) rows.push(row);
    }
    logAndBuffer(reason, rows);
    sendResponse?.({ ok:true, logged: rows.length });
  })();
  return true;
});
