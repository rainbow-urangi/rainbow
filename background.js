// background.js — Robust CSV (DB + Context) + network mapping + export

// ---- 유틸 ----
const pad = (n,z=2)=> String(n).padStart(z,"0");
function dt0(ms){
  const d=new Date(ms||Date.now());
  return d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())+" "+
         pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+":"+pad(d.getUTCSeconds());
}
function csvEscape(v){
  if (v==null) return "";
  const s = typeof v==="string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
function tsFile(){
  const d=new Date();
  return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+"_"+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds());
}
function downloadText(filename, text, mime="text/csv"){
  const url = "data:"+mime+";charset=utf-8," + encodeURIComponent("\ufeff"+text);
  chrome.downloads.download({ url, filename, saveAs:false }, (id)=>{
    if (chrome.runtime.lastError) console.error("[DOWNLOAD] failed:", chrome.runtime.lastError.message);
  });
}
function sameHost(u1,u2){ try{ return new URL(u1).host === new URL(u2).host; }catch{return true;} }

// ---- 탭별 최근 요청 저장 (url/method/status) ----
const lastApiByTab = new Map(); // tabId -> { url, method, status, timeStamp }

chrome.webRequest.onBeforeRequest.addListener((details)=>{
  if (details.tabId >= 0 && ["xmlhttprequest","fetch","beacon","ping","main_frame"].includes(details.type)){
    lastApiByTab.set(details.tabId, { url: details.url, method: details.method, status: null, timeStamp: details.timeStamp });
    // 요청 직전 입력 배치 플러시 지시
    chrome.tabs.sendMessage(details.tabId, { type:"FLUSH_REQUEST" }).catch(()=>{});
  }
},{ urls:["<all_urls>"] });

chrome.webRequest.onCompleted.addListener((details)=>{
  if (details.tabId >= 0){
    const prev = lastApiByTab.get(details.tabId) || {};
    lastApiByTab.set(details.tabId, { ...prev, url: details.url, method: details.method, status: details.statusCode, timeStamp: details.timeStamp });
  }
},{ urls:["<all_urls>"] });

// ---- CSV 버퍼 ----
let DB_BUFFER = [];

// ---- 수신 → DB 행 변환 ----
function eventToDbRow(ev, tabId, loginId="unknown"){
  const a = ev.action;
  const t = (ev.tagName||"").toUpperCase();
  const d = ev.data || {};
  const url = ev.url || "";
  const ts  = ev.timestamp || Date.now();

  // menu 클릭 → 요약
  if (a === "menu_click"){
    const uid = (d.identifier || ev.selector?.css || ev.selector?.xpath || "").toString().slice(0,36);
    const label = d.label || null;
    const compact = [
      d.href ? `href=${d.href}` : null,
      d.liTrail?.length ? `trail=${(d.liTrail||[]).join(" > ")}` : null,
      d.role ? `role=${d.role}` : null
    ].filter(Boolean).join(" | ").slice(0,255);

    const api = lastApiByTab.get(tabId) || {};
    return {
      AZ_ip_address: "(unavailable-in-extension)",
      AZ_url: url,
      AZ_login_id: loginId,
      AZ_event_time: dt0(ts),

      AZ_element_uid: uid,
      AZ_element_type: "menu",
      AZ_element_label: label,
      AZ_data: compact,

      // 확장 필드
      AZ_api_url: api.url && sameHost(api.url, url) ? api.url : null,
      AZ_api_method: api.method || null,
      AZ_api_status: api.status ?? null,

      AZ_frame_path: JSON.stringify(d.framePath || []),
      AZ_shadow_path: JSON.stringify(d.shadowPath || []),
      AZ_form_selector: null,
      AZ_locators_json: null,
      AZ_nav_root: d.navRoot || null,
      AZ_menu_li_trail: d.liTrail?.length ? JSON.stringify(d.liTrail) : null,
      AZ_post_hints: null
    };
  }

  // post-state → 후행신호
  if (a === "post_state"){
    const api = lastApiByTab.get(tabId) || {};
    return {
      AZ_ip_address: "(unavailable-in-extension)",
      AZ_url: url,
      AZ_login_id: loginId,
      AZ_event_time: dt0(ts),

      AZ_element_uid: "STATE",
      AZ_element_type: "state",
      AZ_element_label: null,
      AZ_data: null,

      AZ_api_url: api.url && sameHost(api.url, url) ? api.url : null,
      AZ_api_method: api.method || null,
      AZ_api_status: api.status ?? null,

      AZ_frame_path: JSON.stringify(d.framePath || []),
      AZ_shadow_path: null,
      AZ_form_selector: null,
      AZ_locators_json: null,
      AZ_nav_root: null,
      AZ_menu_li_trail: null,
      AZ_post_hints: JSON.stringify(d.postHints || null)
    };
  }

  // 입력/선택/일반
  if (["INPUT","TEXTAREA","SELECT"].includes(t) && ["input","change"].includes(a) || a==="change"){
    const type = (d.attributes?.type || d.inputType || t.toLowerCase() || "").slice(0,32);
    const uid  = (d.identifier || ev.selector?.css || ev.selector?.xpath || "").toString().slice(0,36);
    const label = d.label ?? null;
    const value = d.value===undefined ? null : d.value;

    const api = lastApiByTab.get(tabId) || {};
    return {
      AZ_ip_address: "(unavailable-in-extension)",
      AZ_url: url,
      AZ_login_id: loginId,
      AZ_event_time: dt0(ts),

      AZ_element_uid: uid,
      AZ_element_type: type,
      AZ_element_label: label,
      AZ_data: value,

      AZ_api_url: api.url && sameHost(api.url, url) ? api.url : null,
      AZ_api_method: api.method || null,
      AZ_api_status: api.status ?? null,

      AZ_frame_path: JSON.stringify(d.framePath || []),
      AZ_shadow_path: JSON.stringify(d.shadowPath || []),
      AZ_form_selector: d.form ? (d.form.selector || null) : null,
      AZ_locators_json: JSON.stringify({
        a11y: d.a11y || null,
        testids: d.testids || null,
        attrs: d.attributes || null,
        bounds: d.bounds || null
      }),
      AZ_nav_root: null,
      AZ_menu_li_trail: null,
      AZ_post_hints: null
    };
  }

  // 기타(route/page_view 등)는 CSV 저장 생략(필요 시 확장 가능)
  return null;
}

// ---- 로그 & 버퍼 적재 ----
function logAndBuffer(reason, rows){
  if (!rows.length) return;
  console.group(`[DB ROWS] reason=${reason} count=${rows.length}`);
  try{
    console.table(rows, [
      "AZ_api_url","AZ_api_method","AZ_api_status","AZ_url","AZ_event_time",
      "AZ_element_type","AZ_element_uid","AZ_element_label","AZ_data","AZ_login_id"
    ]);
  }finally{ console.groupEnd(); }
  DB_BUFFER.push(...rows);
}

// ---- 메시지 수신 ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async ()=>{
    if (msg?.type !== "BATCH_EVENTS") return;
    const reason = msg.payload?.reason || "";
    const events = Array.isArray(msg.payload?.events) ? msg.payload.events : [];

    // (선택) 로그인 ID가 확장 옵션에 있다면 사용
    const { loginId } = await chrome.storage.local.get("loginId");
    const lid = (typeof loginId === "string" && loginId.trim()) ? loginId.trim() : "unknown";

    const tabId = sender?.tab?.id ?? -1;

    const rows=[];
    for (const ev of events){
      const row=eventToDbRow(ev, tabId, lid);
      if (row) rows.push(row);
    }
    logAndBuffer(reason, rows);

    sendResponse?.({ ok:true, logged: rows.length });
  })();
  return true;
});

// ---- CSV 내보내기 ----
function exportDbCsv(){
  const headers = [
    "AZ_api_url","AZ_api_method","AZ_api_status",
    "AZ_ip_address","AZ_url","AZ_login_id","AZ_event_time",
    "AZ_element_uid","AZ_element_type","AZ_element_label","AZ_data",
    // 확장
    "AZ_frame_path","AZ_shadow_path","AZ_form_selector",
    "AZ_locators_json","AZ_nav_root","AZ_menu_li_trail","AZ_post_hints"
  ];
  const lines=[headers.join(",")];
  for (const r of DB_BUFFER){
    lines.push(headers.map(h=> csvEscape(r[h])).join(","));
  }
  downloadText(`az_db_rows_${tsFile()}.csv`, lines.join("\n"));
}

function safeExportAllCsv(){
  try{
    console.log("[ACTION] Export requested", { rows: DB_BUFFER.length });
    if (!DB_BUFFER.length){
      downloadText(`az_readme_${tsFile()}.txt`, "No logs yet. Interact, then export.", "text/plain");
      return;
    }
    exportDbCsv();
  }catch(e){ console.error("[ACTION] Export failed:", e); }
}

chrome.action.onClicked.addListener(()=> safeExportAllCsv());
chrome.commands.onCommand.addListener((cmd)=>{ if (cmd==="export-csv") safeExportAllCsv(); });
