// background.js — Full Event Pipeline: API mapping, meaningful STATE, menu trail normalization,
// CSV export + optional realtime upload

/***** 업로드/내보내기 설정 *****/
const REALTIME_UPLOAD = false; // 실시간 업로드 사용 시 true
const INGEST_URL = "https://your.api.example/ingest/batch"; // 실시간 업로드 API
const INGEST_API_KEY = ""; // 필요 시

/***** 유틸 *****/
const pad=(n,z=2)=>String(n).padStart(z,"0");
function dt0(ms){ const d=new Date(ms||Date.now()); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }
function csvEscape(v){ if(v==null) return ""; const s=typeof v==="string"?v:JSON.stringify(v); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
function tsFile(){ const d=new Date(); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
function downloadText(filename, text, mime="text/csv"){ const url="data:"+mime+";charset=utf-8,"+encodeURIComponent("\ufeff"+text); chrome.downloads.download({url,filename,saveAs:false},()=>{ if (chrome.runtime.lastError) console.error("[DOWNLOAD]", chrome.runtime.lastError.message);}); }
function sameHost(u1,u2){ try{ return new URL(u1).host===new URL(u2).host; }catch{return true;} }
function urlPath(u){ try{ return new URL(u).pathname; }catch{return null;} }

/***** 브라우저 세션 ID 발급 *****/
const BROWSER_SESSION_ID = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  if (msg?.type==="HELLO"){
    sendResponse?.({ browser_session_id: BROWSER_SESSION_ID, tab_id: sender?.tab?.id ?? null });
  }
  return true;
});

/***** API 매핑 *****/
const lastApiByTab = new Map(); // tabId -> { url, method, status, timeStamp }
chrome.webRequest.onBeforeRequest.addListener((details)=>{
  if (details.tabId>=0 && ["xmlhttprequest","fetch","beacon","ping","main_frame"].includes(details.type)){
    lastApiByTab.set(details.tabId, { url: details.url, method: details.method, status: null, timeStamp: details.timeStamp });
    chrome.tabs.sendMessage(details.tabId, { type:"FLUSH_REQUEST" }).catch(()=>{});
  }
},{ urls:["<all_urls>"] });

chrome.webRequest.onCompleted.addListener((details)=>{
  if (details.tabId>=0){
    const prev = lastApiByTab.get(details.tabId) || {};
    lastApiByTab.set(details.tabId, { ...prev, url: details.url, method: details.method, status: details.statusCode, timeStamp: details.timeStamp });
  }
},{ urls:["<all_urls>"] });

/***** STATE(후행신호) 과다 억제 *****/
const lastStateByTab = new Map(); // tabId -> { title, modal, alert, t }
const POST_STATE_DEBOUNCE_MS = 600;
function meaningful(prev, cur){
  if (!prev) return true;
  const keys=["title","modal","alert"];
  return keys.some(k => (cur?.[k]||null) && (cur?.[k]||null)!==(prev?.[k]||null));
}

/***** 메뉴 경로 정규화 *****/
function normalizeMenuTrail(label, liTrail=[]){
  const clean = Array.isArray(liTrail) ? liTrail.filter(Boolean).map(s=>String(s).trim()) : [];
  if (!clean.length) return label ? [label] : null;
  if (clean.length===1){ const section=clean[0]; if (!label || section.includes(label)) return [section]; return [section, label]; }
  const section = clean[clean.length-1];
  const fallbackItem = clean.find(s=> s!==section && s.length<=30) || section;
  const last = (label && !section.includes(label)) ? label : fallbackItem;
  if (section===last) return [section];
  return [section, last];
}

/***** 버퍼/CSV/업로드 *****/
let DB_BUFFER = [];

async function realtimeUpload(rows, reason){
  if (!REALTIME_UPLOAD || !rows.length) return;
  try{
    const body = JSON.stringify({ reason, rows, ts: Date.now() });
    const headers = { "Content-Type":"application/json" };
    if (INGEST_API_KEY) headers["x-api-key"]=INGEST_API_KEY;
    const res = await fetch(INGEST_URL, { method:"POST", headers, body, keepalive:true });
    if (!res.ok) console.warn("[INGEST] non-200", res.status);
  }catch(e){ console.warn("[INGEST] failed", e); }
}

function logAndBuffer(reason, rows){
  if (!rows.length) return;
  console.group(`[DB ROWS] reason=${reason} count=${rows.length}`);
  try{
    console.table(rows, [
      "AZ_api_url","AZ_api_method","AZ_api_status","AZ_api_path",
      "AZ_url","AZ_event_time","AZ_element_type","AZ_element_uid","AZ_element_label","AZ_data","AZ_login_id"
    ]);
  }finally{ console.groupEnd(); }
  DB_BUFFER.push(...rows);
  // 실시간 업로드 옵션
  realtimeUpload(rows, reason);
}

function exportDbCsv(){
  const headers = [
    "AZ_api_url","AZ_api_method","AZ_api_status","AZ_api_path",
    "AZ_ip_address","AZ_url","AZ_login_id","AZ_event_time",
    "AZ_element_uid","AZ_element_type","AZ_element_label","AZ_data",
    "AZ_frame_path","AZ_shadow_path","AZ_form_selector",
    "AZ_locators_json","AZ_nav_root","AZ_menu_li_trail","AZ_post_hints"
  ];
  const lines=[headers.join(",")];
  for (const r of DB_BUFFER) lines.push(headers.map(h=>csvEscape(r[h])).join(","));
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

/***** 이벤트 → 표준 행 변환 *****/
function eventToDbRow(ev, tabId, loginId="unknown"){
  const a = ev.action;
  const t = (ev.tagName||"").toUpperCase();
  const d = ev.data || {};
  const url = ev.url || "";
  const ts  = ev.timestamp || Date.now();
  const api = lastApiByTab.get(tabId) || {};

  // 메뉴
  if (a==="menu_click"){
    const uid = (d.identifier || ev.selector?.css || ev.selector?.xpath || "").toString().slice(0,256);
    const label = d.label || null;
    const compact = [
      d.href ? `href=${d.href}` : null,
      d.liTrail?.length ? `trail=${(d.liTrail||[]).join(" > ")}` : null,
      d.role ? `role=${d.role}` : null
    ].filter(Boolean).join(" | ").slice(0,1000);

    const normTrail = normalizeMenuTrail(label, d.liTrail || []);
    return {
      AZ_ip_address: "(unavailable-in-extension)",
      AZ_url: url, AZ_login_id: loginId, AZ_event_time: dt0(ts),
      AZ_element_uid: uid, AZ_element_type: "menu", AZ_element_label: label, AZ_data: compact,
      AZ_api_url: api.url && sameHost(api.url, url) ? api.url : null,
      AZ_api_method: api.method || null, AZ_api_status: api.status ?? null, AZ_api_path: api.url && sameHost(api.url, url) ? urlPath(api.url) : null,
      AZ_frame_path: JSON.stringify(d.framePath || []),
      AZ_shadow_path: JSON.stringify(d.shadowPath || []),
      AZ_form_selector: null,
      AZ_locators_json: null,
      AZ_nav_root: d.navRoot || null,
      AZ_menu_li_trail: normTrail ? JSON.stringify(normTrail) : (d.liTrail?.length ? JSON.stringify(d.liTrail) : null),
      AZ_post_hints: null
    };
  }

  // 후행신호 STATE
  if (a==="post_state"){
    const cur = d.postHints || null;
    const last = lastStateByTab.get(tabId);
    const now = Date.now();
    const elapsed = now - (last?.t || 0);
    if (!meaningful(last, cur) || elapsed < POST_STATE_DEBOUNCE_MS) return null;
    lastStateByTab.set(tabId, { ...cur, t: now });

    return {
      AZ_ip_address: "(unavailable-in-extension)",
      AZ_url: url, AZ_login_id: loginId, AZ_event_time: dt0(ts),
      AZ_element_uid: "STATE", AZ_element_type: "state", AZ_element_label: null, AZ_data: null,
      AZ_api_url: api.url && sameHost(api.url, url) ? api.url : null,
      AZ_api_method: api.method || null, AZ_api_status: api.status ?? null, AZ_api_path: api.url && sameHost(api.url, url) ? urlPath(api.url) : null,
      AZ_frame_path: JSON.stringify(d.framePath || []),
      AZ_shadow_path: null, AZ_form_selector: null, AZ_locators_json: null, AZ_nav_root: null, AZ_menu_li_trail: null,
      AZ_post_hints: JSON.stringify(cur || null)
    };
  }

  // 입력/확정값
  if ((["INPUT","TEXTAREA","SELECT"].includes(t) && ["input","change"].includes(a)) || a==="change"){
    const type = (d.attributes?.type || d.inputType || t.toLowerCase() || "").slice(0,32);
    const uid  = (d.identifier || ev.selector?.css || ev.selector?.xpath || "").toString().slice(0,256);
    const label = d.label ?? null;
    const value = d.value===undefined ? null : d.value;

    return {
      AZ_ip_address: "(unavailable-in-extension)",
      AZ_url: url, AZ_login_id: loginId, AZ_event_time: dt0(ts),
      AZ_element_uid: uid, AZ_element_type: type, AZ_element_label: label, AZ_data: value,
      AZ_api_url: api.url && sameHost(api.url, url) ? api.url : null,
      AZ_api_method: api.method || null, AZ_api_status: api.status ?? null, AZ_api_path: api.url && sameHost(api.url, url) ? urlPath(api.url) : null,
      AZ_frame_path: JSON.stringify(d.framePath || []),
      AZ_shadow_path: JSON.stringify(d.shadowPath || []),
      AZ_form_selector: d.form ? (d.form.selector || null) : null,
      AZ_locators_json: JSON.stringify({
        a11y: d.a11y || null, testids: d.testids || null, attrs: d.attributes || null, bounds: d.bounds || null,
        session: d.meta?.session || null, env: d.meta?.env || null
      }),
      AZ_nav_root: null, AZ_menu_li_trail: null, AZ_post_hints: null
    };
  }

  // 전량 이벤트(event)
  if (a==="event"){
    const uid  = (ev.selector?.css || ev.selector?.xpath || "").toString().slice(0,256);
    const label = d.label ?? null;
    const payload = d.instant ? JSON.stringify(d.instant) : null;

    return {
      AZ_ip_address: "(unavailable-in-extension)",
      AZ_url: url, AZ_login_id: loginId, AZ_event_time: dt0(ts),
      AZ_element_uid: uid, AZ_element_type: "event", AZ_element_label: label, AZ_data: payload,
      AZ_api_url: api.url && sameHost(api.url, url) ? api.url : null,
      AZ_api_method: api.method || null, AZ_api_status: api.status ?? null, AZ_api_path: api.url && sameHost(api.url, url) ? urlPath(api.url) : null,
      AZ_frame_path: JSON.stringify(d.framePath || []),
      AZ_shadow_path: JSON.stringify(d.shadowPath || []),
      AZ_form_selector: d.form ? (d.form.selector || null) : null,
      AZ_locators_json: JSON.stringify({
        a11y: d.a11y || null, testids: d.testids || null, attrs: d.attributes || null, bounds: d.bounds || null,
        session: d.meta?.session || null, env: d.meta?.env || null
      }),
      AZ_nav_root: null, AZ_menu_li_trail: null, AZ_post_hints: null
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
