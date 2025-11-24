// background.js — Unified: 기존 CSV/디버그/변환 로직 유지 + rows 직행 업로드 + 재시도 큐 + 영속 브라우저 ID

/***** 업로드/내보내기 설정 *****/
const REALTIME_UPLOAD = true;
const INGEST_URL = "http://34.22.96.191:8080/ingest/batch";
const INGEST_API_KEY = "9F2A4C7D1E8B0FA3D6C4B1E7A9F03D2";

/***** 업로드 큐/히스토리 *****/
// CSV 내보내기용 히스토리(비우지 않음)
const DB_BUFFER = [];
// 서버 업로드용 큐(실패 시 재시도)
const UPLOAD_QUEUE = [];
let uploadTimer = null;
const UPLOAD_INTERVAL_MS = 3000;

/***** 유틸 *****/
const pad = (n, z = 2) => String(n).padStart(z, "0");
function dt0(ms) {
  const d = new Date(ms || Date.now());
  return (
    d.getUTCFullYear() + "-" +
    pad(d.getUTCMonth() + 1) + "-" +
    pad(d.getUTCDate()) + " " +
    pad(d.getUTCHours()) + ":" +
    pad(d.getUTCMinutes()) + ":" +
    pad(d.getUTCSeconds())
  );
}
function csvEscape(v) {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function tsFile() {
  const d = new Date();
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) + "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}
function downloadText(filename, text, mime = "text/csv") {
  const url = "data:" + mime + ";charset=utf-8," + encodeURIComponent("\ufeff" + text);
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    if (chrome.runtime.lastError) {
      console.error("[DOWNLOAD]", chrome.runtime.lastError.message);
    }
  });
}
function sameHost(u1, u2) {
  try {
    return new URL(u1).host === new URL(u2).host;
  } catch {
    // 원래 코드와 비슷하게: 파싱 실패 시 "같다" 가정해서 메타를 붙여줌
    return true;
  }
}
function urlPath(u) {
  try { return new URL(u).pathname; } catch { return null; }
}
function urlHost(u) {
  try { return new URL(u).host; } catch { return null; }
}
function pickTestId(obj) {
  if (!obj) return null;
  return (
    obj["data-testid"] ||
    obj["data-test-id"] ||
    obj["data-qa"] ||
    obj["data-cy"] ||
    null
  );
}
function isSensitiveAttr(attrs) {
  const t = (attrs?.type || "").toLowerCase();
  const n = (attrs?.name || "").toLowerCase();
  return t === "password" || /pass|pwd|ssn|credit|주민|비번/i.test(n);
}
const ALLOWED_KEYS = new Set([
  "Enter","Tab","Escape","Backspace","Delete",
  "ArrowLeft","ArrowRight","ArrowUp","ArrowDown",
  "Home","End","PageUp","PageDown"
]);

/***** 브라우저 세션 ID (영속) *****/
const BROWSER_KEY = "AZ_BROWSER_ID";
let BROWSER_SESSION_ID = null;

(async () => {
  try {
    const got = await chrome.storage.local.get(BROWSER_KEY);
    if (got && got[BROWSER_KEY]) {
      BROWSER_SESSION_ID = got[BROWSER_KEY];
    } else {
      BROWSER_SESSION_ID =
        crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      await chrome.storage.local.set({ [BROWSER_KEY]: BROWSER_SESSION_ID });
    }
  } catch (e) {
    console.warn("[AZ] browser id init failed", e);
    BROWSER_SESSION_ID =
      crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
})();

/***** HELLO 핸드셰이크 (구/신 content.js 모두 호환) *****/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "HELLO") {
    const ack = {
      browser_session_id: BROWSER_SESSION_ID,
      tab_id: sender?.tab?.id ?? null
    };
    // 구버전과 신버전 둘 다 이해할 수 있게 평문 + 래핑 둘 다 전달
    sendResponse?.({
      ok: true,
      type: "HELLO_ACK",
      payload: ack,
      ...ack
    });
    return true;
  }
  return false;
});

/***** API 매핑(지연 포함) *****/
const lastApiByTab = new Map(); // tabId -> { url, method, status, startTs, endTs, latencyMs }

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (
      details.tabId >= 0 &&
      ["xmlhttprequest", "fetch", "beacon", "ping", "main_frame"].includes(details.type)
    ) {
      lastApiByTab.set(details.tabId, {
        url: details.url,
        method: details.method,
        status: null,
        startTs: details.timeStamp,
        endTs: null,
        latencyMs: null
      });
      try {
        chrome.tabs.sendMessage(details.tabId, { type: "FLUSH_REQUEST" });
      } catch (e) {
        // content 쪽이 없을 수도 있으니 무시
      }
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId >= 0) {
      const prev = lastApiByTab.get(details.tabId) || {};
      const startTs = prev.startTs ?? details.timeStamp;
      const endTs = details.timeStamp;
      lastApiByTab.set(details.tabId, {
        url: details.url,
        method: details.method,
        status: details.statusCode,
        startTs,
        endTs,
        latencyMs: Math.max(0, Math.round(endTs - startTs))
      });
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred?.addListener(
  (details) => {
    if (details.tabId >= 0) {
      const prev = lastApiByTab.get(details.tabId) || {};
      const startTs = prev.startTs ?? details.timeStamp;
      const endTs = details.timeStamp;
      lastApiByTab.set(details.tabId, {
        url: details.url,
        method: details.method,
        status: -1,
        startTs,
        endTs,
        latencyMs: Math.max(0, Math.round(endTs - startTs))
      });
    }
  },
  { urls: ["<all_urls>"] }
);

/***** 업로드(내부 큐 + 재시도) *****/
function scheduleUpload() {
  if (uploadTimer) return;
  uploadTimer = setTimeout(flushUpload, UPLOAD_INTERVAL_MS);
}
async function flushUpload() {
  uploadTimer = null;
  if (!UPLOAD_QUEUE.length) return;

  const rows = UPLOAD_QUEUE.splice(0, UPLOAD_QUEUE.length);
  try {
    const body = JSON.stringify({ rows, ts: Date.now() });
    const headers = { "Content-Type": "application/json" };
    if (INGEST_API_KEY) headers["x-api-key"] = INGEST_API_KEY;
    const res = await fetch(INGEST_URL, { method: "POST", headers, body });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn("[INGEST] non-200", res.status, t);
      throw new Error(String(res.status));
    }
  } catch (e) {
    console.warn("[INGEST] failed, re-queue", e);
    // 실패 시 재큐
    UPLOAD_QUEUE.unshift(...rows);
    scheduleUpload();
  }
}
function realtimeUpload(rows, reason) {
  if (!REALTIME_UPLOAD || !Array.isArray(rows) || !rows.length) return;
  UPLOAD_QUEUE.push(...rows);
  // 저지연 업로드 지향 (실패 시 flushUpload 안에서 재큐 후 scheduleUpload)
  flushUpload();
}

/***** 콘솔 로깅 + 히스토리(DB_BUFFER) 보존 *****/
function logAndBuffer(reason, rows) {
  if (!rows || !rows.length) return;
  console.group(`[DB ROWS] reason=${reason} count=${rows.length}`);
  try {
    console.table(rows, [
      "AZ_event_action","AZ_event_subtype","AZ_url","AZ_url_host","AZ_url_path",
      "AZ_element_type","AZ_element_uid","AZ_element_label",
      "AZ_api_method","AZ_api_status","AZ_api_path","AZ_api_latency_ms",
      "AZ_login_id","AZ_event_time"
    ]);
  } catch (e) {
    console.warn("[DB ROWS] console.table failed", e);
  } finally {
    console.groupEnd();
  }
  DB_BUFFER.push(...rows);      // CSV용으로 계속 누적
  realtimeUpload(rows, reason); // 서버 업로드 큐로 전달
}

/***** CSV 헤더(확장) — 원본과 동일 구성 *****/
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

function exportDbCsv() {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of DB_BUFFER) {
    lines.push(CSV_HEADERS.map((h) => csvEscape(r[h])).join(","));
  }
  downloadText(`az_db_rows_${tsFile()}.csv`, lines.join("\n"));
}
function safeExportAllCsv() {
  try {
    if (!DB_BUFFER.length) {
      downloadText(
        `az_readme_${tsFile()}.txt`,
        "No logs yet. Interact, then export.",
        "text/plain"
      );
      return;
    }
    exportDbCsv();
  } catch (e) {
    console.error("[EXPORT] failed", e);
  }
}
chrome.action.onClicked.addListener(() => safeExportAllCsv());
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "export-csv") safeExportAllCsv();
});

/***** 공통 변환 (payload.events → AZ_* 행 생성, 구 content.js 호환) *****/
function attachApi(url, tabId) {
  const api = lastApiByTab.get(tabId) || {};
  const same = api.url && sameHost(api.url, url);
  return {
    AZ_api_url: same ? api.url : null,
    AZ_api_method: api.method || null,
    AZ_api_status: api.status ?? null,
    AZ_api_path: same && api.url ? urlPath(api.url) : null,
    AZ_api_host: same && api.url ? urlHost(api.url) : null,
    AZ_api_latency_ms: same ? (api.latencyMs ?? null) : null
  };
}

function baseCommon(ev, tabId, loginId) {
  const d = ev.data || {};
  const url = ev.url || "";
  const ts = ev.timestamp || Date.now();
  const sess = d.meta?.session || {};
  return {
    AZ_ip_address: null, // 확장에서는 얻을 수 없음(서버에서 보강)
    AZ_url: url,
    AZ_url_host: urlHost(url),
    AZ_url_path: urlPath(url),
    AZ_login_id: loginId,
    AZ_event_time: dt0(ts),
    AZ_selector_css: ev.selector?.css || null,
    AZ_selector_xpath: ev.selector?.xpath || null,
    AZ_element_tag: (ev.tagName || "").toUpperCase() || null,
    AZ_frame_path: JSON.stringify(d.framePath || []),
    AZ_shadow_path: JSON.stringify(d.shadowPath || []),
    AZ_form_selector: d.form ? d.form.selector || null : null,
    AZ_form_name: d.form ? d.form.name || null : null,
    AZ_form_action: d.form ? d.form.action || null : null,
    AZ_a11y_role: d.a11y?.role ?? d.role ?? null,
    AZ_aria_label: d.a11y?.ariaLabel ?? null,
    AZ_aria_labelledby: d.a11y?.ariaLabelledby ?? null,
    AZ_session_install_id: sess.install_id || null,
    AZ_session_browser_id: sess.browser_session_id || null,
    AZ_session_tab_id: sess.tab_id ?? null,
    AZ_session_page_id: sess.page_session_id || null,
    AZ_data_testid: pickTestId(d.testids || d.dataset),
    AZ_locators_json: JSON.stringify({
      a11y: d.a11y || null,
      testids: d.testids || d.dataset || null,
      attrs: d.attributes || null,
      bounds: d.bounds || null,
      session: d.meta?.session || null,
      env: d.meta?.env || null
    }),
    // snapshot pass-through
    AZ_dom_before: d.snapshot?.dom_before ?? null,
    AZ_dom_after: d.snapshot?.dom_after ?? null,
    AZ_api_response_body: d.snapshot?.api_response_body ?? null
  };
}

function eventToDbRow(ev, tabId, loginId = "unknown") {
  const a = ev.action;
  const t = (ev.tagName || "").toUpperCase();
  const d = ev.data || {};
  const url = ev.url || "";

  const base = {
    ...baseCommon(ev, tabId, loginId),
    ...attachApi(url, tabId),
    AZ_element_uid:
      (d.identifier || ev.selector?.css || ev.selector?.xpath || "")
        .toString()
        .slice(0, 256),
    AZ_element_type: null,
    AZ_element_label: null,
    AZ_data: null,
    AZ_nav_root: d.navRoot || null,
    AZ_menu_li_trail: null,
    AZ_post_hints: null,
    AZ_event_action: a || null,
    AZ_event_subtype: null,
    AZ_page_title: null,
    AZ_referrer: null,
    AZ_viewport_w: null,
    AZ_viewport_h: null,
    AZ_input_length: null,
    AZ_is_sensitive: null,
    AZ_key: null,
    AZ_key_mods: null,
    AZ_menu_section: null,
    AZ_menu_item: null,
    AZ_route_from: null,
    AZ_route_to: null
  };

  // 메뉴 클릭
  if (a === "menu_click") {
    const label = d.label || null;
    const liTrail = Array.isArray(d.liTrail) ? d.liTrail : [];
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
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 1000),
      AZ_menu_li_trail: liTrail.length ? JSON.stringify(liTrail) : null,
      AZ_menu_section: section || null,
      AZ_menu_item: item || null,
      AZ_page_title: d.title || null
    };
  }

  // 페이지 뷰
  if (a === "page_view") {
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
      AZ_session_tab_id: sess.tab_id ?? base.AZ_session_tab_id,
      AZ_session_page_id: sess.page_session_id || base.AZ_session_page_id
    };
  }

  // 라우팅
  if (a === "route_change") {
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
  if (a === "submit") {
    return {
      ...base,
      AZ_element_type: "event",
      AZ_event_subtype: "submit"
    };
  }

  // 입력/확정값
  if (
    (["INPUT", "TEXTAREA", "SELECT"].includes(t) && ["input", "change"].includes(a)) ||
    a === "change"
  ) {
    const type = (d.attributes?.type || d.inputType || t.toLowerCase() || "")
      .slice(0, 32);
    const value = d.value === undefined ? null : d.value;
    const sens = isSensitiveAttr(d.attributes);

    return {
      ...base,
      AZ_element_type: type,
      AZ_element_label: d.label ?? null,
      AZ_data: value,
      AZ_input_length: typeof value === "string" ? value.length : null,
      AZ_is_sensitive: sens ? 1 : 0
    };
  }

  // 전량 이벤트 (키입력 등)
  if (a === "event") {
    const payload = d.instant || {};
    let key = null;
    let mods = null;
    const subtype = payload.type || null;
    let inputLen = null;

    if (subtype === "keydown" || subtype === "keyup") {
      if (ALLOWED_KEYS.has(payload.key)) {
        key = payload.key;
      }
      const m = [];
      if (payload.ctrl) m.push("ctrl");
      if (payload.alt) m.push("alt");
      if (payload.shift) m.push("shift");
      mods = m.length ? m.join("+") : null;
    }
    if (subtype === "input") {
      inputLen = typeof payload.length === "number" ? payload.length : null;
    }

    return {
      ...base,
      AZ_element_type: "event",
      AZ_event_subtype: subtype,
      AZ_key: key,
      AZ_key_mods: mods,
      AZ_input_length: inputLen,
      AZ_data: payload ? JSON.stringify(payload) : null
    };
  }

  return null;
}

/***** 메시지 수신 — rows(신) & payload.events(구) 모두 지원 *****/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type !== "BATCH_EVENTS") return;

    const tabId = sender?.tab?.id ?? -1;
    const reason = msg.payload?.reason || msg.reason || "";

    // 1) 새 포맷: rows (content.js에서 AZ_* 필드 직접 생성)
    if (Array.isArray(msg.rows)) {
      const rows = msg.rows.map((r0) => {
        const r = { ...r0 };

        // 세션 보강
        if (r.AZ_session_tab_id == null) r.AZ_session_tab_id = tabId;
        if (r.AZ_session_browser_id == null) r.AZ_session_browser_id = BROWSER_SESSION_ID;

        // URL 파생 보강
        if (!r.AZ_url_host && r.AZ_url) r.AZ_url_host = urlHost(r.AZ_url);
        if (!r.AZ_url_path && r.AZ_url) r.AZ_url_path = urlPath(r.AZ_url);

        // API 메타 자동 부착
        const meta = attachApi(r.AZ_url || "", tabId);
        for (const k of Object.keys(meta)) {
          if (r[k] == null) r[k] = meta[k];
        }

        return r;
      });

      logAndBuffer(reason, rows);
      sendResponse?.({ ok: true, logged: rows.length, mode: "rows" });
      return;
    }

    // 2) 구 포맷: payload.events → 변환
    const events = Array.isArray(msg.payload?.events) ? msg.payload.events : [];
    const { loginId } = await chrome.storage.local.get("loginId");
    const lid =
      typeof loginId === "string" && loginId.trim()
        ? loginId.trim()
        : "unknown";

    const rows = [];
    for (const ev of events) {
      const row = eventToDbRow(ev, tabId, lid);
      if (!row) continue;

      if (row.AZ_session_tab_id == null) row.AZ_session_tab_id = tabId;
      if (row.AZ_session_browser_id == null) {
        row.AZ_session_browser_id = BROWSER_SESSION_ID;
      }
      rows.push(row);
    }

    logAndBuffer(reason, rows);
    sendResponse?.({ ok: true, logged: rows.length, mode: "events" });
  })();
  return true; // async sendResponse 허용
});
