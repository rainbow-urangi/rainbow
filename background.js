const DEFAULT_INGEST_URL = "http://192.168.131.128:8080/ingest/batch";
const DEFAULT_PROD_COLLECTOR_KEY = "test_key";
const COLLECTOR_VERSION = chrome.runtime?.getManifest?.().version || "0.1.1";
const QUEUE_KEY = "AZ_TEST_PENDING_ROWS";
const COLLECTOR_INGEST_URL_KEY = "collectorIngestUrl";
const TENANT_ID_KEY = "tenantId";
const COLLECTOR_KEY_KEY = "collectorKey";
const RUNTIME_CONFIG_URL_KEY = "collectorRuntimeConfigUrl";
const RUNTIME_CONFIG_CACHE_KEY = "AZ_TEST_RUNTIME_CONFIG_CACHE";
const DEFAULT_RUNTIME_CONFIG_TTL_MS = 5 * 60 * 1000;
const QUEUE_FLUSH_ALARM_NAME = "AZ_TEST_QUEUE_FLUSH_WAKE";
const QUEUE_FLUSH_ALARM_PERIOD_MINUTES = 1;
const DEBUG_LOG_ALL_UPLOAD_PAYLOADS = true;
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
const BASE_UPLOAD_DELAY_MS = 800;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const CONTENT_SCRIPT_MATCHERS = [
  /^http:\/\/localhost:4175\//,
  /^http:\/\/127\.0\.0\.1:4175\//,
  /^http:\/\/localhost:4181\//,
  /^http:\/\/127\.0\.0\.1:4181\//,
  /^http:\/\/localhost:5173\/collector-test(?:[/?#]|$)/,
  /^http:\/\/127\.0\.0\.1:5173\/collector-test(?:[/?#]|$)/,
  /^https:\/\/example\.websquare\.kr\//,
  /^https:\/\/demo\.tobesoft\.com\//,
  /^https:\/\/c4web\.c4mix\.com\//,
  /^https:\/\/rainbowlab\.ai\.kr\/rbem(?:[/?#]|$)/,
  /^https:\/\/rainbowlab\.ai\.kr\/mypage(?:[/?#]|$)/
];
let uploadTimer = null;
let uploadInFlight = false;
let hydrated = false;
let flushRequestedWhileInFlight = false;
let retryAttempt = 0;
const pendingRows = [];

function matchesCollectorTarget(url) {
  return typeof url === "string" && CONTENT_SCRIPT_MATCHERS.some((pattern) => pattern.test(url));
}

function firstSourcePageUrl(rows) {
  return Array.isArray(rows)
    ? rows.find((row) => typeof row?.page_url === "string" && row.page_url.trim())?.page_url || null
    : null;
}

function isProdCollectorUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "rainbowlab.ai.kr" || parsed.hostname === "192.168.131.128";
  } catch {
    return false;
  }
}

function isC4WebPageUrl(url) {
  return typeof url === "string" && /^https:\/\/c4web\.c4mix\.com(?:[/?#]|$)/.test(url);
}

function padDatePart(value, width = 2) {
  return String(value).padStart(width, "0");
}

function toCollectorDateTime(value) {
  const parsed = new Date(value);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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
  try {
    return new URL(value).pathname || "/";
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
  const inputContext =
    payload.input_context && typeof payload.input_context === "object" ? payload.input_context : {};
  const menuContext =
    payload.menu_context && typeof payload.menu_context === "object" ? payload.menu_context : null;
  const uiOutcome =
    payload.ui_outcome && typeof payload.ui_outcome === "object" ? payload.ui_outcome : null;

  const action = typeof row.action === "string" && row.action.trim() ? row.action.trim() : "change";
  const eventTime = toCollectorDateTime(row.event_time);
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
    AZ_event_ts_ms: toEventTimestampMs(eventTime),
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
      relation_context: toJsonSafeObject(relationContext),
      menu_context: toJsonSafeObject(menuContext),
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
        bounds: row.bounds ?? null
      },
      raw_payload: toJsonSafeObject(payload)
    },
    snapshot: row.snapshot ?? null
  };
}

function normalizeRowsForUpload(rows, ingestUrl) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => normalizeRowForCollector(row, ingestUrl));
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
        max_queue_rows: MAX_QUEUE_ROWS,
        reason: "background_queue_overflow"
      },
      legacy: {}
    }
  };
}

function truncateQueueToMax() {
  if (pendingRows.length <= MAX_QUEUE_ROWS) return;
  const overflow = pendingRows.length - MAX_QUEUE_ROWS;
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
        max_queue_rows: MAX_QUEUE_ROWS,
        reason: "background_queue_overflow"
      }
    };
  } else if (droppedRowsCount > 0) {
    pendingRows.push(buildQueueOverflowDiagnosticRow(droppedRowsCount));
  }
  while (pendingRows.length > MAX_QUEUE_ROWS) {
    pendingRows.shift();
  }
  console.warn(`[AZ_TEST] queue truncated by ${droppedRowsCount} rows to respect MAX_QUEUE_ROWS=${MAX_QUEUE_ROWS}`);
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
    if (batch.length >= MAX_BATCH_ROWS) break;
    const nextBatch = batch.concat(row);
    const nextBytes = estimateBatchBytes(nextBatch);
    if (batch.length > 0 && nextBytes > MAX_BATCH_BYTES) break;
    batch.push(row);
    if (nextBytes >= MAX_BATCH_BYTES) break;
  }

  return batch;
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
    collectorIngestUrl:
      typeof stored?.[COLLECTOR_INGEST_URL_KEY] === "string" && stored[COLLECTOR_INGEST_URL_KEY].trim()
        ? stored[COLLECTOR_INGEST_URL_KEY].trim()
        : null,
    tenantId:
      typeof stored?.[TENANT_ID_KEY] === "string" && stored[TENANT_ID_KEY].trim()
        ? stored[TENANT_ID_KEY].trim()
        : "",
    collectorKey:
      typeof stored?.[COLLECTOR_KEY_KEY] === "string" && stored[COLLECTOR_KEY_KEY].trim()
        ? stored[COLLECTOR_KEY_KEY].trim()
        : "",
    collectorRuntimeConfigUrl:
      typeof stored?.[RUNTIME_CONFIG_URL_KEY] === "string" && stored[RUNTIME_CONFIG_URL_KEY].trim()
        ? stored[RUNTIME_CONFIG_URL_KEY].trim()
        : null
  };
}

function isDevelopmentCollectorUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function injectCollectorScript(tabId) {
  if (typeof tabId !== "number") return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  } catch (error) {
    console.warn("[AZ_TEST] content injection failed", error);
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

async function enqueueRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  await hydrateQueue();
  pendingRows.push(...rows);
  truncateQueueToMax();
  await persistQueue();
  scheduleUpload();
}

function scheduleUpload(delayMs = BASE_UPLOAD_DELAY_MS) {
  if (uploadInFlight) {
    flushRequestedWhileInFlight = true;
    return;
  }
  if (uploadTimer) return;
  uploadTimer = setTimeout(() => {
    uploadTimer = null;
    void flushUpload();
  }, Math.max(0, delayMs));
}

async function ensureQueueFlushAlarm() {
  if (!chrome.alarms?.create) return;
  try {
    await chrome.alarms.create(QUEUE_FLUSH_ALARM_NAME, {
      periodInMinutes: QUEUE_FLUSH_ALARM_PERIOD_MINUTES
    });
  } catch (error) {
    console.warn("[AZ_TEST] queue flush alarm setup failed", error);
  }
}

async function wakeQueueFlush(reason = "alarm") {
  await hydrateQueue();
  if (pendingRows.length === 0) return;
  console.info("[AZ_TEST] queue flush wake", { reason, pendingRows: pendingRows.length });
  scheduleUpload(0);
}

function resolveIngestUrl(rows, config) {
  const sourcePageUrl = firstSourcePageUrl(rows);
  if (isC4WebPageUrl(sourcePageUrl)) {
    return DEFAULT_INGEST_URL;
  }

  if (config?.collectorIngestUrl) {
    return config.collectorIngestUrl;
  }

  if (typeof sourcePageUrl === "string" && isDevelopmentCollectorUrl(sourcePageUrl)) {
    try {
      return new URL("/ingest/batch", sourcePageUrl).toString();
    } catch {}
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
    return new URL("/collector/runtime-config", ingestUrl).toString();
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
    const collectorKey = isProdCollectorUrl(runtimeConfigUrl)
      ? DEFAULT_PROD_COLLECTOR_KEY
      : (config.collectorKey || "");
    const response = await fetch(runtimeConfigUrl, {
      method: "GET",
      headers: {
        "X-Collector-Version": COLLECTOR_VERSION,
        ...(config.tenantId ? { "X-Tenant-Id": config.tenantId } : {}),
        ...(collectorKey ? {
          "x-api-key": collectorKey,
          "X-Collector-Key": collectorKey
        } : {})
      }
    });

    if (!response.ok) {
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

function debugLogUploadPayload(ingestUrl, sourceRows, payload) {
  if (!DEBUG_LOG_ALL_UPLOAD_PAYLOADS) return;
  try {
    const rowCount = Array.isArray(payload?.rows) ? payload.rows.length : 0;
    console.groupCollapsed(`[collector-debug] background->ingest rows=${rowCount}`);
    console.log("ingestUrl", ingestUrl);
    console.log("sourceRows", sourceRows);
    console.log("payload", payload);
    console.groupEnd();
  } catch (error) {
    console.log("[collector-debug] upload payload", { ingestUrl, sourceRows, payload });
  }
}

async function flushUpload() {
  await hydrateQueue();
  if (uploadInFlight || pendingRows.length === 0) return;

  uploadInFlight = true;
  flushRequestedWhileInFlight = false;
  const rows = takeUploadBatch();
  const config = await readCollectorConfig();
  const ingestUrl = resolveIngestUrl(rows, config);
  const uploadRows = normalizeRowsForUpload(rows, ingestUrl);
  const sourcePageUrl = firstSourcePageUrl(rows);
  const collectorKey =
    isC4WebPageUrl(sourcePageUrl) || isProdCollectorUrl(ingestUrl)
      ? DEFAULT_PROD_COLLECTOR_KEY
      : (config.collectorKey || "");
  let shouldContinue = false;
  let retryDelay = null;

  try {
    if (uploadRows.length === 0) return;

    const uploadPayload = { rows: uploadRows, ts: Date.now() };
    debugLogUploadPayload(ingestUrl, rows, uploadPayload);

    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Collector-Version": COLLECTOR_VERSION,
        ...(config.tenantId ? { "X-Tenant-Id": config.tenantId } : {}),
        ...(collectorKey ? {
          "x-api-key": collectorKey,
          "X-Collector-Key": collectorKey
        } : {})
      },
      body: JSON.stringify(uploadPayload)
    });

    if (!response.ok) {
      throw new Error(`ingest_failed_${response.status}`);
    }

    pendingRows.splice(0, rows.length);
    await persistQueue();
    retryAttempt = 0;
    shouldContinue = pendingRows.length > 0;
  } catch (error) {
    console.warn("[AZ_TEST] ingest retry scheduled", error);
    retryAttempt += 1;
    retryDelay = computeRetryDelay(retryAttempt);
  } finally {
    uploadInFlight = false;
    if (retryDelay != null) {
      scheduleUpload(retryDelay);
      return;
    }
    if (shouldContinue || flushRequestedWhileInFlight) {
      flushRequestedWhileInFlight = false;
      scheduleUpload(0);
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
    console.warn("[AZ_TEST] route hook failed", error);
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
        startedAtMs
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
        console.warn("[AZ_TEST] fetch hook failed", error);
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
      startedAtMs: this.__az_test_started_at_ms
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
        console.warn("[AZ_TEST] xhr error hook failed", error);
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
        console.warn("[AZ_TEST] xhr hook failed", error);
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

    if (kind === "exbuilder6") {
      postStateSnapshotFromCollector(kind, requestId, window.__AZ_TEST_COLLECT_EXBUILDER6__, event.detail || {});
    }
  });
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
    void enqueueRows(message.rows || []).then(() => {
      sendResponse?.({ ok: true, count: message.rows?.length || 0 });
    });
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
      console.warn("[AZ_TEST] bridge injection failed", error);
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
    scheduleUpload(0);
  }
});
