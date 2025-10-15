// background.js — LOG ONLY + 정확한 API URL 매핑 + AZ_* 스키마 + CSV Export + FULL_MENU 로그

// ───────── 공통 유틸 ─────────
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
function sameHost(u1, u2) { try { return new URL(u1).host === new URL(u2).host; } catch { return true; } }

const pad = (n, z = 2) => String(n).padStart(z, "0");
function tsFile() {
  const d = new Date();
  return (
    d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  );
}
function csvEscape(v) {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// 서비스워커 호환: Blob/objectURL 대신 data:URL 사용
function downloadText(filename, text, mime = "text/csv") {
  const bom = "\ufeff"; // Excel 호환
  const url = "data:" + mime + ";charset=utf-8," + encodeURIComponent(bom + text);
  chrome.downloads.download(
    { url, filename, saveAs: false },
    (id) => {
      if (chrome.runtime.lastError) {
        console.error("[DOWNLOAD] failed:", chrome.runtime.lastError.message);
      } else {
        console.log("[DOWNLOAD] ok id=", id);
      }
    }
  );
}

// ───────── 이벤트 → DB 행 ─────────
function eventToDbRow(ev, loginId) {
  const action = ev.action;

  // 메뉴 클릭
  if (action === "menu_click") {
    const pageUrl = ev.url || "";
    const ts = ev.timestamp || Date.now();
    const d = ev.data || {};
    const uid = (d.identifier || ev.selector?.css || ev.selector?.xpath || "");
    const label = d.label || null;

    // 축약값(255자 제한 감안)
    const compact = [];
    if (d.href) compact.push(`href=${d.href}`);
    if (Array.isArray(d.menuTrail) && d.menuTrail.length) compact.push(`trail=${d.menuTrail.join(" > ")}`);
    if (d.kind) compact.push(`kind=${d.kind}`);
    if (d.role) compact.push(`role=${d.role}`);
    const AZ_data = compact.join(" | ").slice(0, 255);

    if (!pageUrl || !uid) return null;

    return {
      AZ_ip_address: "(unavailable-in-extension)",
      AZ_url: pageUrl,
      AZ_login_id: loginId,
      AZ_event_time: toMysqlDatetime6(ts),
      AZ_element_uid: String(uid).slice(0, 36),
      AZ_element_type: "menu",
      AZ_element_label: label,
      AZ_data
    };
  }

  // 입력 계열
  const tag = (ev.tagName || "").toUpperCase();
  if (!["INPUT","TEXTAREA","SELECT"].includes(tag)) return null;
  if (!["input","change"].includes(action)) return null;

  const pageUrl = ev.url || "";
  const ts = ev.timestamp || Date.now();
  const data = ev.data || {};

  let element_type = (data.inputType || data?.attributes?.type || tag.toLowerCase() || "");
  element_type = String(element_type).slice(0, 32);
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
    AZ_ip_address: "(unavailable-in-extension)",
    AZ_url: pageUrl,
    AZ_login_id: loginId,
    AZ_event_time: toMysqlDatetime6(ts),
    AZ_element_uid: element_uid,
    AZ_element_type: element_type,
    AZ_element_label: element_label,
    AZ_data: value
  };
}

// ───────── 요청 URL 버퍼(탭별 최근 요청) ─────────
const lastApiByTab = new Map(); // tabId -> { url, method, frameId, timeStamp }

// ───────── CSV 버퍼(메모리) ─────────
let DB_BUFFER = []; // 각 행은 AZ_* 키 + AZ_api_url/AZ_api_method 포함

// rows에 AZ_api_url 주입 후 출력(+ FULL_MENU), 그리고 버퍼에도 적재
function logRows(reason, rows, apiInfo, rawEvents) {
  if (!rows.length) return;

  const decorated = rows.map(r => {
    const api_url    = apiInfo?.url && sameHost(apiInfo.url, r.AZ_url) ? apiInfo.url : null;
    const api_method = apiInfo?.method || null;
    return { AZ_api_url: api_url, AZ_api_method: api_method, ...r };
  });

  // 콘솔 출력
  console.group(`[DB ROWS] reason=${reason} count=${decorated.length}`);
  try {
    console.table(decorated, [
      "AZ_api_url","AZ_url","AZ_event_time","AZ_element_type","AZ_element_uid",
      "AZ_element_label","AZ_data","AZ_login_id","AZ_ip_address"
    ]);
    decorated.forEach(r => console.log("DB_ROW", JSON.stringify(r)));

    // 메뉴 전체 메타(JSON)도 별도로 출력
    (rawEvents || []).forEach((ev) => {
      if (ev?.action === "menu_click") {
        const full = {
          api_url: apiInfo?.url || null,
          api_method: apiInfo?.method || null,
          page_url: ev.url,
          time: toMysqlDatetime6(ev.timestamp || Date.now()),
          selector: ev.selector,
          tagName: ev.tagName,
          meta: ev.data // label, href, role, ariaLabel, dataset, className, kind, trail, bounds, pageContext...
        };
        console.log("FULL_MENU", JSON.stringify(full));
      }
    });
  } finally {
    console.groupEnd();
  }

  // CSV 내보내기용 버퍼 적재
  DB_BUFFER.push(...decorated);
}

// ───────── 컨텐츠 스크립트 배치 수신 ─────────
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

    const tabId  = sender?.tab?.id ?? -1;
    const apiInfo = lastApiByTab.get(tabId) || null;

    logRows(reason, rows, apiInfo, events);

    const key = `last_rows_${Date.now()}`;
    await chrome.storage.local.set({ [key]: rows });

    console.log("[BATCH] reason=%s events=%d dbBuf=%d", reason, events.length, DB_BUFFER.length);
    sendResponse({ ok: true, logged: rows.length });
  })();
  return true;
});

// ───────── 네트워크 요청 감지 (폼 네비 포함) ─────────
const ALLOWED_TYPES = new Set(["xmlhttprequest","fetch","beacon","ping","main_frame"]);
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
      chrome.tabs.sendMessage(details.tabId, { type: "FLUSH_REQUEST" }).catch(()=>{});
    }
  },
  { urls: ["<all_urls>"] }
);

// ───────── CSV 내보내기(아이콘/단축키) ─────────
function exportDbCsv() {
  const headers = [
    "AZ_api_url","AZ_api_method","AZ_ip_address","AZ_url","AZ_login_id",
    "AZ_event_time","AZ_element_uid","AZ_element_type","AZ_element_label","AZ_data"
  ];
  const lines = [headers.join(",")];
  for (const r of DB_BUFFER) {
    lines.push(headers.map(h => csvEscape(r[h])).join(","));
  }
  downloadText(`az_db_rows_${tsFile()}.csv`, lines.join("\n"));
}
function safeExportAllCsv() {
  try {
    console.log("[ACTION] Export requested", { rows: DB_BUFFER.length });
    if (!DB_BUFFER.length) {
      downloadText(`az_readme_${tsFile()}.txt`,
        "No logs collected yet. Interact with a page, then click the extension icon.",
        "text/plain"
      );
      return;
    }
    exportDbCsv();
  } catch (e) {
    console.error("[ACTION] Export failed:", e);
  }
}

chrome.action.onClicked.addListener(() => safeExportAllCsv());
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "export-csv") safeExportAllCsv();
});
