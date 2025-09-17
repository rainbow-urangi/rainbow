// background.js — LOG ONLY + 정확한 API URL 매핑 + AZ_* 스키마 + menu_click 지원

// ===== 공통 유틸 =====
function toMysqlDatetime6(ms) {
  const d = new Date(ms || Date.now());
  const pad = (n, z = 2) => String(n).padStart(z, "0");
  return (
    d.getUTCFullYear() + "-" +
    pad(d.getUTCMonth() + 1) + "-" +
    pad(d.getUTCDate()) + " " +
    pad(d.getUTCHours()) + ":" +
    pad(d.getUTCMinutes()) + ":" +
    pad(d.getUTCSeconds()) + "." +
    String(d.getUTCMilliseconds()).padStart(3, "0") + "000"
  );
}
async function getLoginId() {
  const { loginId } = await chrome.storage.local.get("loginId");
  return (typeof loginId === "string" && loginId.trim()) ? loginId.trim() : "unknown";
}
const looksLikeUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);

// ===== 이벤트 → DB 행 (페이지 URL만 포함) =====
function eventToDbRow(ev, loginId) {
  const action = ev.action;

  // ① 메뉴 클릭
  if (action === "menu_click") {
    const pageUrl = ev.url || "";
    const ts = ev.timestamp || Date.now();
    const d = ev.data || {};
    const uid = (d.identifier || ev.selector?.css || ev.selector?.xpath || "");
    const label = d.label || null;
    const dataVal = d.href || (Array.isArray(d.menuTrail) ? d.menuTrail.join(" > ") : null);
    if (!pageUrl || !uid) return null;

    return {
      AZ_ip_address: "(unavailable-in-extension)",
      AZ_url: pageUrl,
      AZ_login_id: loginId,
      AZ_event_time: toMysqlDatetime6(ts),
      AZ_element_uid: String(uid).slice(0, 36),
      AZ_element_type: "menu",
      AZ_element_label: label,
      AZ_data: dataVal
    };
  }

  // ② 입력 계열(최종값)
  const tag = (ev.tagName || "").toUpperCase();
  if (!["INPUT","TEXTAREA","SELECT"].includes(tag)) return null;
  if (!["input","change"].includes(action)) return null;

  const pageUrl = ev.url || "";
  const ts = ev.timestamp || Date.now();
  const data = ev.data || {};

  let element_type = (data.inputType || data?.attributes?.type || tag.toLowerCase() || "");
  element_type = String(element_type).slice(0, 32);

  // 방어: 타입이 URL처럼 보이면 교정
  if (looksLikeUrl(element_type)) {
    console.warn("[FIX] element_type looked like URL, fallback to tag/type", { bad: element_type, tag, data });
    element_type = (data?.attributes?.type || tag.toLowerCase()).slice(0, 32);
  }

  let element_uid = (data.identifier || ev.selector?.css || ev.selector?.xpath || "");
  element_uid = String(element_uid).slice(0, 36);

  const element_label = (data.label ?? null);
  const value = (typeof data.value === "string" ? data.value : (data.value ?? null));

  if (!pageUrl || !element_uid || !element_type) return null;

  return {
    AZ_ip_address: "(unavailable-in-extension)", // IP는 서버에서 채움
    AZ_url: pageUrl,                              // 페이지 URL
    AZ_login_id: loginId,
    AZ_event_time: toMysqlDatetime6(ts),
    AZ_element_uid: element_uid,
    AZ_element_type: element_type,
    AZ_element_label: element_label,
    AZ_data: value
  };
}

// ===== 요청 URL 버퍼(탭별 최근 요청) =====
const lastApiByTab = new Map(); // tabId -> { url, method, frameId, timeStamp }

function sameHost(u1, u2) {
  try { return new URL(u1).host === new URL(u2).host; } catch { return true; }
}

// rows에 AZ_api_url/AZ_api_method 주입 후 출력
function logRows(reason, rows, apiInfo) {
  if (!rows.length) return;

  const decorated = rows.map(r => {
    const api_url    = apiInfo?.url && sameHost(apiInfo.url, r.AZ_url) ? apiInfo.url : null;
    const api_method = apiInfo?.method || null;
    return { AZ_api_url: api_url, AZ_api_method: api_method, ...r };
  });

  console.group(
    `[DB ROWS] reason=${reason} ` +
    (decorated[0]?.AZ_api_url ? `api=${decorated[0].AZ_api_method || ""} ${decorated[0].AZ_api_url} ` : "") +
    `count=${decorated.length}`
  );
  try {
    console.table(decorated, [
      "AZ_api_url",       // 실제 요청 URL
      "AZ_url",           // 페이지 URL
      "AZ_event_time",
      "AZ_element_type",
      "AZ_element_uid",
      "AZ_element_label",
      "AZ_data",
      "AZ_login_id",
      "AZ_ip_address"
    ]);
    decorated.forEach(r => console.log("DB_ROW", JSON.stringify(r)));
  } finally {
    console.groupEnd();
  }
}

// ===== 컨텐츠 스크립트 배치 수신 =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type !== "BATCH_EVENTS") return;

    const reason  = msg.payload?.reason || "";
    const events  = Array.isArray(msg.payload?.events) ? msg.payload.events : [];
    const loginId = await getLoginId();

    const rows = [];
    for (const ev of events) {
      const row = eventToDbRow(ev, loginId);
      if (row) rows.push(row);
    }

    // 같은 탭의 마지막 API 요청을 붙임
    const tabId = sender?.tab?.id ?? -1;
    const apiInfo = lastApiByTab.get(tabId) || null;

    logRows(reason, rows, apiInfo);

    // (선택) 최근 저장(요청 URL 포함으로 바꾸고 싶으면 decorated 저장)
    const key = `last_rows_${Date.now()}`;
    await chrome.storage.local.set({ [key]: rows });

    sendResponse({ ok: true, logged: rows.length });
  })();
  return true;
});

// ===== 네트워크 요청 감지 =====
// XHR/fetch/beacon/ping + (폼 POST 네비게이션 대비) main_frame/other 도 포함
const ALLOWED_TYPES = new Set(["xmlhttprequest","fetch","beacon","ping","main_frame","other"]);
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0 && ALLOWED_TYPES.has(details.type)) {
      lastApiByTab.set(details.tabId, {
        url: details.url,
        method: details.method,
        frameId: details.frameId,
        timeStamp: details.timeStamp,
        initiator: details.initiator || details.originUrl || null
      });
      // 요청과 직전 입력/메뉴 배치를 묶기 위해 플러시 지시
      chrome.tabs.sendMessage(details.tabId, { type: "FLUSH_REQUEST" }).catch(()=>{});
    }
  },
  { urls: ["<all_urls>"] }
);
