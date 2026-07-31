const DEFAULT_INGEST_URL = "https://rainbowlab.ai.kr/ingest/batch";
const COLLECTOR_VERSION = chrome.runtime?.getManifest?.().version || "0.1.1";
const QUEUE_KEY = "AZ_TEST_PENDING_ROWS";
const COLLECTOR_INGEST_URL_KEY = "collectorIngestUrl";
const TENANT_ID_KEY = "tenantId";
const COLLECTOR_KEY_KEY = "collectorKey";
const COLLECTOR_DEVICE_ID_KEY = "collectorDeviceInstallationId";
const COLLECTOR_DEVICE_TOKEN_KEY = "collectorDeviceAccessToken";
const COLLECTOR_DEVICE_TOKEN_EXPIRES_KEY = "collectorDeviceAccessTokenExpiresAtMs";
const COLLECTOR_BROWSER_SESSION_ID_KEY = "collectorBrowserSessionId";
const RUNTIME_CONFIG_URL_KEY = "collectorRuntimeConfigUrl";
const RUNTIME_CONFIG_CACHE_KEY = "AZ_TEST_RUNTIME_CONFIG_CACHE";
const DEFAULT_RUNTIME_CONFIG_TTL_MS = 5 * 60 * 1000;
const QUEUE_FLUSH_ALARM_NAME = "AZ_TEST_QUEUE_FLUSH_WAKE";
const QUEUE_FLUSH_ALARM_PERIOD_MINUTES = 1;
const DEBUG_LOG_ALL_UPLOAD_PAYLOADS = false;
const DEBUG_LOG_QUEUE_CONTENTS = true;
const QUEUE_LOG_COLUMNS = [
  "event_sequence",
  "action",
  "event_id",
  "event_time",
  "page_session_id",
  "interaction_id",
  "related_interaction_id",
  "element_text",
  "api_path",
  "api_status",
  "menu_path",
  "grid_id",
  "grid_row",
  "grid_column",
  "popup_title",
  "identity_held",
  "queue_size"
];
const DEFAULT_API_CAPTURE_CONFIG = Object.freeze({
  enabled: true,
  transaction_mode: true,
  emit_legacy_api_rows: false,
  capture_request_body: false,
  capture_response_body: false,
  capture_headers: false,
  allowed_header_names: [],
  transaction_ttl_ms: 30000,
  max_buffer_size: 500
});
const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  schema_version: 1,
  version: "local-default",
  source: "extension-default",
  ttl_ms: DEFAULT_RUNTIME_CONFIG_TTL_MS,
  modules: {},
  event_types: {},
  selector_packs: {},
  workflow_rules: [],
  privacy: {},
  api_capture: DEFAULT_API_CAPTURE_CONFIG
});
const MAX_QUEUE_ROWS = 2000;
const MAX_BATCH_ROWS = 100;
const MAX_BATCH_BYTES = 256 * 1024;
const QUEUE_URGENT_FLUSH_ROWS = Math.floor(MAX_QUEUE_ROWS * 0.8);
const QUEUE_HARD_MAX_ROWS = MAX_QUEUE_ROWS + MAX_BATCH_ROWS;
const BASE_UPLOAD_DELAY_MS = 3000;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const IDENTITY_SESSION_STORAGE_KEY = "RAINBOW_IDENTITY_STATE_BY_TAB";
const POC_IDENTITY_HOLD_MAX_MS = 5 * 60 * 1000;
const POC_MANUAL_ID_ENABLED = true;
const POC_MANUAL_ID_TARGET_ORIGINS = new Set(["http://211.109.22.33:8791"]);
const CONTENT_SCRIPT_MATCHERS = [
  /^http:\/\/211\.109\.22\.33:8791\//,
  /^https:\/\/rainbowlab\.ai\.kr\/rbem(?:[/?#]|$)/,
  /^https:\/\/rainbowlab\.ai\.kr\/mypage(?:[/?#]|$)/
];
let uploadTimer = null;
let uploadTimerIsDebounceable = false;
let uploadInFlight = false;
let hydrated = false;
let flushRequestedWhileInFlight = false;
let retryAttempt = 0;
let scheduledUploadReason = "content script가 전달한 수집 데이터를 서버로 전송";
const pendingRows = [];
const identityStateByTab = new Map();
let identityStateHydrated = false;
let identityStateMutation = Promise.resolve();

function identityStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function normalizeSiteIdentitySubject(value) {
  const normalized = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (!normalized || normalized.length > 128) return null;
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function pocManualIdentityEnabledForUrl(value) {
  if (!POC_MANUAL_ID_ENABLED) return false;
  try {
    return POC_MANUAL_ID_TARGET_ORIGINS.has(new URL(value).origin);
  } catch {
    return false;
  }
}

function createPocManualIdentity(value) {
  const subject = normalizeSiteIdentitySubject(value);
  if (!subject) return null;
  return {
    subject,
    source: "manual_poc_override",
    confidence: "poc",
    resolved_at: new Date().toISOString()
  };
}

function safeContextObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizedContextText(value, maxLength = 128) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function positiveContextInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function applyCollectorSessionContext(row, sourceRow = {}, context = {}) {
  if (!row || typeof row !== "object") return row;
  const payload = safeContextObject(sourceRow?.payload);
  const sourceEnvironment = safeContextObject(payload.environment_context);
  const locators = { ...safeContextObject(row.AZ_locators_json) };
  const session = { ...safeContextObject(locators.session) };
  const environment = { ...safeContextObject(locators.env) };
  const installationId = normalizedContextText(context.installationId);
  const browserSessionId = normalizedContextText(context.browserSessionId);
  const tabId = positiveContextInteger(context.tabId ?? sourceRow?.__rainbow_identity_tab_id);
  const userAgent = normalizedContextText(environment.ua, 2048) ||
    normalizedContextText(sourceEnvironment.ua, 2048) ||
    normalizedContextText(context.userAgent, 2048);
  const viewportWidth = positiveContextInteger(row.AZ_viewport_w) ||
    positiveContextInteger(environment.vw) || positiveContextInteger(sourceEnvironment.vw);
  const viewportHeight = positiveContextInteger(row.AZ_viewport_h) ||
    positiveContextInteger(environment.vh) || positiveContextInteger(sourceEnvironment.vh);

  return {
    ...row,
    AZ_session_install_id: normalizedContextText(row.AZ_session_install_id) || installationId,
    AZ_session_browser_id: normalizedContextText(row.AZ_session_browser_id) || browserSessionId,
    AZ_session_tab_id: positiveContextInteger(row.AZ_session_tab_id) || tabId,
    AZ_viewport_w: viewportWidth,
    AZ_viewport_h: viewportHeight,
    AZ_locators_json: {
      ...locators,
      session: {
        ...session,
        install_id: normalizedContextText(session.install_id) || installationId,
        browser_session_id: normalizedContextText(session.browser_session_id) || browserSessionId,
        tab_id: positiveContextInteger(session.tab_id) || tabId
      },
      env: { ...environment, ua: userAgent, vw: viewportWidth, vh: viewportHeight }
    }
  };
}

function normalizeIdentityContext(value, fallbackSource = "site_authenticated_user") {
  const subject = normalizeSiteIdentitySubject(value?.subject);
  if (!subject) return null;
  return {
    subject,
    source: typeof value?.source === "string" && value.source.trim()
      ? value.source.trim()
      : fallbackSource,
    confidence: typeof value?.confidence === "string" && value.confidence.trim()
      ? value.confidence.trim()
      : "verified",
    resolved_at: typeof value?.resolved_at === "string" && value.resolved_at.trim()
      ? value.resolved_at
      : new Date().toISOString()
  };
}

async function hydrateIdentityState() {
  if (identityStateHydrated) return;
  const stored = await identityStorageArea().get(IDENTITY_SESSION_STORAGE_KEY);
  const values = stored?.[IDENTITY_SESSION_STORAGE_KEY];
  if (values && typeof values === "object" && !Array.isArray(values)) {
    for (const [tabId, state] of Object.entries(values)) {
      const numericTabId = Number(tabId);
      if (Number.isInteger(numericTabId) && state && typeof state === "object") {
        identityStateByTab.set(numericTabId, state);
      }
    }
  }
  identityStateHydrated = true;
}

async function persistIdentityState() {
  const values = {};
  for (const [tabId, state] of identityStateByTab.entries()) values[String(tabId)] = state;
  await identityStorageArea().set({ [IDENTITY_SESSION_STORAGE_KEY]: values });
}

function mutateIdentityState(task) {
  identityStateMutation = identityStateMutation.catch(() => {}).then(async () => {
    await hydrateIdentityState();
    const result = await task();
    await persistIdentityState();
    return result;
  });
  return identityStateMutation;
}

function effectiveIdentityForTab(tabId) {
  const state = identityStateByTab.get(tabId) || null;
  return normalizeIdentityContext(state?.manual, "manual_poc_override") ||
    normalizeIdentityContext(state?.confirmed, "site_authenticated_user");
}

function rowTabId(row) {
  const value = Number(row?.__rainbow_identity_tab_id);
  return Number.isInteger(value) ? value : null;
}

function rowIsIdentityHeld(row) {
  if (row?.__rainbow_identity_hold !== true) return false;
  const holdUntil = Number(row?.__rainbow_identity_hold_until || 0);
  return holdUntil <= 0 || Date.now() < holdUntil;
}

function hasUploadEligibleRows() {
  return pendingRows.some((row) => !rowIsIdentityHeld(row));
}

function prepareRowsForIdentity(rows, sender = {}) {
  const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
  const tabUrl = sender?.tab?.url || firstSourcePageUrl(rows) || null;
  const pocEnabled = tabId != null && pocManualIdentityEnabledForUrl(tabUrl);
  const state = tabId != null ? identityStateByTab.get(tabId) || null : null;
  const effectiveIdentity = tabId != null ? effectiveIdentityForTab(tabId) : null;
  const manualIdentity = normalizeIdentityContext(state?.manual, "manual_poc_override");
  const shouldHold = pocEnabled && !manualIdentity;
  const holdUntil = shouldHold ? Date.now() + POC_IDENTITY_HOLD_MAX_MS : null;

  return rows.map((row) => ({
    ...row,
    ...(tabId != null ? { __rainbow_identity_tab_id: tabId } : {}),
    ...(effectiveIdentity ? { __rainbow_identity: effectiveIdentity } : {}),
    ...(shouldHold ? {
      __rainbow_identity_hold: true,
      __rainbow_identity_hold_until: holdUntil
    } : {})
  }));
}

function matchesCollectorTarget(url) {
  return typeof url === "string" && CONTENT_SCRIPT_MATCHERS.some((pattern) => pattern.test(url));
}

function firstSourcePageUrl(rows) {
  return Array.isArray(rows)
    ? rows.find((row) => typeof row?.page_url === "string" && row.page_url.trim())?.page_url || null
    : null;
}

function actionLabel(action) {
  const key = String(action || "unknown");
  const labels = {
    collector_boot: "수집기 시작",
    page_view: "페이지 진입",
    route_change: "화면 이동",
    click: "클릭",
    canvas_click: "캔버스 클릭",
    keydown: "키 입력",
    change: "입력값 확정",
    input: "입력 중",
    submit: "폼 제출",
    api_transaction: "Request/Response 완료",
    api_transaction_error: "Request/Response 실패",
    api_transaction_timeout: "Request/Response 시간 초과",
    modal_open: "팝업 열림",
    modal_close: "팝업 닫힘",
    toast_message: "토스트 메시지",
    popup_open: "팝업 열림",
    popup_close: "팝업 닫힘",
    grid_cell_click: "그리드 셀 클릭",
    grid_row_select: "그리드 행 선택",
    grid_context_enrichment: "그리드 보강"
  };
  return labels[key] || key;
}

function summarizeRowsForConsole(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const actionCounts = {};
  for (const row of list) {
    const action = row?.action || "unknown";
    const label = actionLabel(action);
    actionCounts[label] = (actionCounts[label] || 0) + 1;
  }

  const actions = new Set(list.map((row) => row?.action).filter(Boolean));
  let reason = "수집된 이벤트를 서버 저장소로 전송";
  if (actions.has("api_transaction_timeout")) {
    reason = "Request는 감지됐지만 Response가 제한 시간 안에 오지 않아 timeout 이벤트를 전송";
  } else if (actions.has("api_transaction_error")) {
    reason = "Request/Response 처리 중 실패가 발생해 실패 이벤트를 전송";
  } else if (actions.has("api_transaction")) {
    reason = "Request와 Response가 한 쌍으로 묶여 API transaction 이벤트를 전송";
  } else if (actions.has("submit")) {
    reason = "폼 제출 사용자 행동이 발생해 후속 API/화면 변화와 연결할 이벤트를 전송";
  } else if (actions.has("grid_cell_click") || actions.has("grid_row_select")) {
    reason = "그리드 행/셀 선택이 발생해 선택 행 구조와 후속 API 연결 이벤트를 전송";
  } else if (actions.has("popup_open") || actions.has("popup_close")) {
    reason = "팝업 열림/닫힘 lifecycle이 발생해 팝업 상태 이벤트를 전송";
  } else if (actions.has("click") || actions.has("canvas_click")) {
    reason = "사용자 클릭이 발생해 업무 흐름 시작점 이벤트를 전송";
  } else if (actions.has("change") || actions.has("input") || actions.has("keydown")) {
    reason = "입력값 변경 또는 키 입력이 발생해 사용자 행동 이벤트를 전송";
  } else if (actions.has("route_change")) {
    reason = "화면 경로가 바뀌어 이전 행동/API 결과와 연결할 route_change 이벤트를 전송";
  } else if (actions.has("page_view") || actions.has("collector_boot")) {
    reason = "페이지 진입 또는 수집기 시작 상태를 기록하기 위해 전송";
  }

  return {
    rowCount: list.length,
    reason,
    actionCounts,
    preview: list.slice(0, 5).map((row) => ({
      action: row?.action || null,
      label: actionLabel(row?.action),
      event_id: row?.event_id || null,
      page_url: row?.page_url || null,
      selector: row?.selector_css || row?.selector_xpath || null,
      api_url: row?.payload?.api_context?.url || row?.AZ_api_url || null,
      status: row?.payload?.api_context?.status ?? row?.AZ_api_status ?? null
    }))
  };
}

function isProdCollectorUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "rainbowlab.ai.kr";
  } catch {
    return false;
  }
}

function resolveCollectorKey(url, config) {
  const storedKey = typeof config?.collectorKey === "string" ? config.collectorKey.trim() : "";
  if (storedKey) return storedKey;
  return "";
}

let collectorDeviceTokenRequest = null;
let collectorBrowserSessionIdRequest = null;

function createCollectorDeviceId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `install-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function getCollectorDeviceId() {
  const stored = await chrome.storage.local.get(COLLECTOR_DEVICE_ID_KEY);
  const current = stored?.[COLLECTOR_DEVICE_ID_KEY];
  if (typeof current === "string" && current.length >= 16) return current;
  const created = createCollectorDeviceId();
  await chrome.storage.local.set({ [COLLECTOR_DEVICE_ID_KEY]: created });
  return created;
}

async function clearCollectorDeviceToken() {
  await chrome.storage.local.remove([
    COLLECTOR_DEVICE_TOKEN_KEY,
    COLLECTOR_DEVICE_TOKEN_EXPIRES_KEY,
  ]);
}

async function readCollectorAuthorization(url, config) {
  const collectorKey = resolveCollectorKey(url, config);
  if (collectorKey) {
    return {
      kind: "api_key",
      headers: { "x-api-key": collectorKey, "X-Collector-Key": collectorKey },
    };
  }
  if (!isProdCollectorUrl(url)) return { kind: "none", headers: {} };

  const stored = await chrome.storage.local.get([
    COLLECTOR_DEVICE_TOKEN_KEY,
    COLLECTOR_DEVICE_TOKEN_EXPIRES_KEY,
  ]);
  const token = stored?.[COLLECTOR_DEVICE_TOKEN_KEY];
  const expiresAtMs = Number(stored?.[COLLECTOR_DEVICE_TOKEN_EXPIRES_KEY] || 0);
  if (typeof token === "string" && token && expiresAtMs > Date.now() + 5 * 60 * 1000) {
    return { kind: "device_token", headers: { Authorization: `Bearer ${token}` } };
  }

  if (!collectorDeviceTokenRequest) {
    collectorDeviceTokenRequest = (async () => {
      const installationId = await getCollectorDeviceId();
      const bootstrapUrl = new URL("/ingest/batch?bootstrap=device-token", url).toString();
      const response = await fetch(bootstrapUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Collector-Version": COLLECTOR_VERSION },
        body: JSON.stringify({
          installation_id: installationId,
          extension_id: chrome.runtime.id,
          collector_version: COLLECTOR_VERSION,
        }),
      });
      if (!response.ok) throw new Error(`collector_bootstrap_failed_${response.status}`);
      const payload = await response.json();
      if (typeof payload?.access_token !== "string" || !Number(payload?.expires_at_ms)) {
        throw new Error("collector_bootstrap_invalid_response");
      }
      await chrome.storage.local.set({
        [COLLECTOR_DEVICE_TOKEN_KEY]: payload.access_token,
        [COLLECTOR_DEVICE_TOKEN_EXPIRES_KEY]: Number(payload.expires_at_ms),
      });
      return payload.access_token;
    })().finally(() => {
      collectorDeviceTokenRequest = null;
    });
  }

  const issuedToken = await collectorDeviceTokenRequest;
  return { kind: "device_token", headers: { Authorization: `Bearer ${issuedToken}` } };
}

async function readClientNetworkContext() {
  const cacheKey = "rainbow_network_context_v1";
  const cacheTtlMs = 5 * 60 * 1000;
  const storage = chrome.storage.session || chrome.storage.local;
  const now = Date.now();
  try {
    const stored = await storage.get(cacheKey);
    const cached = stored?.[cacheKey];
    if (cached?.expires_at > now && cached?.value) return cached.value;
  } catch {}

  const ipv4Parts = (value) => {
    const parts = typeof value === "string" ? value.trim().split(".").map(Number) : [];
    return parts.length === 4 &&
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      ? parts
      : null;
  };
  const isPrivateIpv4 = (value) => {
    const parts = ipv4Parts(value);
    if (!parts) return false;
    const [a, b] = parts;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  };
  const isPublicIpv4 = (value) => {
    const parts = ipv4Parts(value);
    if (!parts || isPrivateIpv4(value)) return false;
    const [a, b] = parts;
    return a !== 0 && a !== 127 && a < 224 &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 169 && b === 254);
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  const publicIpRequest = fetch("https://api.ipify.org?format=json", {
    cache: "no-store",
    credentials: "omit",
    signal: controller.signal
  }).then(async (response) => {
    if (!response.ok) return null;
    const payload = await response.json();
    return isPublicIpv4(payload?.ip) ? payload.ip.trim() : null;
  }).catch(() => null).finally(() => clearTimeout(timeoutId));

  const interfaceRequest =
    typeof chrome.system?.network?.getNetworkInterfaces === "function"
      ? chrome.system.network.getNetworkInterfaces().catch(() => [])
      : Promise.resolve([]);
  const [publicIpv4, interfaces] = await Promise.all([publicIpRequest, interfaceRequest]);
  const virtualAdapterPattern =
    /vmware|virtual|vbox|hyper-v|zerotier|tailscale|wireguard|vpn|wsl|docker|bluetooth|vethernet/i;
  const physicalAdapterPattern = /wi-?fi|wireless|wlan|ethernet|이더넷|무선/i;
  const privateInterfaces = interfaces.map((item) => ({
    address: typeof item?.address === "string" ? item.address.trim() : "",
    prefix_length: Number(item?.prefixLength),
    adapter_class: virtualAdapterPattern.test(String(item?.name || ""))
      ? "virtual"
      : (physicalAdapterPattern.test(String(item?.name || "")) ? "physical" : "unknown")
  })).filter((item) =>
    isPrivateIpv4(item.address) &&
    Number.isInteger(item.prefix_length) &&
    item.prefix_length >= 1 && item.prefix_length <= 32
  ).slice(0, 16);
  const privateIpv4Candidates = [...new Set(privateInterfaces.map((item) => item.address))];
  const physicalCandidates = [...new Set(privateInterfaces
    .filter((item) => item.adapter_class === "physical")
    .map((item) => item.address))];
  const privateIpv4 = physicalCandidates.length === 1
    ? physicalCandidates[0]
    : (privateIpv4Candidates.length === 1 ? privateIpv4Candidates[0] : null);
  const context = {
    source: "chrome_extension_network",
    collected_at: new Date(now).toISOString(),
    preferred_ipv4: publicIpv4,
    public_ipv4: publicIpv4,
    private_ipv4: privateIpv4,
    private_ipv4_candidates: privateIpv4Candidates,
    private_ip_selection: privateIpv4
      ? (physicalCandidates.length === 1 ? "single_physical_candidate" : "single_candidate")
      : (privateIpv4Candidates.length > 1 ? "ambiguous_candidates" : "unavailable"),
    public_ip_source: publicIpv4 ? "ipify" : "unavailable",
    private_ip_source: privateIpv4Candidates.length ? "chrome_system_network" : "unavailable",
    confidence: publicIpv4 ? "high" : (privateIpv4 ? "private_only" : "unavailable"),
    ipv4_interfaces: privateInterfaces
  };
  try {
    await storage.set({
      [cacheKey]: { expires_at: now + cacheTtlMs, value: context }
    });
  } catch {}
  return context;
}

function normalizeStoredIngestUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (
      parsed.origin !== "https://rainbowlab.ai.kr" ||
      parsed.pathname !== "/ingest/batch"
    ) return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeStoredRuntimeConfigUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (
      parsed.origin !== "https://rainbowlab.ai.kr" ||
      parsed.pathname !== "/collector/runtime-config"
    ) return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function padDatePart(value, width = 2) {
  return String(value).padStart(width, "0");
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toCollectorDateTime(value) {
  const parsed = new Date(value);
  const sourceDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const date = new Date(sourceDate.getTime() + KST_OFFSET_MS);
  return [
    `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`,
    `${padDatePart(date.getUTCHours())}:${padDatePart(date.getUTCMinutes())}:${padDatePart(date.getUTCSeconds())}.${padDatePart(date.getUTCMilliseconds(), 3)}`
  ].join(" ");
}

function toEventTimestampMs(value) {
  const parsed = new Date(value);
  const timeMs = parsed.getTime();
  return Number.isFinite(timeMs) ? timeMs : Date.now();
}

function toJsonSafeObject(value) {
  if (!value || typeof value !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function toJsonSafeString(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toUrlPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return trimmed.split(/[?#]/, 1)[0] || "/";
  try {
    return new URL(trimmed).pathname || "/";
  } catch {
    return null;
  }
}

function inferElementType(action, payload) {
  if (action === "page_view") return "page";
  if (action === "ui_outcome") return "state";
  if (
    action === "api_transaction" ||
    action === "api_transaction_error" ||
    action === "api_transaction_timeout" ||
    action === "route_change" ||
    action === "screen_change" ||
    action === "collector_boot" ||
    action === "page_close" ||
    action === "submit"
  ) return "event";
  if (payload?.api_context) return "event";
  if (action === "menu_click") return "menu";
  if (
    action === "click" &&
    payload?.menu_context &&
    payload.menu_context.source !== "url" &&
    !payload.menu_context.warnings?.includes?.("url_fallback")
  ) return "menu";
  return null;
}

function extractInputData(payload, row, action) {
  const inputContext = payload?.input_context && typeof payload.input_context === "object"
    ? payload.input_context
    : null;

  if (inputContext?.value != null) return toJsonSafeString(inputContext.value);
  if (inputContext?.data != null) return toJsonSafeString(inputContext.data);
  if (inputContext?.pasted_text != null) return toJsonSafeString(inputContext.pasted_text);
  if (payload?.value != null) return toJsonSafeString(payload.value);
  if (payload?.data != null) return toJsonSafeString(payload.data);

  if (
    typeof row?.element_text === "string" &&
    ["input", "change", "beforeinput", "compositionend", "paste"].includes(String(action || ""))
  ) {
    return row.element_text;
  }

  return null;
}

function normalizeRowForCollector(row, ingestUrl) {
  if (!isProdCollectorUrl(ingestUrl)) return row;
  if (!row || typeof row !== "object") return row;
  if (Object.prototype.hasOwnProperty.call(row, "AZ_event_time")) return row;

  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const pageContext =
    payload.page_context && typeof payload.page_context === "object" ? payload.page_context : {};
  const elementContext =
    payload.element_context && typeof payload.element_context === "object" ? payload.element_context : {};
  const apiContext =
    payload.api_context && typeof payload.api_context === "object" ? payload.api_context : {};
  const relationContext =
    payload.relation_context && typeof payload.relation_context === "object" ? payload.relation_context : null;
  const eventContext =
    payload.event_context && typeof payload.event_context === "object" ? payload.event_context : null;
  const inputContext =
    payload.input_context && typeof payload.input_context === "object" ? payload.input_context : {};
  const menuContext =
    payload.menu_context && typeof payload.menu_context === "object" ? payload.menu_context : null;
  const uiOutcome =
    payload.ui_outcome && typeof payload.ui_outcome === "object" ? payload.ui_outcome : null;
  const gridContext =
    payload.grid_context && typeof payload.grid_context === "object" ? payload.grid_context : null;
  const gridCellClick =
    payload.grid_cell_click && typeof payload.grid_cell_click === "object" ? payload.grid_cell_click : null;
  const popupContext =
    payload.popup_context && typeof payload.popup_context === "object" ? payload.popup_context : null;
  const textContext =
    payload.text_context && typeof payload.text_context === "object" ? payload.text_context : null;

  const action = typeof row.action === "string" && row.action.trim() ? row.action.trim() : "change";
  const rawEventTime =
    typeof row.event_time === "string" && row.event_time.trim()
      ? row.event_time
      : new Date().toISOString();
  const eventTime = toCollectorDateTime(rawEventTime);
  const pageUrl =
    typeof row.page_url === "string" && row.page_url.trim()
      ? row.page_url
      : (typeof pageContext.page_url === "string" ? pageContext.page_url : null);
  const pageSessionId =
    typeof row.page_session_id === "string" && row.page_session_id.trim()
      ? row.page_session_id
      : (typeof pageContext.page_session_id === "string" ? pageContext.page_session_id : null);
  const loginId = pageSessionId ? `session:${pageSessionId}` : `collector:${row.event_id || Date.now()}`;
  const inputData = extractInputData(payload, row, action);
  const elementType = inferElementType(action, payload);

  return {
    AZ_event_id: typeof row.event_id === "string" && row.event_id.trim() ? row.event_id : null,
    AZ_event_time: eventTime,
    AZ_event_ts_ms: toEventTimestampMs(rawEventTime),
    AZ_event_action: action,
    AZ_event_subtype: typeof payload.kind === "string" && payload.kind.trim() ? payload.kind : null,
    AZ_login_id: loginId,
    AZ_session_page_id: pageSessionId,
    AZ_url: pageUrl,
    AZ_url_path: toUrlPath(pageUrl),
    AZ_page_title:
      typeof row.page_title === "string" ? row.page_title : (typeof pageContext.page_title === "string" ? pageContext.page_title : null),
    AZ_selector_css:
      typeof row.selector_css === "string" ? row.selector_css : (typeof elementContext.selector_css === "string" ? elementContext.selector_css : null),
    AZ_selector_xpath:
      typeof row.selector_xpath === "string" ? row.selector_xpath : (typeof elementContext.selector_xpath === "string" ? elementContext.selector_xpath : null),
    AZ_element_tag:
      typeof row.element_tag === "string" ? row.element_tag : (typeof elementContext.element_tag === "string" ? elementContext.element_tag : null),
    AZ_element_text:
      typeof row.element_text === "string" ? row.element_text : (typeof elementContext.element_text === "string" ? elementContext.element_text : null),
    AZ_element_type: elementType,
    AZ_data: inputData,
    AZ_input_length: typeof inputData === "string" ? inputData.length : null,
    AZ_api_method: typeof apiContext.method === "string" ? apiContext.method : null,
    AZ_api_url: typeof apiContext.url === "string" ? apiContext.url : null,
    AZ_api_path: toUrlPath(apiContext.url),
    AZ_api_status: apiContext.status ?? null,
    AZ_api_latency_ms: apiContext.duration_ms ?? null,
    AZ_data_testid: typeof elementContext.data_testid === "string" ? elementContext.data_testid : null,
    AZ_associated_label: typeof elementContext.associated_label === "string" ? elementContext.associated_label : null,
    AZ_locators_json: {
      source: "extension_generic_row_bridge",
      session: {
        page_session_id: pageSessionId
      },
      page: toJsonSafeObject(pageContext),
      element: toJsonSafeObject(elementContext),
      input_context: toJsonSafeObject(inputContext),
      api_context: toJsonSafeObject(apiContext),
      event_context: toJsonSafeObject(eventContext),
      relation_context: toJsonSafeObject(relationContext),
      menu_context: toJsonSafeObject(menuContext),
      grid_context: toJsonSafeObject(gridContext),
      grid_cell_click: toJsonSafeObject(gridCellClick),
      popup_context: toJsonSafeObject(popupContext),
      text_context: toJsonSafeObject(textContext),
      ui_outcome: toJsonSafeObject(uiOutcome),
      analysis: {
        event_sequence: row.event_sequence ?? null,
        interaction_id: row.interaction_id ?? null,
        correlation_id: row.correlation_id ?? null,
        collector_build: row.collector_build ?? COLLECTOR_VERSION,
        extension_version: row.extension_version ?? payload.extension_version ?? COLLECTOR_VERSION,
        extension_build: row.extension_build ?? payload.extension_build ?? null,
        sdk_version: row.sdk_version ?? payload.sdk_version ?? null,
        sdk_build: row.sdk_build ?? payload.sdk_build ?? null,
        runtime_config_version: row.runtime_config_version ?? payload?.runtime_context?.config_version ?? null,
        runtime_config_schema_version: row.runtime_config_schema_version ?? payload?.runtime_context?.schema_version ?? null,
        runtime_rule_ids: row.runtime_rule_ids ?? payload?.runtime_context?.matched_rule_ids ?? null,
        runtime_modules: row.runtime_modules ?? payload?.runtime_context?.active_module_names ?? null,
        context_schema_version: payload.context_schema_version ?? textContext?.version ?? null,
        bounds: row.bounds ?? null
      },
      raw_payload: toJsonSafeObject(payload)
    },
    AZ_snapshot_dom_after: row.snapshot ?? null,
    snapshot: row.snapshot ?? null
  };
}

function attachNetworkContext(row, networkContext) {
  if (!row || typeof row !== "object") return row;
  let locators = row.AZ_locators_json;
  if (typeof locators === "string") {
    try { locators = JSON.parse(locators); } catch { locators = {}; }
  }
  if (!locators || typeof locators !== "object" || Array.isArray(locators)) locators = {};
  const existingIp = typeof row.AZ_ip_address === "string" ? row.AZ_ip_address.trim() : "";
  return {
    ...row,
    AZ_ip_address:
      existingIp && existingIp !== "(unavailable-in-extension)"
        ? existingIp
        : (networkContext?.preferred_ipv4 || null),
    AZ_locators_json: {
      ...locators,
      network_context: toJsonSafeObject(networkContext)
    }
  };
}

async function getCollectorBrowserSessionId() {
  if (collectorBrowserSessionIdRequest) return collectorBrowserSessionIdRequest;
  collectorBrowserSessionIdRequest = (async () => {
    const storage = chrome.storage.session || chrome.storage.local;
    const stored = await storage.get(COLLECTOR_BROWSER_SESSION_ID_KEY);
    const current = stored?.[COLLECTOR_BROWSER_SESSION_ID_KEY];
    if (typeof current === "string" && current.length >= 16) return current;
    const created = createCollectorDeviceId().replace(/^install-/, "browser-");
    await storage.set({ [COLLECTOR_BROWSER_SESSION_ID_KEY]: created });
    return created;
  })().finally(() => {
    collectorBrowserSessionIdRequest = null;
  });
  return collectorBrowserSessionIdRequest;
}

function attachIdentityContext(row, sourceRow) {
  if (!row || typeof row !== "object") return row;
  const identity = normalizeIdentityContext(sourceRow?.__rainbow_identity);
  if (!identity) return row;

  let locators = row.AZ_locators_json;
  if (typeof locators === "string") {
    try { locators = JSON.parse(locators); } catch { locators = {}; }
  }
  if (!locators || typeof locators !== "object" || Array.isArray(locators)) locators = {};

  return {
    ...row,
    AZ_login_id: identity.subject,
    AZ_locators_json: {
      ...locators,
      identity_context: identity
    }
  };
}

function truncateQueueLogValue(value, maxLength = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function queueRowPreview(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const eventContext = payload.event_context || {};
  const relationContext = payload.relation_context || {};
  const pageContext = payload.page_context || {};
  const apiContext = payload.api_context || {};
  const menuContext = payload.menu_context || {};
  const gridContext = payload.grid_context || payload.grid_cell_click || {};
  const popupContext = payload.popup_context || {};
  const activePopup = popupContext.target_popup || popupContext.stack?.at?.(-1) || {};

  return {
    event_sequence: row?.event_sequence ?? eventContext.event_sequence ?? null,
    action: row?.action || eventContext.action || payload.kind || null,
    event_id: row?.event_id || eventContext.event_id || null,
    event_time: row?.event_time || eventContext.event_time || null,
    page_session_id: row?.page_session_id || pageContext.page_session_id || null,
    interaction_id: row?.interaction_id || eventContext.interaction_id || null,
    related_interaction_id:
      row?.related_interaction_id ||
      relationContext.related_interaction_id ||
      eventContext.related_interaction_id ||
      null,
    element_text: truncateQueueLogValue(row?.element_text),
    api_path: apiContext.url_path || row?.AZ_api_url || null,
    api_status: apiContext.status ?? row?.AZ_api_status ?? null,
    menu_path: menuContext.path_text || menuContext.selected_path_text || null,
    grid_id: gridContext.grid_id || null,
    grid_row: gridContext.row_index ?? null,
    grid_column: gridContext.column_key || gridContext.column_id || gridContext.column_label || null,
    popup_title:
      popupContext.active_popup_title ||
      activePopup.title ||
      null,
    identity_held: rowIsIdentityHeld(row)
  };
}

function debugLogQueuedEvents(rows) {
  if (!DEBUG_LOG_QUEUE_CONTENTS) return;
  try {
    const queuedRows = Array.isArray(rows) ? rows : [];
    for (const row of queuedRows) {
      const event = {
        ...queueRowPreview(row),
        queue_size: pendingRows.length
      };
      console.group(
        `[Rainbow Collector] 큐 적재 이벤트 · seq=${event.event_sequence ?? "-"} · action=${event.action || "-"}`
      );
      console.table([event], QUEUE_LOG_COLUMNS);
      console.groupEnd();
    }
  } catch (error) {
    console.warn("[Rainbow Collector] 큐 적재 이벤트 로그 생성 실패", {
      "실패 이유": error?.message || String(error),
      "현재 대기 row 수": pendingRows.length
    });
  }
}

function normalizeRowsForUpload(rows, ingestUrl, networkContext, collectorContext = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const normalized = normalizeRowForCollector(row, ingestUrl);
    const withSessionContext = applyCollectorSessionContext(normalized, row, {
      ...collectorContext,
      tabId: rowTabId(row)
    });
    return attachNetworkContext(attachIdentityContext(withSessionContext, row), networkContext);
  });
}

function buildQueueOverflowDiagnosticRow(droppedRowsCount) {
  const eventTime = new Date().toISOString();
  return {
    event_id: `queue-overflow-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    event_sequence: null,
    interaction_id: null,
    event_time: eventTime,
    page_session_id: null,
    action: "queue_overflow",
    collector_build: COLLECTOR_VERSION,
    extension_version: COLLECTOR_VERSION,
    extension_build: `shell-${COLLECTOR_VERSION}`,
    sdk_version: null,
    sdk_build: null,
    page_url: null,
    page_title: null,
    selector_css: "PAGE",
    selector_xpath: "/html[1]",
    element_tag: "html",
    element_text: "queue_overflow",
    bounds: null,
    correlation_id: null,
    snapshot: null,
    payload: {
      kind: "collector_diagnostic",
      event_context: {
        reason: "background_queue_overflow"
      },
      page_context: {
        page_session_id: null,
        page_url: null,
        page_title: null,
        origin: null,
        path: null,
        search: null,
        hash: null
      },
      element_context: {
        selector_css: "PAGE",
        selector_xpath: "/html[1]",
        element_tag: "html",
        element_text: "queue_overflow",
        bounds: null
      },
      overflow_context: {
        dropped_rows_count: droppedRowsCount,
        soft_max_queue_rows: MAX_QUEUE_ROWS,
        hard_max_queue_rows: QUEUE_HARD_MAX_ROWS,
        reason: "background_queue_overflow"
      },
      legacy: {}
    }
  };
}

function truncateQueueToMax() {
  if (pendingRows.length <= QUEUE_HARD_MAX_ROWS) return;
  scheduleUpload(0, "큐가 하드 한도를 넘어 누락 방지를 위해 즉시 서버 전송");
  const overflow = pendingRows.length - QUEUE_HARD_MAX_ROWS;
  const existingDiagnostic = pendingRows.find((row) =>
    row?.action === "queue_overflow" &&
    row?.payload?.overflow_context?.reason === "background_queue_overflow"
  );
  const reserveForDiagnostic = existingDiagnostic ? 0 : 1;
  const removed = pendingRows.splice(0, Math.min(pendingRows.length, overflow + reserveForDiagnostic));
  const droppedRowsCount = removed.length;
  if (existingDiagnostic) {
    existingDiagnostic.event_time = new Date().toISOString();
    existingDiagnostic.payload = {
      ...(existingDiagnostic.payload || {}),
      overflow_context: {
        ...(existingDiagnostic.payload?.overflow_context || {}),
        dropped_rows_count:
          Number(existingDiagnostic.payload?.overflow_context?.dropped_rows_count || 0) + droppedRowsCount,
        soft_max_queue_rows: MAX_QUEUE_ROWS,
        hard_max_queue_rows: QUEUE_HARD_MAX_ROWS,
        reason: "background_queue_overflow"
      }
    };
  } else if (droppedRowsCount > 0) {
    pendingRows.push(buildQueueOverflowDiagnosticRow(droppedRowsCount));
  }
  while (pendingRows.length > QUEUE_HARD_MAX_ROWS) {
    pendingRows.shift();
  }
  console.warn("[Rainbow Collector] 큐 하드 한도 초과로 오래된 데이터를 일부 제거", {
    "제거 row 수": droppedRowsCount,
    "전송 시작 기준 row 수": QUEUE_URGENT_FLUSH_ROWS,
    "소프트 최대 row 수": MAX_QUEUE_ROWS,
    "하드 최대 row 수": QUEUE_HARD_MAX_ROWS,
    "이유": "서버 전송 실패 또는 네트워크 지연이 계속되어 브라우저 저장소 보호용 최후 안전장치가 작동함",
    "정상 기준": "이 로그는 자주 나오면 안 되며, 보통은 하드 한도 도달 전에 즉시 전송됩니다"
  });
}

function estimateBatchBytes(rows) {
  try {
    return new TextEncoder().encode(JSON.stringify({ rows, ts: 0 })).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function takeUploadBatch() {
  if (pendingRows.length === 0) return [];

  const batch = [];
  for (const row of pendingRows) {
    if (rowIsIdentityHeld(row)) continue;
    if (batch.length >= MAX_BATCH_ROWS) break;
    const nextBatch = batch.concat(row);
    const nextBytes = estimateBatchBytes(nextBatch);
    if (batch.length > 0 && nextBytes > MAX_BATCH_BYTES) break;
    batch.push(row);
    if (nextBytes >= MAX_BATCH_BYTES) break;
  }

  return batch;
}

function removeUploadedRows(rows) {
  const uploaded = new Set(rows);
  for (let index = pendingRows.length - 1; index >= 0; index -= 1) {
    if (uploaded.has(pendingRows[index])) pendingRows.splice(index, 1);
  }
}

function computeRetryDelay(attempt) {
  const exponentialDelay = BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1));
  return Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
}

async function readCollectorConfig() {
  const stored = await chrome.storage.local.get([
    COLLECTOR_INGEST_URL_KEY,
    TENANT_ID_KEY,
    COLLECTOR_KEY_KEY,
    RUNTIME_CONFIG_URL_KEY
  ]);

  return {
    collectorIngestUrl: normalizeStoredIngestUrl(stored?.[COLLECTOR_INGEST_URL_KEY]),
    tenantId:
      typeof stored?.[TENANT_ID_KEY] === "string" && stored[TENANT_ID_KEY].trim()
        ? stored[TENANT_ID_KEY].trim()
        : "",
    collectorKey:
      typeof stored?.[COLLECTOR_KEY_KEY] === "string" && stored[COLLECTOR_KEY_KEY].trim()
        ? stored[COLLECTOR_KEY_KEY].trim()
        : "",
    collectorRuntimeConfigUrl: normalizeStoredRuntimeConfigUrl(stored?.[RUNTIME_CONFIG_URL_KEY])
  };
}

async function injectCollectorScript(tabId) {
  if (typeof tabId !== "number") return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  } catch (error) {
    console.warn("[Rainbow Collector] content script 주입 실패", {
      "실패 이유": error?.message || String(error),
      "영향": "이 탭/프레임에서는 이벤트 수집이 시작되지 않을 수 있음"
    });
  }
}

async function injectCollectorIntoMatchingTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs
    .filter((tab) => matchesCollectorTarget(tab.url))
    .map((tab) => injectCollectorScript(tab.id)));
}

async function hydrateQueue() {
  if (hydrated) return;
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const rows = Array.isArray(stored?.[QUEUE_KEY]) ? stored[QUEUE_KEY] : [];
  pendingRows.push(...rows);
  truncateQueueToMax();
  hydrated = true;
}

async function persistQueue() {
  truncateQueueToMax();
  await chrome.storage.local.set({ [QUEUE_KEY]: pendingRows });
}

function hasImmediateFlushRow(rows) {
  return rows.some((row) => row?.action === "page_close");
}

async function enqueueRows(rows, sender = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  await hydrateIdentityState();
  await hydrateQueue();
  const preparedRows = prepareRowsForIdentity(rows, sender);
  pendingRows.push(...preparedRows);
  const hasImmediateRow = hasImmediateFlushRow(preparedRows);
  const shouldFlushImmediately = hasImmediateRow || pendingRows.length >= QUEUE_URGENT_FLUSH_ROWS;
  if (shouldFlushImmediately) {
    console.info("[Rainbow Collector] 즉시 서버 전송을 시작합니다", {
      "현재 대기 row 수": pendingRows.length,
      "즉시 전송 기준 row 수": QUEUE_URGENT_FLUSH_ROWS,
      "소프트 최대 row 수": MAX_QUEUE_ROWS,
      "이유": hasImmediateRow
        ? "page_close 이벤트는 탭 종료 전 누락 방지를 위해 바로 서버로 보냄"
        : "큐가 최대치에 가까워져 누락 위험을 줄이기 위해 바로 서버로 보냄"
    });
  }
  truncateQueueToMax();
  await persistQueue();
  debugLogQueuedEvents(preparedRows);
  scheduleUpload(
    shouldFlushImmediately ? 0 : BASE_UPLOAD_DELAY_MS,
    shouldFlushImmediately
      ? (hasImmediateRow
        ? "page_close 이벤트 누락 방지를 위해 즉시 서버 전송"
        : "큐가 최대치에 가까워져 누락 방지를 위해 즉시 서버 전송")
      : "content script가 전달한 수집 데이터를 idle batch로 서버 전송",
    { debounce: !shouldFlushImmediately }
  );
}

function scheduleUpload(delayMs = BASE_UPLOAD_DELAY_MS, reason = "전송 대기 중인 데이터를 서버로 전송", options = {}) {
  if (reason) scheduledUploadReason = reason;
  if (uploadInFlight) {
    flushRequestedWhileInFlight = true;
    return;
  }
  const normalizedDelayMs = Math.max(0, delayMs);
  const shouldDebounce = Boolean(options.debounce) && normalizedDelayMs > 0;
  if (uploadTimer) {
    const canReplaceTimer = normalizedDelayMs === 0 || (shouldDebounce && uploadTimerIsDebounceable);
    if (!canReplaceTimer) return;
    clearTimeout(uploadTimer);
    uploadTimer = null;
    uploadTimerIsDebounceable = false;
  }
  uploadTimerIsDebounceable = shouldDebounce;
  uploadTimer = setTimeout(() => {
    uploadTimer = null;
    uploadTimerIsDebounceable = false;
    void flushUpload();
  }, normalizedDelayMs);
}

async function ensureQueueFlushAlarm() {
  if (!chrome.alarms?.create) return;
  try {
    await chrome.alarms.create(QUEUE_FLUSH_ALARM_NAME, {
      periodInMinutes: QUEUE_FLUSH_ALARM_PERIOD_MINUTES
    });
  } catch (error) {
    console.warn("[Rainbow Collector] 큐 재전송 알람 설정 실패", {
      "실패 이유": error?.message || String(error),
      "영향": "브라우저가 idle 상태일 때 큐 재전송이 늦어질 수 있음"
    });
  }
}

async function wakeQueueFlush(reason = "alarm") {
  await hydrateQueue();
  if (pendingRows.length === 0) return;
  const readableReason =
    reason === "alarm"
      ? "주기 알람이 깨어나 이전에 쌓인 큐 데이터를 다시 전송"
      : reason === "runtime_startup"
        ? "브라우저/서비스워커 시작 후 남아 있던 큐 데이터를 전송"
        : reason === "runtime_installed"
          ? "확장 설치/리로드 후 남아 있던 큐 데이터를 전송"
          : `${reason} 사유로 남아 있던 큐 데이터를 전송`;
  console.info("[Rainbow Collector] 큐 재전송 대기", {
    "이유": readableReason,
    "대기 row 수": pendingRows.length
  });
  scheduleUpload(0, readableReason);
}

function resolveIngestUrl(rows, config) {
  if (config?.collectorIngestUrl) {
    return config.collectorIngestUrl;
  }
  return DEFAULT_INGEST_URL;
}

function normalizeRuntimeConfig(value, source = "extension-default") {
  const config = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ttlMs = Number(config.ttl_ms);
  const apiCapture = config.api_capture && typeof config.api_capture === "object" && !Array.isArray(config.api_capture)
    ? config.api_capture
    : {};
  const apiTransactionTtlMs = Number(apiCapture.transaction_ttl_ms);
  const apiMaxBufferSize = Number(apiCapture.max_buffer_size);

  return {
    ...DEFAULT_RUNTIME_CONFIG,
    schema_version: Number.isFinite(Number(config.schema_version)) ? Math.trunc(Number(config.schema_version)) : 1,
    version: typeof config.version === "string" && config.version.trim() ? config.version.trim() : "local-default",
    source,
    fetched_at: typeof config.fetched_at === "string" && config.fetched_at.trim() ? config.fetched_at : null,
    ttl_ms: Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, 60 * 60 * 1000) : DEFAULT_RUNTIME_CONFIG_TTL_MS,
    modules: config.modules && typeof config.modules === "object" && !Array.isArray(config.modules) ? config.modules : {},
    event_types: config.event_types && typeof config.event_types === "object" && !Array.isArray(config.event_types) ? config.event_types : {},
    selector_packs: config.selector_packs && typeof config.selector_packs === "object" && !Array.isArray(config.selector_packs) ? config.selector_packs : {},
    workflow_rules: Array.isArray(config.workflow_rules) ? config.workflow_rules.slice(0, 200) : [],
    privacy: config.privacy && typeof config.privacy === "object" && !Array.isArray(config.privacy) ? config.privacy : {},
    api_capture: {
      ...DEFAULT_API_CAPTURE_CONFIG,
      ...apiCapture,
      enabled: apiCapture.enabled !== false,
      transaction_mode: apiCapture.transaction_mode !== false,
      emit_legacy_api_rows: apiCapture.emit_legacy_api_rows === true,
      capture_request_body: false,
      capture_response_body: false,
      capture_headers: false,
      allowed_header_names: Array.isArray(apiCapture.allowed_header_names) ? apiCapture.allowed_header_names.slice(0, 50) : [],
      transaction_ttl_ms: Number.isFinite(apiTransactionTtlMs) && apiTransactionTtlMs > 0
        ? Math.min(apiTransactionTtlMs, 120000)
        : DEFAULT_API_CAPTURE_CONFIG.transaction_ttl_ms,
      max_buffer_size: Number.isFinite(apiMaxBufferSize) && apiMaxBufferSize > 0
        ? Math.min(Math.trunc(apiMaxBufferSize), 2000)
        : DEFAULT_API_CAPTURE_CONFIG.max_buffer_size
    }
  };
}

function runtimeConfigIsFresh(cache) {
  const fetchedAtMs = Number(cache?.fetchedAtMs || 0);
  const ttlMs = Number(cache?.config?.ttl_ms || DEFAULT_RUNTIME_CONFIG_TTL_MS);
  return cache?.config && fetchedAtMs > 0 && Date.now() - fetchedAtMs <= ttlMs;
}

function resolveRuntimeConfigUrl(pageUrl, config) {
  if (config?.collectorRuntimeConfigUrl) return config.collectorRuntimeConfigUrl;
  const ingestUrl = resolveIngestUrl([{ page_url: pageUrl || null }], config);
  try {
    return isProdCollectorUrl(ingestUrl)
      ? new URL("/ingest/batch?runtime_config=1", ingestUrl).toString()
      : new URL("/collector/runtime-config", ingestUrl).toString();
  } catch {
    return null;
  }
}

async function readRuntimeConfigForPage(pageUrl = null) {
  const stored = await chrome.storage.local.get(RUNTIME_CONFIG_CACHE_KEY);
  const cached = stored?.[RUNTIME_CONFIG_CACHE_KEY];
  if (runtimeConfigIsFresh(cached)) return cached.config;

  const config = await readCollectorConfig();
  const runtimeConfigUrl = resolveRuntimeConfigUrl(pageUrl, config);
  if (!runtimeConfigUrl) return normalizeRuntimeConfig(null);

  try {
    const collectorAuthorization = await readCollectorAuthorization(runtimeConfigUrl, config);
    const response = await fetch(runtimeConfigUrl, {
      method: "GET",
      headers: {
        "X-Collector-Version": COLLECTOR_VERSION,
        ...(config.tenantId ? { "X-Tenant-Id": config.tenantId } : {}),
        ...collectorAuthorization.headers,
      }
    });

    if (!response.ok) {
      if (response.status === 401 && collectorAuthorization.kind === "device_token") {
        await clearCollectorDeviceToken();
      }
      throw new Error(`runtime_config_failed_${response.status}`);
    }

    const nextConfig = normalizeRuntimeConfig(await response.json(), "server");
    await chrome.storage.local.set({
      [RUNTIME_CONFIG_CACHE_KEY]: {
        config: nextConfig,
        fetchedAtMs: Date.now(),
        url: runtimeConfigUrl
      }
    });
    return nextConfig;
  } catch (error) {
    if (cached?.config) {
      return {
        ...normalizeRuntimeConfig(cached.config, "cache-stale"),
        load_error: String(error?.message || error)
      };
    }
    return {
      ...normalizeRuntimeConfig(null),
      load_error: String(error?.message || error)
    };
  }
}

function debugLogUploadPayload(ingestUrl, sourceRows, payload, context = {}) {
  if (!DEBUG_LOG_ALL_UPLOAD_PAYLOADS) return;
  try {
    const rowCount = Array.isArray(payload?.rows) ? payload.rows.length : 0;
    const summary = summarizeRowsForConsole(sourceRows);
    const reason = context.reason || summary.reason;
    console.groupCollapsed(`[Rainbow Collector] 서버 전송 rows=${rowCount} · ${reason}`);
    console.log("요약", {
      "서버 전송 트리거": reason,
      "전송된 데이터 종류": summary.reason,
      "이벤트 종류별 개수": summary.actionCounts,
      "전송 대상": ingestUrl,
      "큐 상태": {
        "전송 전 대기 row 수": context.pendingBefore ?? null,
        "이번 전송 row 수": rowCount,
        "최대 batch row 수": MAX_BATCH_ROWS,
        "재시도 횟수": retryAttempt
      },
      "대표 이벤트": summary.preview
    });
    console.log("원본 rows", sourceRows);
    console.log("서버 전송 payload", payload);
    console.groupEnd();
  } catch (error) {
    console.log("[Rainbow Collector] 서버 전송 payload", { ingestUrl, sourceRows, payload, context });
  }
}

async function flushUpload() {
  await hydrateQueue();
  if (uploadInFlight || pendingRows.length === 0) return;

  const rows = takeUploadBatch();
  if (rows.length === 0) return;

  uploadInFlight = true;
  flushRequestedWhileInFlight = false;
  const uploadReason = scheduledUploadReason || "전송 대기 중인 데이터를 서버로 전송";
  scheduledUploadReason = "전송 대기 중인 데이터를 서버로 전송";
  const pendingBefore = pendingRows.length;
  let config = null;
  let ingestUrl = DEFAULT_INGEST_URL;
  let uploadRows = [];
  let collectorAuthorization = { kind: "none", headers: {} };
  let shouldContinue = false;
  let retryDelay = null;

  try {
    config = await readCollectorConfig();
    ingestUrl = resolveIngestUrl(rows, config);
    const [networkContext, installationId, browserSessionId] = await Promise.all([
      readClientNetworkContext(),
      getCollectorDeviceId(),
      getCollectorBrowserSessionId()
    ]);
    uploadRows = normalizeRowsForUpload(rows, ingestUrl, networkContext, {
      installationId,
      browserSessionId,
      userAgent: globalThis.navigator?.userAgent || null
    });
    if (uploadRows.length === 0) return;
    collectorAuthorization = await readCollectorAuthorization(ingestUrl, config);
    const uploadPayload = { rows: uploadRows, ts: Date.now() };
    debugLogUploadPayload(ingestUrl, rows, uploadPayload, {
      reason: uploadReason,
      pendingBefore
    });

    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Collector-Version": COLLECTOR_VERSION,
        ...(config.tenantId ? { "X-Tenant-Id": config.tenantId } : {}),
        ...collectorAuthorization.headers,
      },
      body: JSON.stringify(uploadPayload)
    });

    if (!response.ok) {
      if (response.status === 401 && collectorAuthorization.kind === "device_token") {
        await clearCollectorDeviceToken();
      }
      throw new Error(`ingest_failed_${response.status}`);
    }

    removeUploadedRows(rows);
    await persistQueue();
    retryAttempt = 0;
    shouldContinue = hasUploadEligibleRows();
    if (DEBUG_LOG_ALL_UPLOAD_PAYLOADS) {
      console.info("[Rainbow Collector] 서버 전송 성공", {
        "전송 row 수": uploadRows.length,
        "남은 큐 row 수": pendingRows.length,
        "전송 대상": ingestUrl
      });
    }
  } catch (error) {
    retryAttempt += 1;
    retryDelay = computeRetryDelay(retryAttempt);
    console.warn("[Rainbow Collector] 서버 전송 실패 · 큐에 보관 후 재시도 대기", {
      "실패 이유": error?.message || String(error),
      "이번 전송 row 수": rows.length,
      "큐에 남은 row 수": pendingRows.length,
      "재시도 횟수": retryAttempt,
      "다음 재시도 대기 ms": retryDelay,
      "전송 대상": ingestUrl
    });
  } finally {
    uploadInFlight = false;
    if (retryDelay != null) {
      scheduleUpload(retryDelay, "서버 전송 실패로 큐에 보관된 데이터를 재시도");
      return;
    }
    if (shouldContinue || flushRequestedWhileInFlight) {
      const nextReason = shouldContinue
        ? "batch 제한 때문에 남은 큐 데이터를 이어서 전송"
        : "전송 중 새 데이터가 들어와 이어서 전송";
      flushRequestedWhileInFlight = false;
      scheduleUpload(0, nextReason);
    }
  }
}

function installMainWorldBridge(bridgeNonce) {
  if (window.__AZ_TEST_BRIDGE_INSTALLED__) return;
  window.__AZ_TEST_BRIDGE_INSTALLED__ = true;

  const post = (type, payload) => {
    window.postMessage({
      source: "az-collector-test",
      nonce: bridgeNonce,
      type,
      payload
    }, "*");
  };

  const isInternalCollectorEndpoint = (url) => {
    try {
      const parsed = new URL(url, location.href);
      return (
        parsed.pathname === "/collector-test/events" ||
        parsed.pathname === "/collector-test/db-status" ||
        parsed.pathname === "/collector-test/dev/content.js" ||
        parsed.pathname === "/ingest/batch"
      );
    } catch {
      return /\/collector-test\/events|\/collector-test\/db-status|\/collector-test\/dev\/content\.js|\/ingest\/batch/.test(String(url || ""));
    }
  };

  const markInternalCollectorPayload = (payload) => {
    if (!payload || !isInternalCollectorEndpoint(payload.url)) return payload;
    return {
      ...payload,
      requestBody: "[INTERNAL_COLLECTOR_BODY_SKIPPED]",
      responseBody: "[INTERNAL_COLLECTOR_BODY_SKIPPED]",
      body_capture_skipped: true,
      body_capture_skip_reason: "internal_collector_endpoint"
    };
  };

  const normalizeCprText = (value) =>
    String(value ?? "").replace(/\s+/g, " ").trim();

  const splitCprPath = (value) => {
    const values = Array.isArray(value) ? value : [value];
    const parts = [];
    for (const item of values) {
      for (const part of String(item ?? "").split(/\s*(?:>|›|»)\s*/)) {
        const text = normalizeCprText(part);
        if (text && parts[parts.length - 1] !== text) parts.push(text);
      }
    }
    return parts;
  };

  const readCprValue = (row, key, ds, index) => {
    const keys = [key, String(key || "").toLowerCase(), String(key || "").toUpperCase()];
    for (const candidateKey of keys) {
      try {
        if (row && Object.prototype.hasOwnProperty.call(row, candidateKey)) return row[candidateKey];
      } catch {}
      try {
        if (row && typeof row.getValue === "function") {
          const value = row.getValue(candidateKey);
          if (value != null) return value;
        }
      } catch {}
      try {
        if (ds && typeof ds.getValue === "function") {
          const value = ds.getValue(index, candidateKey);
          if (value != null) return value;
        }
      } catch {}
    }
    return null;
  };

  const cprRowCount = (ds) => {
    for (const method of ["getRowCount", "getRowCnt", "getLength"]) {
      try {
        if (typeof ds?.[method] === "function") {
          const count = Number(ds[method]());
          if (Number.isFinite(count)) return count;
        }
      } catch {}
    }
    if (Array.isArray(ds?._data)) return ds._data.length;
    if (Array.isArray(ds?.data)) return ds.data.length;
    return 0;
  };

  const cprRowData = (ds, index) => {
    for (const method of ["getRowData", "getRow", "getRowState"]) {
      try {
        if (typeof ds?.[method] === "function") {
          const row = ds[method](index);
          if (row && typeof row === "object") return row;
        }
      } catch {}
    }
    if (Array.isArray(ds?._data)) return ds._data[index] || null;
    if (Array.isArray(ds?.data)) return ds.data[index] || null;
    return null;
  };

  const cprDatasetRows = (ds, maxRows = 3000) => {
    const count = Math.min(cprRowCount(ds), maxRows);
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      const row = cprRowData(ds, index) || {};
      rows.push({
        index,
        MENU_ID: normalizeCprText(readCprValue(row, "MENU_ID", ds, index)),
        MENU_NM: normalizeCprText(readCprValue(row, "MENU_NM", ds, index)),
        UMENU_ID: normalizeCprText(readCprValue(row, "UMENU_ID", ds, index)),
        TOP_MENU_ID: normalizeCprText(readCprValue(row, "TOP_MENU_ID", ds, index)),
        CALL_PAGE: normalizeCprText(readCprValue(row, "CALL_PAGE", ds, index)),
        UNIT_SYSTEM_RCD: normalizeCprText(readCprValue(row, "UNIT_SYSTEM_RCD", ds, index)),
        PGM_ID: normalizeCprText(readCprValue(row, "PGM_ID", ds, index)),
        UPGM_ID: normalizeCprText(readCprValue(row, "UPGM_ID", ds, index)),
        MENU_KEY: normalizeCprText(readCprValue(row, "MENU_KEY", ds, index)),
        WRK_ARA_RCD: normalizeCprText(readCprValue(row, "WRK_ARA_RCD", ds, index)),
        MENU_PATH: normalizeCprText(readCprValue(row, "MENU_PATH", ds, index))
      });
    }
    return rows;
  };

  const lookupCprControl = (app, id) => {
    try {
      if (app && typeof app.lookup === "function") return app.lookup(id);
    } catch {}
    return null;
  };

  const findCprMainApp = () => {
    const platform = window.cpr?.core?.Platform?.INSTANCE || null;
    try {
      const running = typeof platform?.getAllRunningAppInstances === "function"
        ? platform.getAllRunningAppInstances()
        : [];
      const matched = running.find((app) =>
        app &&
        typeof app.lookup === "function" &&
        (
          app.id === "app/com/inc/main" ||
          String(app.id || "").startsWith("app/com/inc/main$") ||
          app.app?.id === "app/com/inc/main"
        )
      );
      if (matched) return matched;
    } catch {}

    if (typeof platform?.lookup === "function") {
      for (const id of ["app/com/inc/main$1", "app/com/inc/main", "com/inc/main"]) {
        try {
          const app = platform.lookup(id);
          if (app && typeof app.lookup === "function") return app;
        } catch {}
      }
    }
    return null;
  };

  const readCprObjectAttr = (obj, names) => {
    if (!obj) return null;
    for (const name of names) {
      for (const method of ["getUserAttribute", "getUserAttr", "userAttr", "getAttr", "attr"]) {
        try {
          if (typeof obj[method] === "function") {
            const value = obj[method](name);
            if (value != null && normalizeCprText(value)) return value;
          }
        } catch {}
      }
      try {
        if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
      } catch {}
      try {
        if (obj.userAttrs && Object.prototype.hasOwnProperty.call(obj.userAttrs, name)) return obj.userAttrs[name];
      } catch {}
    }
    return null;
  };

  const collectCprSelectedHints = (mainApp) => {
    const hints = [];
    const addHint = (value) => {
      const text = normalizeCprText(value);
      if (text && !hints.includes(text)) hints.push(text);
    };
    try {
      const running = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
      const businessApps = running
        .map((app) => app?.app?.id || app?.id || null)
        .map((id) => normalizeCprText(String(id || "").replace(/\$\d+$/, "")))
        .filter((id) =>
          id.startsWith("app/") &&
          !id.startsWith("app/com/") &&
          !id.startsWith("app/cmn/") &&
          !id.startsWith("udc/")
        );
      for (const id of businessApps.slice().reverse()) {
        addHint(id);
        addHint(id.replace(/\.clx$/i, ""));
      }
    } catch {}
    const mdi = lookupCprControl(mainApp, "mdiCn");
    const selectedCandidates = [];
    for (const method of ["getSelectedTabItem", "getSelectedItem", "getSelectedTab", "getSelection", "getSelectedAppInstance"]) {
      try {
        if (typeof mdi?.[method] === "function") {
          const value = mdi[method]();
          if (Array.isArray(value)) selectedCandidates.push(...value);
          else if (value) selectedCandidates.push(value);
        }
      } catch {}
    }
    for (const selected of selectedCandidates) {
      addHint(readCprObjectAttr(selected, [
        "MENU_ID", "menu_id", "menuId", "PGM_ID", "pgm_id", "program_id",
        "appId", "APP_ID", "id", "value", "text", "label"
      ]));
      addHint(selected?.text || selected?.label || selected?.value || selected?.id);
      addHint(readCprObjectAttr(selected?.content, [
        "MENU_ID", "menu_id", "menuId", "PGM_ID", "pgm_id", "program_id",
        "appId", "APP_ID", "id"
      ]));
      addHint(selected?.content?.app?.id || selected?.content?.id);
    }
    for (const selector of [
      "[aria-selected='true']",
      ".cl-selected",
      ".cl-selected-item",
      ".cl-focus",
      ".selected",
      ".active"
    ]) {
      try {
        for (const el of document.querySelectorAll(selector)) {
          addHint(el.getAttribute("data-menu-id"));
          addHint(el.getAttribute("data-pgm-id"));
          addHint(el.getAttribute("data-app-id"));
          addHint(el.id);
          addHint(el.textContent);
        }
      } catch {}
    }
    return hints.slice(0, 30);
  };

  const compactCprKey = (value) =>
    normalizeCprText(value).toLowerCase().replace(/[^a-z0-9가-힣]/g, "");

  const cprApiHints = (apiUrl) => {
    const hints = [];
    const addHint = (value) => {
      const text = normalizeCprText(value).replace(/\.do$/i, "");
      if (!text) return;
      if (/^(sys|cmn|apc|ccr|csr|cgd|org|tdr|itest|collector|onLoad|list|listDtl|save|delete|insert|update|get|find)$/i.test(text)) return;
      if (text.length < 5) return;
      hints.push(text);
      const programMatch = text.match(/^((?:Ext|Std)[A-Z][A-Za-z0-9]{2})([A-Z].+)$/);
      if (programMatch?.[1] && programMatch?.[2]) {
        hints.push(`${programMatch[1]}C${programMatch[2]}`);
        hints.push(`${programMatch[1]}S${programMatch[2]}`);
      }
    };
    try {
      const path = new URL(String(apiUrl || ""), location.href).pathname || "";
      const parts = path.split("/").map((part) => normalizeCprText(part)).filter(Boolean);
      for (const part of parts) {
        addHint(part);
      }
      const programMatch = path.match(/\/([A-Za-z][A-Za-z0-9]+)\/(?:onLoad|list|listDtl|save|delete|insert|update|get|find)[A-Za-z0-9]*\.do$/i);
      if (programMatch?.[1]) {
        const before = hints.length;
        addHint(programMatch[1]);
        if (hints.length > before) {
          const added = hints.splice(before);
          hints.unshift(...added);
        }
      }
    } catch {}
    return hints.filter(Boolean);
  };

  const findCprMenuRow = (rows, hints, pathHint = []) => {
    const compactHints = hints.map(compactCprKey).filter(Boolean);
    const wantedPath = splitCprPath(pathHint).map(compactCprKey);
    const valuesOf = (row) => [
      row.MENU_ID,
      row.PGM_ID,
      row.MENU_KEY,
      row.CALL_PAGE,
      row.MENU_NM
    ].map(compactCprKey).filter(Boolean);
    const suffixScore = (row) => {
      const actual = splitCprPath(row.MENU_PATH).map(compactCprKey);
      let score = 0;
      for (
        let actualIndex = actual.length - 1, wantedIndex = wantedPath.length - 1;
        actualIndex >= 0 && wantedIndex >= 0 && actual[actualIndex] === wantedPath[wantedIndex];
        actualIndex -= 1, wantedIndex -= 1
      ) {
        score += 1;
      }
      return score;
    };

    for (const hint of compactHints) {
      const exact = rows.filter((row) => valuesOf(row).some((value) => value === hint));
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) {
        const ranked = exact
          .map((row) => ({ row, score: suffixScore(row) }))
          .sort((a, b) => b.score - a.score);
        return ranked[0].score > (ranked[1]?.score ?? -1) ? ranked[0].row : null;
      }
    }
    for (const hint of compactHints) {
      const fuzzy = rows.filter((row) => valuesOf(row)
        .some((value) => value.includes(hint) || hint.includes(value)));
      if (fuzzy.length === 1) return fuzzy[0];
    }
    return null;
  };

  const collectCprMenuContext = (detail = {}) => {
    const mainApp = findCprMainApp();
    if (!mainApp) return null;
    const dsAllMenu = lookupCprControl(mainApp, "dsAllMenu");
    if (!dsAllMenu) return null;
    const rows = cprDatasetRows(dsAllMenu);
    if (!rows.length) return null;

    const explicitHints = [
      detail.menu_id,
      detail.menuId,
      detail.program_id,
      detail.programId,
      detail.pgm_id,
      detail.PGM_ID,
      detail.clicked_label,
      detail.selected_label,
      ...splitCprPath(detail.clicked_path).slice(-1),
      ...cprApiHints(detail.api_url)
    ].filter(Boolean);
    const selectedHints = collectCprSelectedHints(mainApp);
    const menuRow = explicitHints.length > 0
      ? findCprMenuRow(rows, explicitHints, detail.clicked_path || detail.selected_path || [])
      : findCprMenuRow(rows, selectedHints);
    if (!menuRow) {
      return {
        source: "cpr_runtime",
        parser: "cpr_dsAllMenu_mdi",
        capture_status: "unresolved",
        confidence: 0.35,
        warnings: ["cpr_menu_row_unresolved"],
        selected_hints: selectedHints.slice(0, 8)
      };
    }

    const miniRows = cprDatasetRows(lookupCprControl(mainApp, "dsMiniMenu"), 100);
    const topMenu = miniRows.find((row) => row.MENU_ID && row.MENU_ID === menuRow.TOP_MENU_ID) || null;
    const path = splitCprPath(menuRow.MENU_PATH);
    if (topMenu?.MENU_NM && path[0] !== topMenu.MENU_NM) path.unshift(topMenu.MENU_NM);
    if (!path.length && menuRow.MENU_NM) path.push(menuRow.MENU_NM);

    return {
      source: "cpr_runtime",
      parser: "cpr_dsAllMenu_mdi",
      path,
      path_text: path.join(" > "),
      selected_path: path,
      selected_path_text: path.join(" > "),
      selected_label: menuRow.MENU_NM || path[path.length - 1] || null,
      menu_id: menuRow.MENU_ID || null,
      program_id: menuRow.PGM_ID || null,
      call_page: menuRow.CALL_PAGE || null,
      top_menu_id: menuRow.TOP_MENU_ID || null,
      unit_system_rcd: menuRow.UNIT_SYSTEM_RCD || null,
      wrk_ara_rcd: menuRow.WRK_ARA_RCD || null,
      menu_key: menuRow.MENU_KEY || null,
      depth: path.length || null,
      confidence: path.length >= 2 ? 0.98 : 0.8,
      capture_status: path.length >= 2 ? "complete" : "partial",
      warnings: path.length >= 2 ? [] : ["cpr_menu_path_shallow"]
    };
  };

  const cprPrimitive = (value) => {
    if (value == null) return null;
    if (["string", "number", "boolean"].includes(typeof value)) return value;
    if (value instanceof Date) return value.toISOString();
    return normalizeCprText(value);
  };

  const cprDataRowMap = (ds, rowIndex, maxColumns = 30) => {
    if (!ds || !Number.isInteger(rowIndex) || rowIndex < 0) return null;
    let columns = [];
    try {
      columns = ds.getColumnNames?.() || [];
    } catch {}
    const row = {};
    for (const column of columns.slice(0, maxColumns)) {
      try {
        row[column] = cprPrimitive(ds.getValue?.(rowIndex, column));
      } catch {}
    }
    return Object.keys(row).length > 0 ? row : null;
  };

  const collectCprGridContextNow = (detail = {}) => {
    const point = detail.point && Number.isFinite(Number(detail.point.x)) && Number.isFinite(Number(detail.point.y))
      ? { x: Number(detail.point.x), y: Number(detail.point.y) }
      : null;
    const targetHint = detail.targetHint && typeof detail.targetHint === "object" ? detail.targetHint : {};
    const hintedText = `${targetHint.id || ""} ${targetHint.selector || ""}`;
    const hintedUuid = hintedText.match(/(?:^|#)uuid-([A-Za-z0-9_-]+)/)?.[1] || null;
    const pointElement = point ? document.elementFromPoint(point.x, point.y) : null;
    const candidates = [];

    for (const app of window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || []) {
      let controls = [];
      try {
        const container = app.getContainer?.();
        controls = container?.getAllRecursiveChildren?.() || container?.getChildren?.() || [];
      } catch {}
      for (const grid of controls) {
        if (String(grid?.type || "").toLowerCase() !== "grid") continue;
        const uuid = normalizeCprText(grid.uuid || grid.getUUID?.());
        const root = uuid ? document.getElementById(`uuid-${uuid}`) : null;
        const rect = root?.getBoundingClientRect?.() || null;
        if (!root || !rect || rect.width <= 0 || rect.height <= 0) continue;
        let score = 0;
        if (hintedUuid && hintedUuid === uuid) score += 100;
        if (point && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) score += 60;
        if (pointElement && root.contains(pointElement)) score += 80;
        if (targetHint.id && root.id === targetHint.id) score += 100;
        if (score <= 0) continue;
        candidates.push({ app, grid, root, rect, uuid, score });
      }
    }

      const selected = candidates.sort((a, b) => b.score - a.score)[0] || null;
      if (!selected) return null;
      const { app, grid, root, uuid } = selected;
      const ds = grid.dataSet || grid.getDataSet?.() || null;
      const gridCellSelector = "[role='gridcell'],[role='cell']";
      const pointCell = point
        ? (document.elementsFromPoint?.(point.x, point.y) || [])
            .map((element) => element?.closest?.(gridCellSelector) || null)
            .find((candidate) => candidate && root.contains(candidate)) || null
        : null;
      const boundsCell = point
        ? [...root.querySelectorAll(gridCellSelector)].find((candidate) => {
            const bounds = candidate.getBoundingClientRect?.();
            return bounds && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
          }) || null
        : null;
      const cell = pointCell || boundsCell || pointElement?.closest?.(gridCellSelector) || null;
      const domRow = cell?.closest?.("[role='row']") || null;
    const dataRows = [...root.querySelectorAll("[role='row']")]
      .filter((row) => row.querySelector("[role='gridcell'],[role='cell']"));
    const rowCells = domRow ? [...domRow.querySelectorAll("[role='gridcell'],[role='cell']")] : [];

    let rowIndex = null;
    try {
      const value = Number(grid.getSelectedRowIndex?.());
      if (Number.isInteger(value) && value >= 0) rowIndex = value;
    } catch {}
    if (rowIndex == null && domRow) {
      const ariaRow = Number(domRow.getAttribute("aria-rowindex"));
      rowIndex = Number.isInteger(ariaRow) && ariaRow > 0 ? ariaRow - 1 : dataRows.indexOf(domRow);
    }

      let colIndex = cell ? rowCells.indexOf(cell) : -1;
      const ariaCol = Number(cell?.getAttribute?.("aria-colindex"));
      if (Number.isInteger(ariaCol) && ariaCol > 0) colIndex = ariaCol - 1;
      if (colIndex < 0) colIndex = null;

      const rawModelColIndex = Number(cell?.getAttribute?.("data-cellindex"));
      const modelColIndex = Number.isInteger(rawModelColIndex) && rawModelColIndex >= 0
        ? rawModelColIndex
        : colIndex;

      let cellInfo = null;
      try {
        if (modelColIndex != null) cellInfo = grid.getCellInfo?.(modelColIndex) || null;
      } catch {}
    const headers = [...root.querySelectorAll("[role='columnheader']")]
      .slice(0, 30)
      .map((header) => normalizeCprText(header.innerText || header.textContent))
      .filter(Boolean);
    const columnId = normalizeCprText(cellInfo?.columnName || "") || null;
    const columnLabel = colIndex != null ? headers[colIndex] || columnId : columnId;
    const rowData = cprDataRowMap(ds, rowIndex, 30) || {};
    if (columnId && !Object.prototype.hasOwnProperty.call(rowData, columnId)) {
      try {
        rowData[columnId] = cprPrimitive(ds?.getValue?.(rowIndex, columnId));
      } catch {}
    }
      let cellValue = columnId ? rowData[columnId] : null;
      if (cellValue == null && rowIndex != null && modelColIndex != null) {
        try {
          cellValue = cprPrimitive(grid.getCellValue?.(rowIndex, modelColIndex));
        } catch {}
      }
    if (cellValue == null && cell) cellValue = normalizeCprText(cell.innerText || cell.textContent) || null;

    return {
      gridId: grid.id || root.id || null,
      datasetId: ds?.id || null,
      componentId: uuid ? `uuid-${uuid}` : root.id || null,
        appId: app?.app?.id || app?.id || null,
        rowIndex,
        colIndex,
        modelColIndex,
        columnId,
      columnLabel,
      cellValue,
      rawValue: cellValue,
      headers,
      rowContext: {
        row_path: [],
        row_label: null,
        values: rowData,
        map: rowData,
        confidence: rowIndex != null && Object.keys(rowData).length > 0 ? 0.99 : 0.55,
        capture_status: rowIndex != null && Object.keys(rowData).length > 0 ? "complete" : "partial",
        warnings: rowIndex == null ? ["cpr_selected_row_unresolved"] : []
      }
    };
  };

  const collectCprGridContext = (detail = {}) => new Promise((resolve) => {
    setTimeout(() => resolve(collectCprGridContextNow(detail)), 0);
  });

  const postStateSnapshotFromCollector = (kind, requestId, collectorFn, detail) => {
    let raw = null;
    try {
      raw = typeof collectorFn === "function" ? collectorFn(detail || {}) : null;
    } catch (error) {
      const receivedAtMs = Date.now();
      post("STATE_SNAPSHOT", {
        kind,
        requestId,
        value: null,
        receivedAt: new Date(receivedAtMs).toISOString(),
        receivedAtMs,
        error: {
          message: error?.message || String(error),
          type: error?.name || "adapter_error"
        }
      });
      return;
    }

    Promise.resolve(raw)
      .then((value) => {
        const receivedAtMs = Date.now();
        post("STATE_SNAPSHOT", {
          kind,
          requestId,
          value,
          receivedAt: new Date(receivedAtMs).toISOString(),
          receivedAtMs
        });
      })
      .catch((error) => {
        const receivedAtMs = Date.now();
        post("STATE_SNAPSHOT", {
          kind,
          requestId,
          value: null,
          receivedAt: new Date(receivedAtMs).toISOString(),
          receivedAtMs,
          error: {
            message: error?.message || String(error),
            type: error?.name || "adapter_error"
          }
        });
      });
  };

  let __azRouteUrl = location.href;
  const emitRouteChange = (trigger) => {
    const fromUrl = __azRouteUrl;
    const toUrl = location.href;
    if (fromUrl === toUrl) return;
    __azRouteUrl = toUrl;
    post("ROUTE_CHANGE", {
      trigger,
      fromUrl,
      toUrl,
      changedAt: Date.now()
    });
  };

  try {
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args);
      queueMicrotask(() => emitRouteChange("pushState"));
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      queueMicrotask(() => emitRouteChange("replaceState"));
      return result;
    };

    window.addEventListener("popstate", () => queueMicrotask(() => emitRouteChange("popstate")), true);
    window.addEventListener("hashchange", () => queueMicrotask(() => emitRouteChange("hashchange")), true);
  } catch (error) {
    console.warn("[Rainbow Collector] route_change 훅 설치 실패", {
      "실패 이유": error?.message || String(error),
      "영향": "pushState/replaceState 기반 화면 이동 일부가 수집되지 않을 수 있음"
    });
  }

  let nativeDialogSequence = 0;
  for (const dialogType of ["alert", "confirm", "prompt"]) {
    const originalDialog = window[dialogType];
    if (typeof originalDialog !== "function") continue;
    window[dialogType] = function(message, ...args) {
      nativeDialogSequence += 1;
      const dialogId = `native-dialog:${Date.now()}:${nativeDialogSequence}`;
      const openedAtMs = Date.now();
      post("NATIVE_DIALOG_OPEN", {
        dialogId,
        dialogType,
        message: normalizeCprText(message).slice(0, 1000),
        observedAt: new Date(openedAtMs).toISOString(),
        observedAtMs: openedAtMs
      });
      let result;
      try {
        result = originalDialog.call(window, message, ...args);
        return result;
      } finally {
        const closedAtMs = Date.now();
        post("NATIVE_DIALOG_CLOSE", {
          dialogId,
          dialogType,
          message: normalizeCprText(message).slice(0, 1000),
          accepted: dialogType === "confirm" ? result === true : null,
          resultProvided: dialogType === "prompt" ? result != null : false,
          observedAt: new Date(closedAtMs).toISOString(),
          observedAtMs: closedAtMs
        });
      }
    };
  }

  if (window.fetch) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const request = args[0];
      const init = args[1] || {};
      const method = (init.method || request?.method || "GET").toUpperCase();
      const requestBody = init.body ?? request?.body ?? null;
      const requestId = crypto.randomUUID ? crypto.randomUUID() : `fetch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const startedAtMs = Date.now();
      post("FETCH_START", {
        requestId,
        url: String(request?.url || request || ""),
        method,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
        cprMenuContext: collectCprMenuContext({
          reason: "fetch_start",
          api_url: String(request?.url || request || ""),
          method
        })
      });
      let response;
      try {
        response = await originalFetch(...args);
      } catch (error) {
        const endedAtMs = Date.now();
        post("FETCH_ERROR", markInternalCollectorPayload({
          requestId,
          url: String(request?.url || request || ""),
          method,
          status: null,
          startedAt: new Date(startedAtMs).toISOString(),
          startedAtMs,
          endedAt: new Date(endedAtMs).toISOString(),
          endedAtMs,
          durationMs: endedAtMs - startedAtMs,
          requestBody,
          responseBody: null,
          errorType: error?.name || "fetch_error",
          errorMessage: error?.message || String(error || "fetch_error"),
          failureStage: "request_failed",
          correlationId:
            init.headers?.["X-AZ-Correlation-Id"] ||
            init.headers?.["x-az-correlation-id"] ||
            null
        }));
        throw error;
      }

      const endedAtMs = Date.now();

      try {
        const clone = response.clone();
        const contentType = (clone.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("json") || contentType.startsWith("text/")) {
          const responseBody = await clone.text();
          post("FETCH_HOOK", markInternalCollectorPayload({
            requestId,
            url: response.url || String(request?.url || request || ""),
            method,
            status: response.status,
            startedAt: new Date(startedAtMs).toISOString(),
            startedAtMs,
            endedAt: new Date(endedAtMs).toISOString(),
            endedAtMs,
            durationMs: endedAtMs - startedAtMs,
            requestBody,
            responseBody,
            correlationId:
              init.headers?.["X-AZ-Correlation-Id"] ||
              init.headers?.["x-az-correlation-id"] ||
              null
          }));
        }
      } catch (error) {
        console.warn("[Rainbow Collector] fetch response 훅 처리 실패", {
          "실패 이유": error?.message || String(error),
          "영향": "해당 fetch의 response 본문/상태 일부가 transaction에 반영되지 않을 수 있음"
        });
      }

      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__az_test_method = method;
    this.__az_test_url = url;
    this.__az_test_headers = {};
    this.__az_test_request_id = crypto.randomUUID ? crypto.randomUUID() : `xhr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    this.__az_test_headers[name] = value;
    return originalSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function(body) {
    this.__az_test_body = body;
    this.__az_test_started_at_ms = Date.now();
    post("XHR_START", {
      requestId: this.__az_test_request_id,
      url: this.__az_test_url || "",
      method: this.__az_test_method || "GET",
      startedAt: new Date(this.__az_test_started_at_ms).toISOString(),
      startedAtMs: this.__az_test_started_at_ms,
      cprMenuContext: collectCprMenuContext({
        reason: "xhr_start",
        api_url: this.__az_test_url || "",
        method: this.__az_test_method || "GET"
      })
    });
    const postXhrFailure = (eventType) => {
      try {
        const endedAtMs = Date.now();
        this.__az_test_failed = true;
        post("XHR_ERROR", markInternalCollectorPayload({
          requestId: this.__az_test_request_id,
          url: this.responseURL || this.__az_test_url || "",
          method: this.__az_test_method || "GET",
          status: null,
          startedAt: new Date(this.__az_test_started_at_ms || endedAtMs).toISOString(),
          startedAtMs: this.__az_test_started_at_ms || endedAtMs,
          endedAt: new Date(endedAtMs).toISOString(),
          endedAtMs,
          durationMs: endedAtMs - (this.__az_test_started_at_ms || endedAtMs),
          requestBody: this.__az_test_body ?? null,
          responseBody: null,
          errorType: eventType,
          errorMessage: eventType,
          failureStage: "request_failed",
          correlationId:
            this.__az_test_headers["X-AZ-Correlation-Id"] ||
            this.__az_test_headers["x-az-correlation-id"] ||
            null
        }));
      } catch (error) {
        console.warn("[Rainbow Collector] XHR 실패 이벤트 훅 처리 실패", {
          "실패 이유": error?.message || String(error),
          "영향": "해당 XHR 실패 row가 누락될 수 있음"
        });
      }
    };

    this.addEventListener("error", function() {
      postXhrFailure("xhr_error");
    }, { once: true });

    this.addEventListener("timeout", function() {
      postXhrFailure("xhr_timeout");
    }, { once: true });

    this.addEventListener("abort", function() {
      postXhrFailure("xhr_abort");
    }, { once: true });

    this.addEventListener("loadend", function() {
      try {
        if (this.__az_test_failed) return;
        const endedAtMs = Date.now();
        post("XHR_HOOK", markInternalCollectorPayload({
          requestId: this.__az_test_request_id,
          url: this.responseURL || this.__az_test_url || "",
          method: this.__az_test_method || "GET",
          status: this.status,
          startedAt: new Date(this.__az_test_started_at_ms || endedAtMs).toISOString(),
          startedAtMs: this.__az_test_started_at_ms || endedAtMs,
          endedAt: new Date(endedAtMs).toISOString(),
          endedAtMs,
          durationMs: endedAtMs - (this.__az_test_started_at_ms || endedAtMs),
          requestBody: this.__az_test_body ?? null,
          responseBody: typeof this.responseText === "string" ? this.responseText : null,
          correlationId:
            this.__az_test_headers["X-AZ-Correlation-Id"] ||
            this.__az_test_headers["x-az-correlation-id"] ||
            null
        }));
      } catch (error) {
        console.warn("[Rainbow Collector] XHR response 훅 처리 실패", {
          "실패 이유": error?.message || String(error),
          "영향": "해당 XHR response row가 누락되거나 불완전할 수 있음"
        });
      }
    }, { once: true });

    return originalSend.call(this, body);
  };

  window.addEventListener("AZ_TEST_REQUEST_STATE", (event) => {
    const kind = event.detail?.kind || null;
    const requestId = event.detail?.requestId || null;

    if (kind === "canvas") {
      const receivedAtMs = Date.now();
      post("STATE_SNAPSHOT", {
        kind,
        requestId,
        value: window.__AZ_CANVAS_MODEL__ ?? null,
        receivedAt: new Date(receivedAtMs).toISOString(),
        receivedAtMs
      });
      return;
    }

    if (kind === "grid_models") {
      postStateSnapshotFromCollector(kind, requestId, window.__AZ_TEST_COLLECT_GRID_MODELS__, event.detail || {});
      return;
    }

    if (kind === "nexacro") {
      postStateSnapshotFromCollector(kind, requestId, window.__AZ_TEST_COLLECT_NEXACRO__, event.detail || {});
      return;
    }

    if (kind === "websquare") {
      postStateSnapshotFromCollector(kind, requestId, window.__AZ_TEST_COLLECT_WEBSQUARE__, event.detail || {});
      return;
    }

    if (kind === "cpr_context") {
      postStateSnapshotFromCollector(kind, requestId, collectCprMenuContext, event.detail || {});
      return;
    }

    if (kind === "exbuilder6") {
      const collector = typeof window.__AZ_TEST_COLLECT_EXBUILDER6__ === "function"
        ? window.__AZ_TEST_COLLECT_EXBUILDER6__
        : collectCprGridContext;
      postStateSnapshotFromCollector(kind, requestId, collector, event.detail || {});
    }
  });
}

async function setIdentityBadge(tabId, visible) {
  if (!chrome.action || !Number.isInteger(tabId)) return;
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#1769aa" });
    await chrome.action.setBadgeText({ tabId, text: visible ? "ID" : "" });
  } catch {}
}

async function applyIdentityToQueuedRows(tabId, identity = null, releaseHeld = true) {
  if (!Number.isInteger(tabId)) return 0;
  await hydrateQueue();
  let changed = 0;
  for (const row of pendingRows) {
    if (rowTabId(row) !== tabId) continue;
    if (identity) row.__rainbow_identity = identity;
    if (releaseHeld) {
      delete row.__rainbow_identity_hold;
      delete row.__rainbow_identity_hold_until;
    }
    changed += 1;
  }
  if (changed > 0) {
    await persistQueue();
    if (releaseHeld) scheduleUpload(0, "사용자 ID가 확인되어 대기 중인 데이터를 전송");
  }
  return changed;
}

async function recordSiteIdentityCandidate(message, sender) {
  const tabId = sender?.tab?.id;
  const subject = normalizeSiteIdentitySubject(message?.subject);
  if (!Number.isInteger(tabId) || !subject) return { ok: false, error: "invalid_identity_candidate" };

  let shouldOpenPoc = false;
  await mutateIdentityState(() => {
    const state = identityStateByTab.get(tabId) || {};
    state.candidate = {
      subject,
      source: "login_form_candidate",
      confidence: "candidate",
      observed_at: new Date().toISOString(),
      page_session_id: message?.pageSessionId || null
    };
    const pocEnabled = pocManualIdentityEnabledForUrl(sender?.tab?.url || message?.pageUrl || "");
    shouldOpenPoc = pocEnabled && !state.manual && !state.poc_prompted;
    if (shouldOpenPoc) state.poc_prompted = true;
    identityStateByTab.set(tabId, state);
  });

  if (shouldOpenPoc) {
    await setIdentityBadge(tabId, true);
    try {
      await chrome.tabs.sendMessage(tabId, { type: "POC_MANUAL_ID_PROMPT" }, { frameId: 0 });
    } catch {}
  }
  return { ok: true, poc_prompted: shouldOpenPoc };
}

async function recordSiteIdentitySubmitted(message, sender) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) return { ok: false };
  await mutateIdentityState(() => {
    const state = identityStateByTab.get(tabId) || {};
    state.submitted_at = new Date().toISOString();
    state.submitted_page_session_id = message?.pageSessionId || null;
    identityStateByTab.set(tabId, state);
  });
  return { ok: true };
}

async function recordSiteIdentityLoginResponse(message, sender) {
  const tabId = sender?.tab?.id;
  const status = Number(message?.status);
  if (!Number.isInteger(tabId) || !Number.isFinite(status) || status < 200 || status >= 400) {
    return { ok: false };
  }
  await mutateIdentityState(() => {
    const state = identityStateByTab.get(tabId) || {};
    state.login_response_at = new Date().toISOString();
    state.login_response_url = typeof message?.url === "string" ? message.url.slice(0, 2048) : null;
    state.login_response_status = status;
    identityStateByTab.set(tabId, state);
  });
  return { ok: true };
}

async function confirmSiteIdentity(message, sender) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) return { ok: false, error: "invalid_tab" };
  let confirmedIdentity = null;
  await mutateIdentityState(() => {
    const state = identityStateByTab.get(tabId) || {};
    const subject = normalizeSiteIdentitySubject(message?.subject || state?.candidate?.subject);
    if (!subject) return;
    confirmedIdentity = normalizeIdentityContext({
      subject,
      source: "site_authenticated_user",
      confidence: message?.confidence || "verified",
      resolved_at: new Date().toISOString()
    });
    state.confirmed = confirmedIdentity;
    identityStateByTab.set(tabId, state);
  });
  if (!confirmedIdentity) return { ok: false, error: "identity_candidate_missing" };

  const pocEnabled = pocManualIdentityEnabledForUrl(sender?.tab?.url || message?.pageUrl || "");
  const state = identityStateByTab.get(tabId) || {};
  await applyIdentityToQueuedRows(
    tabId,
    effectiveIdentityForTab(tabId),
    !pocEnabled || Boolean(state.manual)
  );
  return { ok: true };
}

async function getSiteIdentityStatus(sender) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) return { ok: false };
  await hydrateIdentityState();
  const state = identityStateByTab.get(tabId) || {};
  return {
    ok: true,
    candidate: state.candidate || null,
    identity: effectiveIdentityForTab(tabId),
    submitted_at: state.submitted_at || null,
    login_response_at: state.login_response_at || null
  };
}

async function getPocManualIdentity(message, sender = {}) {
  const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : Number(message?.tabId);
  if (!Number.isInteger(tabId)) return { ok: false };
  await hydrateIdentityState();
  const state = identityStateByTab.get(tabId) || {};
  return {
    ok: true,
    identity: normalizeIdentityContext(state.manual, "manual_poc_override")
  };
}

async function setPocManualIdentity(message, sender = {}) {
  const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : Number(message?.tabId);
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab || !pocManualIdentityEnabledForUrl(tab.url || "")) {
    return { ok: false, error: "poc_not_enabled_for_tab" };
  }
  const identity = createPocManualIdentity(message?.subject);
  if (!identity) return { ok: false, error: "invalid_manual_id" };

  await mutateIdentityState(() => {
    const state = identityStateByTab.get(tabId) || {};
    state.manual = identity;
    identityStateByTab.set(tabId, state);
  });
  await applyIdentityToQueuedRows(tabId, identity);
  await setIdentityBadge(tabId, false);
  return { ok: true, identity };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_RUNTIME_CONFIG") {
    void readRuntimeConfigForPage(message.pageUrl || sender?.tab?.url || null)
      .then((config) => {
        sendResponse?.({ ok: true, config });
      })
      .catch((error) => {
        sendResponse?.({
          ok: false,
          config: DEFAULT_RUNTIME_CONFIG,
          error: String(error?.message || error)
        });
      });
    return true;
  }

  if (message?.type === "BATCH_ROWS") {
    void enqueueRows(message.rows || [], sender).then(() => {
      sendResponse?.({ ok: true, count: message.rows?.length || 0 });
    });
    return true;
  }

  if (message?.type === "SITE_IDENTITY_CANDIDATE") {
    void recordSiteIdentityCandidate(message, sender).then(sendResponse);
    return true;
  }

  if (message?.type === "SITE_IDENTITY_SUBMITTED") {
    void recordSiteIdentitySubmitted(message, sender).then(sendResponse);
    return true;
  }


  if (message?.type === "SITE_IDENTITY_LOGIN_RESPONSE") {
    void recordSiteIdentityLoginResponse(message, sender).then(sendResponse);
    return true;
  }

  if (message?.type === "SITE_IDENTITY_CONFIRMED") {
    void confirmSiteIdentity(message, sender).then(sendResponse);
    return true;
  }

  if (message?.type === "SITE_IDENTITY_STATUS_GET") {
    void getSiteIdentityStatus(sender).then(sendResponse);
    return true;
  }

  if (message?.type === "POC_MANUAL_ID_GET") {
    void getPocManualIdentity(message, sender).then(sendResponse);
    return true;
  }

  if (message?.type === "POC_MANUAL_ID_SET") {
    void setPocManualIdentity(message, sender).then(sendResponse);
    return true;
  }

  if (message?.type === "INJECT_MAIN_WORLD") {
    const tabId = sender?.tab?.id;
    const frameId = sender?.frameId;
    if (typeof tabId !== "number") {
      sendResponse?.({ ok: false });
      return;
    }

    void chrome.scripting.executeScript({
      target: typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId },
      world: "MAIN",
      func: installMainWorldBridge,
      args: [message.nonce || null]
    }).then(() => {
      sendResponse?.({ ok: true });
    }).catch((error) => {
      console.warn("[Rainbow Collector] main world 브리지 주입 실패", {
        "실패 이유": error?.message || String(error),
        "영향": "fetch/XHR/history 훅 또는 프레임 내부 수집 일부가 제한될 수 있음"
      });
      sendResponse?.({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!matchesCollectorTarget(tab.url)) return;
  void injectCollectorScript(tabId);
});

chrome.action.onClicked.addListener((tab) => {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId) || !pocManualIdentityEnabledForUrl(tab?.url || "")) return;
  void (async () => {
    await hydrateIdentityState();
    const state = identityStateByTab.get(tabId) || {};
    if (state.manual) {
      await setIdentityBadge(tabId, false);
      return;
    }
    await setIdentityBadge(tabId, true);
    try {
      await chrome.tabs.sendMessage(tabId, { type: "POC_MANUAL_ID_PROMPT" }, { frameId: 0 });
    } catch {}
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await hydrateIdentityState();
    const fallbackIdentity = effectiveIdentityForTab(tabId);
    await applyIdentityToQueuedRows(tabId, fallbackIdentity);
    await mutateIdentityState(() => {
      identityStateByTab.delete(tabId);
    });
  })();
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureQueueFlushAlarm();
  void injectCollectorIntoMatchingTabs();
  void wakeQueueFlush("runtime_installed");
});

chrome.runtime.onStartup.addListener(() => {
  void ensureQueueFlushAlarm();
  void injectCollectorIntoMatchingTabs();
  void wakeQueueFlush("runtime_startup");
});

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== QUEUE_FLUSH_ALARM_NAME) return;
    void wakeQueueFlush("alarm");
  });
}

void ensureQueueFlushAlarm();

void hydrateQueue().then(() => {
  if (pendingRows.length > 0) {
    scheduleUpload(0, "브라우저 저장소에 남아 있던 데이터를 즉시 서버로 전송");
  }
});
