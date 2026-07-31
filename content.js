(function() {
  const COLLECTOR_BUILD = "2026-07-29-cpr-menu-path-v11";
  const EXTENSION_VERSION = chrome.runtime?.getManifest?.().version || "0.1.2";
  const EXTENSION_BUILD = `shell-${EXTENSION_VERSION}`;
  const REMOTE_SDK_SOURCE = "RAINBOW_COLLECTOR_SDK";
  const REMOTE_SDK_DEFAULT_CHANNEL = "stable";
  const REMOTE_SDK_MAX_PAYLOAD_BYTES = 32 * 1024;
  const REMOTE_SDK_ALLOWED_ORIGINS = new Set([
    "http://211.109.22.33:8791"
  ]);
  const GENERIC_GRID_MIN_CONFIDENCE = 0.72;
  const GENERIC_TREE_MIN_CONFIDENCE = 0.62;
  const standaloneOrigins = new Set([
    "http://211.109.22.33:8791"
  ]);
  const isRainbowlabCollectorPath =
    location.origin === "https://rainbowlab.ai.kr" &&
    (
      location.pathname === "/rbem" ||
      location.pathname.startsWith("/rbem/") ||
      location.pathname === "/mypage" ||
      location.pathname.startsWith("/mypage/")
    );
  const isAllowedTarget =
    standaloneOrigins.has(location.origin) ||
    isRainbowlabCollectorPath;

  if (!isAllowedTarget) return;
  if (document.documentElement?.getAttribute("data-az-collector-test") === "active") return;

  const pageSessionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let eventSequence = 0;
  let activeMenuContext = null;
  let activeCprDomMenuPath = [];
  let activeCprTopMenuPath = [];
  let activeCprMenuContext = null;
  let activeCprMenuContextUpdatedAt = 0;
  let cprMenuContextRefreshTimer = null;
  let lastUserAction = null;
  const recentUserActions = [];
  const apiRequestInteractions = new Map();
  const apiTransactionBuffer = new Map();
  const recentRouteChanges = [];
  let lastApiTransactionLink = null;
  const globalUiOutcomeState = new Map();
  const bridgeNonce = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const remoteSdkToken = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let remoteSdkInjectedKey = null;
  let remoteSdkLastEventVersion = null;
  const INPUT_EVENT_DEBOUNCE_MS = 350;
  const SCREEN_CHANGE_DEBOUNCE_MS = 800;
  const ROUTE_POLL_INTERVAL_MS = 1000;
  const CAUSAL_RELATION_TTL_MS = 5000;
  const STRUCTURE_CACHE_TTL_MS = 5000;
  const MAX_CONTEXT_CANDIDATES = 3;
  const MAX_DEBUG_CANDIDATES = 3;
  const MAX_GRID_ROW_FIELDS = 30;
  const MAX_SEMANTIC_TEXT_CHARS = 200;
  const CONTEXT_SCHEMA_VERSION = 2;
  const TEXT_CONTEXT_VERSION = 2;
  const GRID_ADAPTER_TIMEOUT_MS = 50;
  const INTERNAL_GRID_ADAPTER_TIMEOUT_MS = 150;
  const LATE_GRID_ADAPTER_TIMEOUT_MS = 1500;
  const GRID_ADAPTER_CACHE_TTL_MS = 5000;
  const GRID_ADAPTER_COOLDOWN_MS = 10000;
  const CONTENT_SEND_RETRY_DELAY_MS = 1000;
  const CONTENT_SEND_MAX_RETRIES = 3;
  const CONTENT_SEND_BUFFER_LIMIT = 300;
  const CONTENT_SEND_MAX_BATCH_ROWS = 50;
  const CPR_MENU_CONTEXT_TTL_MS = 15000;
  const CPR_MENU_CONTEXT_REFRESH_DEBOUNCE_MS = 250;
  const CONTENT_SEND_URGENT_RETRY_ROWS = Math.floor(CONTENT_SEND_BUFFER_LIMIT * 0.8);
  const CONTENT_SEND_HARD_BUFFER_LIMIT = CONTENT_SEND_BUFFER_LIMIT + CONTENT_SEND_MAX_BATCH_ROWS;
  const DEBUG_LOG_ALL_COLLECTED_ROWS = true;
  const CAPTURE_FOCUS_ROWS = false;
  const CAPTURE_BLUR_ROWS = false;
  const CAPTURE_INTERMEDIATE_INPUT_ROWS = false;
  const CAPTURE_COMPOSITION_ROWS = false;
  const PAGE_CLOSE_DEDUPE_WINDOW_MS = 1200;
  const RUNTIME_CONFIG_REFRESH_INTERVAL_MS = 60 * 1000;
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
    modules: {},
    event_types: {},
    selector_packs: {},
    workflow_rules: [],
    privacy: {},
    api_capture: DEFAULT_API_CAPTURE_CONFIG
  });
  const SAFE_METADATA_KEYS = new Set([
    "source",
    "parser",
    "kind",
    "type",
    "framework",
    "grid_kind",
    "grid_type",
    "grid_role",
    "menu_kind",
    "capture_status",
    "path_text",
    "selected_path_text",
    "column_key",
    "warning",
    "warnings",
    "candidate_warnings",
    "reason",
    "reasons",
    "selected",
    "confidence",
    "confidence_reasons",
    "score",
    "promoted",
    "candidate_only",
    "adapter_name",
    "adapter_version",
    "adapter_request_id",
    "extension_version",
    "extension_build",
    "sdk_version",
    "sdk_build",
    "collector_build",
    "grid_id",
    "dataset_id",
    "component_id",
    "column_id",
    "column_label",
    "column_key",
    "bind_column",
    "editor_id",
    "grid_editor",
    "row_index",
    "col_index",
    "row_data",
    "selected_row",
    "headers",
    "grid_cell_click",
    "grid_row_select",
    "raw_value_source",
    "enrichment_context",
    "original_event_id",
    "original_interaction_id",
    "related_interaction_id",
    "related_event_id"
  ]);
  const FULL_SNAPSHOT_TRIGGERS = new Set([
    "collector_boot",
    "page_view",
    "route_change",
    "fetch_response",
    "xhr_response",
    "submit",
    "api_transaction",
    "api_transaction_error",
    "api_transaction_timeout",
    "popup_open"
  ]);
  const LOW_COST_SNAPSHOT_TRIGGERS = new Set([
    "click",
    "change",
    "focus",
    "blur",
    "beforeinput",
    "input",
    "compositionstart",
    "compositionend",
    "keydown",
    "paste",
    "canvas_click",
    "grid_cell_click",
    "grid_row_select",
    "popup_open",
    "popup_close",
    "grid_context_enrichment",
    "ui_outcome",
    "screen_change",
    "page_close"
  ]);
  let structureCache = null;
  let structureCacheUpdatedAt = 0;
  let structureCacheDirty = true;
  let structureCacheVersion = 0;
  let lastScreenSignature = null;
  let screenChangeTimer = null;
  const lastInputEventByElement = new WeakMap();
  const lastCommittedInputSignatureByElement = new WeakMap();
  const genericGridModelCache = new WeakMap();
  const genericTreeModelCache = new WeakMap();
  const gridAdapterCache = new Map();
  const gridAdapterCooldown = new Map();
  const pendingGridAdapterRequests = new Map();
  const pendingContentRows = [];
  const pendingContentRowIds = new Set();
  let lastGridEditContext = null;
  const GRID_EDIT_CONTEXT_TTL_MS = 5000;
  let contentSendRetryTimer = null;
  let contentSendInFlight = false;
  let contentSendDroppedCount = 0;
  let contentSendLastDroppedAt = null;
  let lastPageCloseEmittedAt = 0;
  let activeOutcomeObserver = null;
  const POPUP_ROOT_SELECTOR = [
    "dialog[open]",
    "[aria-modal='true']",
    "[role='dialog']",
    "[role='alertdialog']",
      ".modal",
      ".cl-popup",
      ".cl-dialog",
      ".cl-window"
    ].join(",");
  const UI_OUTCOME_SELECTOR = [
    "[role='alert']",
    "[role='status']",
    "[aria-live]",
    ".toast",
    ".alert",
    ".invalid-feedback",
    ".validation-message",
    ".error-message",
    "[data-validation-message]",
    "[aria-invalid='true']"
  ].join(",");
  const VALUE_REFLECTION_WINDOW_MS = 1500;
  const VALUE_REFLECTION_CHECK_DELAYS_MS = [80, 250, 700, 1400];
  const VALUE_REFLECTION_MAX_CANDIDATES = 80;
  const RECENT_VALUE_EVENT_WINDOW_MS = 1800;
  const popupStateByElement = new WeakMap();
  const popupStateById = new Map();
  const nativeDialogStateById = new Map();
  let popupSequence = 0;
  let visiblePopupIds = new Set();
  let popupLifecycleTimer = null;
  let lowCostMutationObserver = null;
  const recentValueEventByElement = new WeakMap();
  const recentValueReflectionKeys = new Map();
  const compositionState = {
    active: false,
    target: null,
    data: null,
    startedAt: null
  };
  const pendingSnapshots = new Map();
  let runtimeConfig = DEFAULT_RUNTIME_CONFIG;
  let runtimeConfigRefreshTimer = null;
  let siteIdentityCandidate = null;
  let siteIdentityCandidateElement = null;
  let siteIdentityCandidateTimer = null;
  let siteIdentitySubmitPending = false;
  let siteIdentitySuccessApiObserved = false;
  let siteIdentityProbeTimer = null;
  let pocManualIdentityPromptOpen = false;
  try {
    document.documentElement.setAttribute("data-az-collector-test", "active");
    document.documentElement.setAttribute("data-az-collector-origin", location.origin);
    document.documentElement.setAttribute("data-az-collector-build", COLLECTOR_BUILD);
  } catch {}

  function normalizeSiteIdentitySubject(value) {
    const normalized = typeof value === "string" ? value.normalize("NFKC").trim() : "";
    if (!normalized || normalized.length > 128) return null;
    if (/[\u0000-\u001f\u007f]/.test(normalized)) return null;
    return normalized;
  }

  function promptForPocManualIdentity() {
    if (pocManualIdentityPromptOpen || location.origin !== "http://211.109.22.33:8791") return;
    pocManualIdentityPromptOpen = true;
    try {
      const subject = normalizeSiteIdentitySubject(window.prompt("PoC 사용자 ID를 입력하세요", ""));
      if (!subject) return;
      chrome.runtime.sendMessage({ type: "POC_MANUAL_ID_SET", subject }, () => {
        void chrome.runtime.lastError;
      });
    } finally {
      pocManualIdentityPromptOpen = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "POC_MANUAL_ID_PROMPT") return false;
    promptForPocManualIdentity();
    sendResponse?.({ ok: true });
    return false;
  });

  function isLoginIdentifierInput(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    const type = String(element.type || "text").toLowerCase();
    if (!["text", "email", "tel"].includes(type)) return false;
    const isExcampusLoginInput = (() => {
      if (location.origin !== "http://211.109.22.33:8791") return false;
      const visibleIdentifiers = [...document.querySelectorAll("input[type='text'],input[type='email']")]
        .filter((input) => isVisibleCandidate(input));
      const visiblePasswords = [...document.querySelectorAll("input[type='password']")]
        .filter((input) => isVisibleCandidate(input));
      return visibleIdentifiers.length === 1 && visiblePasswords.length === 1 && visibleIdentifiers[0] === element;
    })();
    const autocomplete = String(element.autocomplete || element.getAttribute("autocomplete") || "").toLowerCase();
    const hint = fieldHintText(element).toLowerCase();
    const hasStrongHint = isExcampusLoginInput || autocomplete === "username" ||
      /(^|\b)(user(name)?|login|account|member)[_-]?(id|name)?(\b|$)/i.test(hint) ||
      /(아이디|사용자\s*(아이디|id)|로그인\s*(아이디|id)|사번|계정)/i.test(hint);
    if (!hasStrongHint) return false;
    const form = element.closest("form");
    const scope = form || element.parentElement?.parentElement || document;
    const hasPassword = Boolean(scope?.querySelector?.("input[type='password']"));
    const hasTargetLoginPassword = location.origin === "http://211.109.22.33:8791" &&
      Boolean(document.querySelector("input[type='password']"));
    return isExcampusLoginInput || hasPassword || hasTargetLoginPassword;
  }

  function sendIdentityControlMessage(type, extra = {}) {
    try {
      chrome.runtime.sendMessage({
        type,
        pageSessionId,
        pageUrl: location.href,
        ...extra
      }, () => void chrome.runtime.lastError);
    } catch {}
  }

  function rememberSiteIdentityCandidate(element, trigger = "input", immediate = false) {
    if (!isLoginIdentifierInput(element)) return;
    const subject = normalizeSiteIdentitySubject(element.value);
    if (!subject) return;
    siteIdentityCandidate = subject;
    siteIdentityCandidateElement = element;
    if (siteIdentityCandidateTimer) clearTimeout(siteIdentityCandidateTimer);
    const emit = () => {
      siteIdentityCandidateTimer = null;
      sendIdentityControlMessage("SITE_IDENTITY_CANDIDATE", { subject, trigger });
    };
    if (immediate) emit();
    else siteIdentityCandidateTimer = setTimeout(emit, INPUT_EVENT_DEBOUNCE_MS);
  }

  function markSiteIdentitySubmitted(element, trigger) {
    const form = element instanceof HTMLFormElement ? element : element?.closest?.("form");
    const candidateInput = [...(form?.querySelectorAll?.("input") || [])].find(isLoginIdentifierInput) ||
      siteIdentityCandidateElement;
    if (candidateInput) rememberSiteIdentityCandidate(candidateInput, trigger, true);
    if (!siteIdentityCandidate) return;
    siteIdentitySubmitPending = true;
    siteIdentitySuccessApiObserved = false;
    sendIdentityControlMessage("SITE_IDENTITY_SUBMITTED", { trigger });
    scheduleSiteIdentityProbe("login_submit", 300);
  }

  function isLoginSubmitControl(element) {
    if (!(element instanceof Element)) return false;
    const control = element.closest("button,input[type='submit'],[role='button'],[onclick]");
    if (!control) return false;
    const hint = `${control.getAttribute("id") || ""} ${control.getAttribute("name") || ""} ${control.getAttribute("value") || ""} ${visibleTextOf(control) || ""}`;
    if (!/(login|logon|sign\s*in|로그인)/i.test(hint)) return false;
    const form = control.closest("form");
    return Boolean(form?.querySelector?.("input[type='password']")) ||
      Boolean(document.querySelector("input[type='password']"));
  }

  function authenticatedSubjectFromDom() {
    const selectors = [
      "[data-authenticated-user-id]",
      "html[data-login-id]",
      "body[data-login-id]",
      "header [data-login-id]",
      "nav [data-login-id]",
      "aside [data-login-id]",
      "header [data-user-id]",
      "nav [data-user-id]",
      "aside [data-user-id]",
      "header [data-username]",
      "nav [data-username]",
      "aside [data-username]",
      "meta[name='user-id']"
    ];
    for (const element of document.querySelectorAll(selectors.join(","))) {
      const value = element.getAttribute("data-authenticated-user-id") ||
        element.getAttribute("data-login-id") ||
        element.getAttribute("data-user-id") ||
        element.getAttribute("data-username") ||
        element.getAttribute("content");
      const subject = normalizeSiteIdentitySubject(value);
      if (subject) return subject;
    }
    return null;
  }

  function hasAuthenticatedShellEvidence() {
    if (document.querySelector(
      "a[href*='logout' i],button[id*='logout' i],[onclick*='logout' i],[data-action='logout'],[data-authenticated-user-id],header [data-login-id],nav [data-login-id],aside [data-login-id]"
    )) return true;
    return [...document.querySelectorAll("header button,header a,nav button,nav a,aside button,aside a,[role='button']")]
      .slice(0, 100)
      .some((element) => /(로그아웃|log\s*out|sign\s*out)/i.test(visibleTextOf(element) || ""));
  }

  function visiblePasswordInputExists() {
    return [...document.querySelectorAll("input[type='password']")]
      .some((element) => isVisibleCandidate(element));
  }

  function confirmSiteIdentity(subject, confidence, trigger) {
    const normalized = normalizeSiteIdentitySubject(subject || siteIdentityCandidate);
    if (!normalized) return;
    siteIdentityCandidate = normalized;
    siteIdentitySubmitPending = false;
    siteIdentitySuccessApiObserved = false;
    sendIdentityControlMessage("SITE_IDENTITY_CONFIRMED", {
      subject: normalized,
      confidence,
      trigger
    });
  }

  function probeSiteIdentity(trigger = "dom_probe") {
    const domSubject = authenticatedSubjectFromDom();
    if (domSubject) {
      confirmSiteIdentity(domSubject, "verified_dom", trigger);
      return;
    }
    const knownTargetPostLogin = location.origin === "http://211.109.22.33:8791" &&
      !visiblePasswordInputExists();
    if (
      siteIdentitySubmitPending &&
      siteIdentitySuccessApiObserved &&
      !visiblePasswordInputExists() &&
      (hasAuthenticatedShellEvidence() || knownTargetPostLogin)
    ) {
      confirmSiteIdentity(siteIdentityCandidate, "verified_post_login_dom", trigger);
    }
  }

  function scheduleSiteIdentityProbe(trigger, delayMs = 250) {
    if (siteIdentityProbeTimer) clearTimeout(siteIdentityProbeTimer);
    siteIdentityProbeTimer = setTimeout(() => {
      siteIdentityProbeTimer = null;
      probeSiteIdentity(trigger);
    }, Math.max(0, delayMs));
  }

  function observeSiteIdentityApiOutcome(type, payload) {
    if (!siteIdentitySubmitPending || type.endsWith("_ERROR")) return;
    const status = Number(payload?.status);
    if (!Number.isFinite(status) || status < 200 || status >= 400) return;
    const url = String(payload?.url || "");
    if (!/(login|logon|signin|sign-in|auth|session)/i.test(url)) return;
    siteIdentitySuccessApiObserved = true;
    sendIdentityControlMessage("SITE_IDENTITY_LOGIN_RESPONSE", { url, status });
    scheduleSiteIdentityProbe("login_api_response", 300);
  }

  function restoreSiteIdentityState() {
    try {
      chrome.runtime.sendMessage({ type: "SITE_IDENTITY_STATUS_GET" }, (response) => {
        void chrome.runtime.lastError;
        const subject = normalizeSiteIdentitySubject(response?.candidate?.subject || response?.identity?.subject);
        if (subject) siteIdentityCandidate = subject;
        siteIdentitySubmitPending = Boolean(response?.submitted_at && !response?.identity);
        siteIdentitySuccessApiObserved = Boolean(response?.login_response_at && !response?.identity);
        scheduleSiteIdentityProbe("state_restore", 0);
      });
    } catch {}
  }

  function normalizeApiCaptureConfig(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const ttlMs = Number(source.transaction_ttl_ms);
    const maxBufferSize = Number(source.max_buffer_size);
    return {
      ...DEFAULT_API_CAPTURE_CONFIG,
      ...source,
      enabled: source.enabled !== false,
      transaction_mode: source.transaction_mode !== false,
      emit_legacy_api_rows: source.emit_legacy_api_rows === true,
      capture_request_body: false,
      capture_response_body: false,
      capture_headers: false,
      allowed_header_names: Array.isArray(source.allowed_header_names) ? source.allowed_header_names.slice(0, 50) : [],
      transaction_ttl_ms: Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, 120000) : DEFAULT_API_CAPTURE_CONFIG.transaction_ttl_ms,
      max_buffer_size: Number.isFinite(maxBufferSize) && maxBufferSize > 0 ? Math.min(Math.trunc(maxBufferSize), 2000) : DEFAULT_API_CAPTURE_CONFIG.max_buffer_size
    };
  }

  function normalizeRuntimeConfig(value) {
    const config = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      ...DEFAULT_RUNTIME_CONFIG,
      ...config,
      schema_version: Number.isFinite(Number(config.schema_version)) ? Math.trunc(Number(config.schema_version)) : 1,
      version: typeof config.version === "string" && config.version.trim() ? config.version.trim() : "local-default",
      source: typeof config.source === "string" && config.source.trim() ? config.source.trim() : "extension-default",
      modules: config.modules && typeof config.modules === "object" && !Array.isArray(config.modules) ? config.modules : {},
      event_types: config.event_types && typeof config.event_types === "object" && !Array.isArray(config.event_types) ? config.event_types : {},
      selector_packs: config.selector_packs && typeof config.selector_packs === "object" && !Array.isArray(config.selector_packs) ? config.selector_packs : {},
      workflow_rules: Array.isArray(config.workflow_rules) ? config.workflow_rules.slice(0, 200) : [],
      privacy: config.privacy && typeof config.privacy === "object" && !Array.isArray(config.privacy) ? config.privacy : {},
      api_capture: normalizeApiCaptureConfig(config.api_capture)
    };
  }

  function enabledRuntimeModuleNames() {
    return Object.entries(runtimeConfig.modules || {})
      .filter(([, value]) => value !== false && value?.enabled !== false)
      .map(([name]) => name);
  }

  function includesAnyText(value, needles) {
    const text = String(value || "");
    return (Array.isArray(needles) ? needles : [needles])
      .filter(Boolean)
      .some((needle) => text.includes(String(needle)));
  }

  function runtimeRuleMatches(row, rule) {
    if (!rule || typeof rule !== "object") return false;
    const hasCondition = rule.actions || rule.url_includes || rule.selector_includes || rule.text_includes;
    if (!hasCondition) return false;
    if (rule.actions && ![].concat(rule.actions).includes(row.action)) return false;
    if (rule.url_includes && !includesAnyText(row.page_url, rule.url_includes)) return false;
    if (rule.selector_includes && !includesAnyText(row.selector_css, rule.selector_includes)) return false;
    if (rule.text_includes && !includesAnyText(row.element_text, rule.text_includes)) return false;
    return true;
  }

  function attachRuntimeContext(row) {
    if (!row || typeof row !== "object") return row;
    const matchedRuleIds = (runtimeConfig.workflow_rules || [])
      .filter((rule) => runtimeRuleMatches(row, rule))
      .map((rule) => rule.id || rule.name)
      .filter(Boolean);
    const runtimeContext = {
      schema_version: runtimeConfig.schema_version || 1,
      config_version: runtimeConfig.version || "local-default",
      source: runtimeConfig.source || "extension-default",
      matched_rule_ids: matchedRuleIds,
      active_module_names: enabledRuntimeModuleNames()
    };

    row.runtime_config_version = runtimeContext.config_version;
    row.runtime_config_schema_version = runtimeContext.schema_version;
    row.runtime_rule_ids = matchedRuleIds;
    row.runtime_modules = runtimeContext.active_module_names;
    row.extension_version = row.extension_version || EXTENSION_VERSION;
    row.extension_build = row.extension_build || EXTENSION_BUILD;
    row.sdk_version = row.sdk_version || null;
    row.sdk_build = row.sdk_build || null;
    row.collector_build = row.sdk_version
      ? `${row.extension_build}+${row.sdk_version}`
      : (row.collector_build || COLLECTOR_BUILD);
    row.payload = {
      ...(row.payload || {}),
      extension_version: row.extension_version,
      extension_build: row.extension_build,
      sdk_version: row.sdk_version,
      sdk_build: row.sdk_build,
      collector_build: row.collector_build,
      runtime_context: runtimeContext
    };
    return row;
  }

  function scheduleRuntimeConfigRefresh(delayMs = RUNTIME_CONFIG_REFRESH_INTERVAL_MS) {
    if (runtimeConfigRefreshTimer) clearTimeout(runtimeConfigRefreshTimer);
    runtimeConfigRefreshTimer = setTimeout(() => {
      runtimeConfigRefreshTimer = null;
      requestRuntimeConfig();
    }, Math.max(5000, delayMs));
  }

  function requestRuntimeConfig() {
    try {
      chrome.runtime.sendMessage({ type: "GET_RUNTIME_CONFIG", pageUrl: location.href }, (response) => {
        void chrome.runtime.lastError;
        if (response?.ok && response.config) {
          runtimeConfig = normalizeRuntimeConfig(response.config);
          maybeInjectRemoteSdkLoader();
        }
        const nextDelay = Number(runtimeConfig.ttl_ms || RUNTIME_CONFIG_REFRESH_INTERVAL_MS);
        scheduleRuntimeConfigRefresh(Number.isFinite(nextDelay) ? nextDelay : RUNTIME_CONFIG_REFRESH_INTERVAL_MS);
      });
    } catch {
      scheduleRuntimeConfigRefresh(RUNTIME_CONFIG_REFRESH_INTERVAL_MS);
    }
  }

  function remoteSdkModuleConfig() {
    const moduleConfig = runtimeConfig?.modules?.remote_sdk && typeof runtimeConfig.modules.remote_sdk === "object"
      ? runtimeConfig.modules.remote_sdk
      : {};
    let query = null;
    try {
      query = new URLSearchParams(location.search || "");
    } catch {}

    const queryEnabled = query?.get("az_remote_sdk") === "1";
    const enabled = moduleConfig.enabled === true || queryEnabled;
    if (!enabled) return null;

    const loaderUrl =
      typeof moduleConfig.loader_url === "string" && moduleConfig.loader_url.trim()
        ? moduleConfig.loader_url.trim()
        : (query?.get("az_sdk_loader") || "");
    const resolvedLoaderUrl = loaderUrl;
    if (!resolvedLoaderUrl) return null;
    const tenantId =
      typeof moduleConfig.tenant_id === "string" && moduleConfig.tenant_id.trim()
        ? moduleConfig.tenant_id.trim()
        : "";
    if (!tenantId) return null;

    return {
      loaderUrl: resolvedLoaderUrl,
      channel:
        typeof moduleConfig.channel === "string" && moduleConfig.channel.trim()
          ? moduleConfig.channel.trim()
          : REMOTE_SDK_DEFAULT_CHANNEL,
      tenantId
    };
  }

  function isAllowedRemoteSdkLoaderUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return REMOTE_SDK_ALLOWED_ORIGINS.has(parsed.origin) && parsed.pathname.endsWith("/collector-loader.js");
    } catch {
      return false;
    }
  }

  function maybeInjectRemoteSdkLoader() {
    if (!isAllowedTarget) return;
    const config = remoteSdkModuleConfig();
    if (!config || !isAllowedRemoteSdkLoaderUrl(config.loaderUrl)) return;

    const injectKey = `${config.loaderUrl}|${config.channel}|${config.tenantId}`;
    if (remoteSdkInjectedKey === injectKey) return;
    remoteSdkInjectedKey = injectKey;

    const marker = "data-az-remote-sdk-loader";
    if (document.documentElement?.getAttribute(marker) === injectKey) return;
    document.documentElement?.setAttribute(marker, injectKey);

    const loaderUrl = new URL(config.loaderUrl, location.href);
    loaderUrl.searchParams.set("channel", config.channel);
    loaderUrl.searchParams.set("token", remoteSdkToken);
    loaderUrl.searchParams.set("tenantId", config.tenantId);
    loaderUrl.searchParams.set("pageUrl", location.href);
    loaderUrl.searchParams.set("extensionVersion", EXTENSION_VERSION);
    loaderUrl.searchParams.set("extensionBuild", EXTENSION_BUILD);

    const script = document.createElement("script");
    script.src = loaderUrl.toString();
    script.async = false;
    script.dataset.azRemoteSdkLoader = "1";
    script.dataset.extensionVersion = EXTENSION_VERSION;
    script.dataset.extensionBuild = EXTENSION_BUILD;
    script.onload = () => script.remove();
    script.onerror = () => {
      console.warn("[Rainbow Collector] 원격 SDK loader 주입 실패", {
        "실패 이유": "script load error",
        "loader URL": loaderUrl.toString(),
        "영향": "서버 SDK 기반 추가 수집 모듈은 동작하지 않고 extension 내장 수집만 동작함"
      });
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function safeJsonSize(value) {
    try {
      return JSON.stringify(value).length;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  function isValidRemoteSdkEvent(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return false;
    if (typeof event.event_id !== "string" || event.event_id.length > 128) return false;
    if (typeof event.event_time !== "string" || event.event_time.length > 64) return false;
    if (typeof event.action !== "string" || !/^[a-z_]+$/.test(event.action)) return false;
    if (typeof event.page_url !== "string" || event.page_url.length > 2048) return false;
    if (event.payload && (typeof event.payload !== "object" || Array.isArray(event.payload))) return false;
    return true;
  }

  function buildRemoteSdkRow(sdkEvent, bridgeData = {}) {
    const sdkVersion =
      typeof sdkEvent.sdk_version === "string" && sdkEvent.sdk_version.trim()
        ? sdkEvent.sdk_version.trim()
        : "unknown";
    const sdkBuild =
      typeof sdkEvent.sdk_build === "string" && sdkEvent.sdk_build.trim()
        ? sdkEvent.sdk_build.trim()
        : sdkVersion;
    remoteSdkLastEventVersion = sdkVersion;

    return buildRow(document.documentElement, sdkEvent.action, {
      eventTimeOverride: sdkEvent.event_time || null,
      elementText: `remote_sdk:${sdkEvent.action}`,
      payload: {
        ...(sdkEvent.payload && typeof sdkEvent.payload === "object" ? sdkEvent.payload : {}),
        kind: "remote_sdk_event",
        source: REMOTE_SDK_SOURCE,
        sdk_version: sdkVersion,
        sdk_build: sdkBuild,
        extension_version: EXTENSION_VERSION,
        extension_build: EXTENSION_BUILD,
        sdk_event_id: sdkEvent.event_id,
        sdk_page_url: sdkEvent.page_url || null,
        sdk_page_title: sdkEvent.title || null,
        bridge_context: {
          channel: bridgeData.channel || null,
          origin: location.origin,
          received_at: new Date().toISOString()
        }
      },
      snapshot: captureSnapshot("remote_sdk_event", {
        sdk_action: sdkEvent.action,
        sdk_version: sdkVersion,
        sdk_build: sdkBuild
      })
    });
  }

  function handleRemoteSdkMessage(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    if (data.source !== REMOTE_SDK_SOURCE) return false;
    if (data.token !== remoteSdkToken) return true;
    if (!isValidRemoteSdkEvent(data.event)) return true;
    if (safeJsonSize(data.event) > REMOTE_SDK_MAX_PAYLOAD_BYTES) return true;
    sendRows([buildRemoteSdkRow(data.event, data)]);
    return true;
  }

  function textOf(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim() || null;
  }

  function parseEventTimeMs(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.getTime();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function eventTimeToIso(value, fallbackMs = Date.now()) {
    const ms = parseEventTimeMs(value);
    return new Date(ms != null ? ms : fallbackMs).toISOString();
  }

  function isInternalCollectorEndpoint(url) {
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
  }

  function normalizeInternalCollectorApiPayload(payload) {
    if (!payload || typeof payload !== "object") return payload;
    if (!isInternalCollectorEndpoint(payload.url || null)) return stripApiBodyFields(payload);
    return {
      ...stripApiBodyFields(payload),
      body_capture_skipped: true,
      body_capture_skip_reason: "internal_collector_endpoint"
    };
  }

  function stripApiBodyFields(payload) {
    if (!payload || typeof payload !== "object") return {};
    const {
      requestBody,
      request_body,
      responseBody,
      response_body,
      headers,
      requestHeaders,
      responseHeaders,
      ...rest
    } = payload;
    return {
      ...rest,
      body_capture: {
        request_body_captured: false,
        response_body_captured: false,
        reason: payload.body_capture_skip_reason || payload.body_capture?.reason || "disabled_by_privacy_policy"
      }
    };
  }

  function markStructureCacheDirty() {
    structureCacheDirty = true;
    structureCacheVersion += 1;
  }

  function clampNumber(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
  }

  function limitCandidateList(items, limit = MAX_CONTEXT_CANDIDATES) {
    if (!Array.isArray(items)) return [];
    return items.filter(Boolean).slice(0, limit);
  }

  function toConfidenceFromScore(score, minScore = 0, maxScore = 12) {
    const bounded = clampNumber(score, minScore, maxScore);
    const ratio = (bounded - minScore) / Math.max(1, maxScore - minScore);
    return Number((0.2 + (ratio * 0.78)).toFixed(2));
  }

  function averageConfidence(values) {
    const numeric = (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (numeric.length === 0) return null;
    return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(2));
  }

  function normalizeWarningList(warnings) {
    return limitCandidateList([...new Set((Array.isArray(warnings) ? warnings : [])
      .map((warning) => String(warning || "").trim())
      .filter(Boolean))], MAX_DEBUG_CANDIDATES);
  }

  function dedupeScoredCandidates(candidates, keyFn, scoreFn = null) {
    const result = new Map();
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      if (!candidate) continue;
      const key = typeof keyFn === "function" ? String(keyFn(candidate) || "").trim() : "";
      if (!key) continue;
      const score = Number.isFinite(Number(candidate.score))
        ? Number(candidate.score)
        : typeof scoreFn === "function"
          ? Number(scoreFn(candidate))
          : 0;
      const normalized = {
        ...candidate,
        score
      };
      const existing = result.get(key);
      if (!existing || score > Number(existing.score || -999)) {
        result.set(key, normalized);
      }
    }
    return [...result.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  }

  function limitObjectEntries(value, maxEntries = 5) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).slice(0, maxEntries));
  }

  function pruneTimedMap(map, now = Date.now()) {
    if (!(map instanceof Map)) return;
    for (const [key, entry] of map.entries()) {
      if (!entry || (entry.expiresAt != null && entry.expiresAt <= now)) {
        map.delete(key);
      }
    }
  }

  function readCachedStructureModel(cache, root, builder) {
    if (!(root instanceof Element) || typeof builder !== "function") return null;
    const cached = cache.get(root);
    if (cached && cached.version === structureCacheVersion) {
      return cached.model;
    }
    const model = builder(root);
    cache.set(root, {
      version: structureCacheVersion,
      model
    });
    return model;
  }

  function isElementLike(value) {
    return value instanceof Element;
  }

  function semanticTargetFromEvent(event) {
    const rawTarget = event?.target instanceof Element ? event.target : null;
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const semanticSelector = [
      "button",
      "a",
      "input",
      "select",
      "textarea",
      "form",
      "td",
      "th",
      "canvas",
      "[contenteditable='true']",
      "[contenteditable='']",
      "[role='button']",
      "[role='link']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='treeitem']",
      "[role='gridcell']",
      "[role='cell']",
      "[role='columnheader']",
      "[role='rowheader']",
      "[data-row-index][data-col-id]",
      "[data-row-index][data-col-index]"
    ].join(",");

    for (const item of path) {
      if (!(item instanceof Element)) continue;
      if (item.matches?.(semanticSelector)) return item;
      const closest = item.closest?.(semanticSelector);
      if (closest) return closest;
    }

    if (rawTarget) {
      return rawTarget.closest?.(semanticSelector) || rawTarget;
    }

    return null;
  }

  function createNoopGridAdapter(name, priority, detect) {
    return {
      name,
      priority,
      detect(target, event) {
        return typeof detect === "function" ? Boolean(detect(target, event)) : false;
      },
      resolve() {
        return null;
      }
    };
  }

  function createAdapterRequestId(adapterName) {
    return `${adapterName}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function buildAdapterTargetHint(target) {
    if (!(target instanceof Element)) return null;
    return {
      id: target.id || null,
      className: String(target.className || "").trim() || null,
      role: target.getAttribute("role") || null,
      tagName: target.tagName?.toLowerCase() || null,
      selector: cssPath(target),
      bounds: boundsOf(target)
    };
  }

  function gridAdapterRootHint(target) {
    if (!(target instanceof Element)) return null;
    return target.closest(
      "[data-cpr-control],[data-control],[class*='cl-grid'],[class*='ag-root'],[class*='ag-grid'],[class*='k-grid'],[class*='dx-datagrid'],[class*='MuiDataGrid-root'],table,[role='grid'],[role='treegrid'],[id*='grd'],[id*='grid']"
    ) || target.closest("td,th,[role='gridcell'],[role='cell'],[role='columnheader'],[role='rowheader']");
  }

  function gridAdapterCacheKey(adapterName, target) {
    const root = gridAdapterRootHint(target);
    if (!(root instanceof Element)) return `${adapterName}|no-root`;
    const selector = root.id ? `#${root.id}` : cssPath(root);
    return `${adapterName}|${selector}`;
  }

  function readGridAdapterCache(cacheKey) {
    pruneTimedMap(gridAdapterCache);
    const cached = gridAdapterCache.get(cacheKey);
    if (!cached || cached.expiresAt <= Date.now()) {
      gridAdapterCache.delete(cacheKey);
      return null;
    }
    return cached.value || null;
  }

  function writeGridAdapterCache(cacheKey, value, ttlMs = GRID_ADAPTER_CACHE_TTL_MS) {
    if (!cacheKey || !value) return;
    gridAdapterCache.set(cacheKey, {
      expiresAt: Date.now() + Math.max(250, ttlMs),
      value
    });
  }

  function isGridAdapterCoolingDown(cacheKey) {
    pruneTimedMap(gridAdapterCooldown);
    const entry = gridAdapterCooldown.get(cacheKey);
    if (!entry || entry.expiresAt <= Date.now()) {
      gridAdapterCooldown.delete(cacheKey);
      return false;
    }
    return true;
  }

  function setGridAdapterCooldown(cacheKey, reason = "adapter_failed") {
    if (!cacheKey) return;
    gridAdapterCooldown.set(cacheKey, {
      reason,
      expiresAt: Date.now() + GRID_ADAPTER_COOLDOWN_MS
    });
  }

  function looksLikeGridishInteractionTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(
      "table,[role='grid'],[role='treegrid'],[role='gridcell'],[role='cell'],[role='columnheader'],[role='rowheader'],[data-row-index][data-col-id],[data-row-index][data-col-index],[class*='grid'],[id*='grid'],[id*='grd'],canvas"
    ));
  }

  function looksLikeExBuilder6GridTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest([
      "[class*='cl-grid']",
      "[class*='cl-gridcell']",
      "[id*='grd']",
      "[id*='grid']",
      "[data-control]",
      "[data-cpr-control]",
      "[role='grid']",
      "[role='gridcell']"
    ].join(",")));
  }

  function buildPendingGridAdapterContext(adapterName, requestId, warnings = []) {
    return {
      detected: true,
      promoted: false,
      candidate_only: true,
      framework: adapterName,
      source: `${adapterName}_adapter_pending`,
      parser: `${adapterName}_adapter_pending`,
      grid_type: "grid",
      grid_role: "unknown",
      capture_status: "pending",
      warnings: normalizeWarningList(warnings),
      adapter_name: adapterName,
      adapter_request_id: requestId
    };
  }

  function requestExBuilder6GridContext(target, event, context = {}) {
    const requestId = createAdapterRequestId("exbuilder6");
    return {
      gridContext: buildPendingGridAdapterContext("exbuilder6", requestId, ["exbuilder6_adapter_async_pending"]),
      request: {
        kind: "exbuilder6",
        requestId,
        adapterName: "exbuilder6",
        targetHint: buildAdapterTargetHint(target),
        point: {
          x: event?.clientX ?? null,
          y: event?.clientY ?? null
        },
        originalEventId: context.eventId || null,
        originalInteractionId: context.interactionId || null
      }
    };
  }

  const ExBuilder6GridAdapter = {
    name: "exbuilder6",
    priority: 100,
    detect(target, event) {
      return looksLikeExBuilder6GridTarget(target, event);
    },
    resolve(target, event, context) {
      return requestExBuilder6GridContext(target, event, context);
    }
  };

  const NexacroGridAdapter = createNoopGridAdapter(
    "nexacro_internal",
    90,
    (target) => target instanceof Element && Boolean(target.closest(".Grid.NxPivot_grid,[id*='NxPivot'],[id*='gridrow_']"))
  );

  const WebSquareGridAdapter = createNoopGridAdapter(
    "websquare_internal",
    85,
    (target) => target instanceof Element && Boolean(target.closest("[id*='gridView'],[class*='w2grid'],[id$='_body_table']"))
  );

  const AgGridAdapter = createNoopGridAdapter(
    "ag_grid",
    80,
    (target) => target instanceof Element && Boolean(target.closest(".ag-root,.ag-theme-alpine,.ag-theme-balham,[class*='ag-grid']"))
  );

  const MuiDataGridAdapter = createNoopGridAdapter(
    "mui_datagrid",
    78,
    (target) => target instanceof Element && Boolean(target.closest(".MuiDataGrid-root,[class*='MuiDataGrid']"))
  );

  const KendoGridAdapter = createNoopGridAdapter(
    "kendo_grid",
    76,
    (target) => target instanceof Element && Boolean(target.closest(".k-grid,[class*='k-grid']"))
  );

  const DevExtremeGridAdapter = createNoopGridAdapter(
    "devextreme_datagrid",
    74,
    (target) => target instanceof Element && Boolean(target.closest(".dx-datagrid,[class*='dx-datagrid']"))
  );

  const GridAdapterRegistry = [
    ExBuilder6GridAdapter,
    NexacroGridAdapter,
    WebSquareGridAdapter,
    AgGridAdapter,
    MuiDataGridAdapter,
    KendoGridAdapter,
    DevExtremeGridAdapter
  ];

  function selectCandidateGridAdapters(target, event) {
    if (!looksLikeGridishInteractionTarget(target) && !looksLikeExBuilder6GridTarget(target)) return [];
    return GridAdapterRegistry
      .map((adapter) => {
        try {
          return adapter.detect(target, event) ? adapter : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, MAX_CONTEXT_CANDIDATES);
  }

  function normalizeAdapterGridContext(adapterName, value) {
    if (!adapterName || !value) return null;
    if (adapterName === "exbuilder6") return normalizeExBuilder6GridContext(value);
    return null;
  }

  function normalizeExBuilder6GridContext(value) {
    if (!value || typeof value !== "object") return null;
    const rowContext = value.rowContext && typeof value.rowContext === "object"
      ? {
          row_index: value.rowIndex ?? null,
          row_path: normalizePathParts(value.rowContext.row_path || value.rowContext.rowPath || []),
          row_label: value.rowContext.row_label || value.rowContext.rowLabel || null,
          values: limitObjectEntries(value.rowContext.values || value.rowContext.map || null, MAX_GRID_ROW_FIELDS),
          map: limitObjectEntries(value.rowContext.map || value.rowContext.values || null, MAX_GRID_ROW_FIELDS),
          confidence: value.rowContext.confidence ?? 0.95,
          candidates: limitCandidateList(value.rowContext.candidates || [], MAX_CONTEXT_CANDIDATES),
          capture_status: value.rowContext.capture_status || "complete",
          warnings: normalizeWarningList(value.rowContext.warnings || [])
        }
      : null;

    return {
      detected: true,
      promoted: true,
      candidate_only: false,
      framework: "exbuilder6",
      source: "exbuilder6_internal_adapter",
      parser: "exbuilder6_grid_model",
      grid_type: "grid",
      grid_role: "data_grid",
      grid_id: value.gridId || null,
      dataset_id: value.datasetId || null,
      component_id: value.componentId || null,
        app_id: value.appId || null,
        row_index: value.rowIndex ?? null,
        col_index: value.colIndex ?? null,
        model_col_index: value.modelColIndex ?? null,
        column_id: value.columnId || null,
      column_label: value.columnLabel || null,
      column_path: value.columnLabel ? [value.columnLabel] : null,
      column_key: value.columnId || value.columnLabel || null,
      cell_value: value.cellValue ?? null,
      raw_value: value.rawValue ?? null,
      row_context: rowContext,
      row_context_map: rowContext?.map || rowContext?.values || null,
      headers: Array.isArray(value.headers) ? value.headers.slice(0, 40) : null,
      confidence: {
        grid: 0.98,
        row_mapping: rowContext?.confidence ?? 0.95,
        column_mapping: 0.95,
        cell_value: value.cellValue != null ? 0.98 : 0.35
      },
      capture_status: "complete",
      warnings: []
    };
  }

  function adapterDebugCandidate(adapter, outcome = {}) {
    const baseContext = outcome.gridContext || outcome.result || null;
    return {
      adapter_name: adapter.name,
      source: baseContext?.source || `${adapter.name}_adapter`,
      parser: baseContext?.parser || `${adapter.name}_adapter`,
      capture_status: baseContext?.capture_status || baseContext?.captureStatus || outcome.status || "partial",
      score: Number(outcome.score || adapter.priority || 0),
      warnings: normalizeWarningList([
        ...(baseContext?.warnings || []),
        ...(outcome.warnings || [])
      ]),
      adapter_request_id: baseContext?.adapter_request_id || outcome.request?.requestId || null
    };
  }

  function gridAdapterTimeoutFor(adapter) {
    const name = String(adapter?.name || "").trim();
    if (!name) return GRID_ADAPTER_TIMEOUT_MS;
    if (/internal|exbuilder6|nexacro|websquare/i.test(name)) {
      return INTERNAL_GRID_ADAPTER_TIMEOUT_MS;
    }
    if (/late|delayed|promise/i.test(name)) {
      return LATE_GRID_ADAPTER_TIMEOUT_MS;
    }
    return GRID_ADAPTER_TIMEOUT_MS;
  }

  function tryResolveGridAdapterWithinBudget(adapter, target, event, context = {}) {
    const cacheKey = gridAdapterCacheKey(adapter.name, target);
    if (isGridAdapterCoolingDown(cacheKey)) {
      return {
        adapter,
        cacheKey,
        status: "cooldown",
        warnings: [`${adapter.name}_adapter_cooldown`]
      };
    }

    const cached = readGridAdapterCache(cacheKey);
    if (cached) {
      return {
        adapter,
        cacheKey,
        status: "cache_hit",
        result: cached,
        warnings: []
      };
    }

    try {
      const resolved = adapter.resolve(target, event, context);
      if (resolved && typeof resolved.then === "function") {
        const timeoutMs = gridAdapterTimeoutFor(adapter);
        const timed = Promise.race([
          resolved.then((value) => ({ status: "resolved", value })).catch((error) => ({ status: "failed", error })),
          new Promise((resolve) => setTimeout(() => resolve({ status: "timeout" }), timeoutMs))
        ]);
        return {
          adapter,
          cacheKey,
          status: "async_pending",
          pendingPromise: timed
        };
      }
      return {
        adapter,
        cacheKey,
        status: "resolved",
        result: resolved,
        warnings: []
      };
    } catch (error) {
      setGridAdapterCooldown(cacheKey, `${adapter.name}_adapter_failed`);
      return {
        adapter,
        cacheKey,
        status: "failed",
        warnings: [`${adapter.name}_adapter_failed`],
        error
      };
    }
  }

  function nextEventSequence() {
    eventSequence += 1;
    return eventSequence;
  }

  function clonePayloadValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {}
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      if (Array.isArray(value)) return value.slice();
      if (typeof value === "object") return { ...value };
      return value;
    }
  }

  function fieldHintText(el) {
    if (!(el instanceof Element)) return "";
    return [
      el.getAttribute("name"),
      el.getAttribute("id"),
      el.getAttribute("type"),
      el.getAttribute("autocomplete"),
      el.getAttribute("inputmode"),
      el.getAttribute("placeholder"),
      classTextOf(el)
    ].filter(Boolean).join(" ");
  }

  function isInputLikeElement(el) {
    return el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      (el instanceof HTMLElement && el.isContentEditable);
  }

  function isDocumentLevelElement(el) {
    return el === document.documentElement || el === document.body;
  }

  function isKeyboardInteractionTarget(el) {
    if (!(el instanceof Element) || isDocumentLevelElement(el)) return false;
    return isInputLikeElement(el) ||
      el.matches?.("button, a[href], select, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='treeitem'], [role='gridcell'], [role='cell'], [role='combobox'], [role='textbox'], [data-row-index][data-col-id], [data-row-index][data-col-index]");
  }

  function controlValueOf(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return target.value;
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      return visibleTextOf(target) || textOf(target);
    }
    if (isDocumentLevelElement(target)) return null;
    return visibleTextOf(target);
  }

  function readStringAttr(el, names) {
    if (!(el instanceof Element)) return null;
    for (const name of names) {
      const value = el.getAttribute?.(name);
      if (value == null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return null;
  }

  function closestGridEditorCell(target) {
    if (!(target instanceof Element)) return null;
    const anchor = isInputLikeElement(target) ? target.parentElement : target;
    return anchor?.closest(
      "[role='gridcell'],[role='cell'],[data-row-index][data-col-index],[data-row-index][data-col-id],[id*='cell_'],[class*='cell'],td,th"
    ) || null;
  }

  function closestGridEditorRoot(target) {
    if (!(target instanceof Element)) return null;
    let current = closestGridEditorCell(target)?.parentElement || target.parentElement || null;
    const rootSelector = [
      "[data-cpr-control]",
      "[data-control]",
      "[role='grid']",
      "[role='treegrid']",
      "table",
      "[class*='cl-grid']",
      ".nexa-grid",
      ".ws-grid",
      "[id*='grd']",
      "[id*='grid']"
    ].join(",");
    while (current && current !== document.documentElement) {
      if (
        current.matches?.(rootSelector) &&
        !current.matches?.("[id*='cell_'],[class*='cell'],[id*='gridrow_'],[id*='containerbody']")
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function normalizeWebSquareGridId(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const match = text.match(/(gridView[_A-Za-z0-9-]*)(?:_body_table)?(?:$|[\s.:_-])/i);
    return match ? match[1].replace(/_body_table$/i, "") : null;
  }

  function humanizeColumnIdentifier(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const spaced = text
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
    if (!spaced) return null;
    if (/^[A-Z0-9 ]+$/.test(spaced)) {
      return cleanMenuLabel(spaced);
    }
    return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
  }

  function hasFiniteNumericValue(value) {
    if (value == null || value === "") return false;
    const parsed = Number(value);
    return Number.isFinite(parsed);
  }

  function toFiniteNumberOrNull(value) {
    return hasFiniteNumericValue(value) ? Number(value) : null;
  }

  function findWebSquareGridRoot(target) {
    if (!(target instanceof Element)) return null;
    return target.closest?.(
      "[data-framework='websquare'],[class*='w2grid'],[class*='ws-grid'],table[id*='gridView'][id$='_body_table'],[id*='gridView'][id$='_body_table']"
    ) || null;
  }

  function looksLikeWebSquareEditorInput(target) {
    if (!(target instanceof Element)) return false;
    if (!isInputLikeElement(target)) return false;

    const root = findWebSquareGridRoot(target);
    if (!(root instanceof Element)) return false;

    return Boolean(target.closest?.(
      "[role='gridcell'],[data-row-index][data-col-index],[data-row-index][data-col-id],[data-row][data-col],[data-field],[data-column-id],[class*='gridCell'],[class*='w2grid_cell'],td,th"
    ));
  }

  function parseWebSquareEditorHints(target) {
    if (!looksLikeWebSquareEditorInput(target)) return null;

    const cell = closestGridEditorCell(target);
    const root = findWebSquareGridRoot(target) || closestGridEditorRoot(target);
    const cellMeta = parseWebSquareCellMeta(cell) || parseWebSquareCellMeta(target);
    const gridId =
      readStringAttr(target, ["data-grid-id"]) ||
      readStringAttr(cell, ["data-grid-id"]) ||
      normalizeWebSquareGridId(root?.id || "") ||
      root?.id ||
      null;
    const rowIndex =
      readNumericAttr(target, ["data-row-index", "data-rowindex", "data-row"]) ??
      readNumericAttr(cell, ["data-row-index", "data-rowindex", "data-row"]) ??
      cellMeta?.rowIndex ??
      null;
    const colIndex =
      readNumericAttr(target, ["data-col-index", "data-colindex", "data-col", "aria-colindex"]) ??
      readNumericAttr(cell, ["data-col-index", "data-colindex", "data-col", "aria-colindex"]) ??
      cellMeta?.colIndex ??
      null;
    const columnId =
      readStringAttr(target, ["data-column-id", "data-col-id", "data-field"]) ||
      readStringAttr(cell, ["data-column-id", "data-col-id", "data-field"]) ||
      null;
    const columnLabel =
      cleanMenuLabel(
        readStringAttr(target, ["data-column-label", "aria-label", "title"]) ||
        readStringAttr(cell, ["data-column-label", "data-label", "aria-label", "title"]) ||
        ""
      ) ||
      humanizeColumnIdentifier(columnId) ||
      null;

    return {
      framework: "websquare_like_dom",
      grid_id: gridId,
      row_index: toFiniteNumberOrNull(rowIndex),
      col_index: toFiniteNumberOrNull(colIndex),
      column_id: columnId,
      column_label: columnLabel,
      editor_id: target.id || null,
      source: "websquare_editor_dom"
    };
  }

  function looksLikeGridEditorInput(target) {
    if (!(target instanceof Element)) return false;
    if (!isInputLikeElement(target)) return false;
    if (looksLikeWebSquareEditorInput(target)) return true;

    const cell = closestGridEditorCell(target);
    const root = closestGridEditorRoot(target);
    const text = [
      target.id,
      target.getAttribute("name"),
      String(target.className || ""),
      target.getAttribute("aria-label"),
      cell?.id || null,
      String(cell?.className || ""),
      root?.id || null,
      String(root?.className || "")
    ].filter(Boolean).join(" ");

    if (/gridrow_\d+|cell_\d+_\d+|celledit\d*|grd[_A-Za-z0-9]*|(?:^|[.\s_-])body(?:[.\s_-]|$)/i.test(text)) {
      return true;
    }

    return Boolean(target.closest?.(
      "[role='gridcell'],[role='cell'],[data-row-index][data-col-index],[data-row-index][data-col-id],[class*='grid'],[id*='grid'],[id*='grd']"
    ));
  }

  function parseGridEditorSelectorHints(target) {
    if (!(target instanceof Element)) {
      return {
        grid_id: null,
        row_index: null,
        col_index: null,
        column_id: null,
        editor_id: null,
        source: null
      };
    }

    const cell = closestGridEditorCell(target);
    const root = closestGridEditorRoot(target);
    const signalText = [
      target.id,
      target.getAttribute("name"),
      String(target.className || ""),
      cssPath(target),
      cell?.id || null,
      String(cell?.className || ""),
      cell ? cssPath(cell) : null,
      root?.id || null,
      String(root?.className || ""),
      root ? cssPath(root) : null
    ].filter(Boolean).join(" ");

    const rowMatch = signalText.match(/gridrow_(\d+)/i);
    const cellMatch = signalText.match(/cell_(\d+)_(\d+)/i);
    const gridMatch = signalText.match(/(?:^|[.\s_-])(grd[_A-Za-z0-9]+)/i);
    const editMatch = signalText.match(/(celledit\d*)/i);
    const attrRowIndex =
      readNumericAttr(target, ["data-row-index"]) ??
      readNumericAttr(cell, ["data-row-index"]);
    const attrColIndex =
      readNumericAttr(target, ["data-col-index"]) ??
      readNumericAttr(cell, ["data-col-index"]);
    const rowIndex = cellMatch ? Number(cellMatch[1]) : attrRowIndex ?? (rowMatch ? Number(rowMatch[1]) : null);
    const colIndex = cellMatch ? Number(cellMatch[2]) : attrColIndex;

    return {
      grid_id: gridMatch ? gridMatch[1] : (root?.id || null),
      row_index: Number.isFinite(rowIndex) ? rowIndex : null,
      col_index: Number.isFinite(colIndex) ? colIndex : null,
      column_id: readStringAttr(target, ["data-column-id", "data-col-id", "data-field"]) || readStringAttr(cell, ["data-column-id", "data-col-id", "data-field"]) || null,
      editor_id: editMatch ? editMatch[1] : null,
      source: "selector_pattern"
    };
  }

  function fallbackGridEditorColumnKey(colIndex) {
    return hasFiniteNumericValue(colIndex) ? `col_${Number(colIndex)}` : null;
  }

  function resolveGridEditorColumnPathFromRoot(root, colIndex, options = {}) {
    if (!(root instanceof Element) || !hasFiniteNumericValue(colIndex)) return [];
    const index = Number(colIndex);
    const roleHeaders = [...root.querySelectorAll("[role='columnheader']")]
      .map((header) => cleanMenuLabel(visibleTextOf(header) || textOf(header) || ""))
      .filter(Boolean);
    if (roleHeaders[index]) return [roleHeaders[index]];

    if (root.matches?.("table")) {
      const tableHeaders = [...root.querySelectorAll(":scope > thead tr:last-child > th, :scope > thead tr:last-child > td")]
        .slice(0, 32)
        .map((header) => cleanMenuLabel(visibleTextOf(header) || textOf(header) || ""))
        .filter((value, headerIndex) => value || headerIndex === index);
      if (tableHeaders[index]) return [tableHeaders[index]];
    }

    const directHeaders = [...root.querySelectorAll(".nexa-grid-head > div")]
      .map((header) => cleanMenuLabel(visibleTextOf(header) || textOf(header) || ""))
      .filter(Boolean);
    if (directHeaders[index]) return [directHeaders[index]];

    if (hasFiniteNumericValue(options.ariaColIndex)) {
      const ariaHeader = root.querySelector?.(`[role='columnheader'][aria-colindex='${Number(options.ariaColIndex)}']`);
      const ariaLabel = cleanMenuLabel(visibleTextOf(ariaHeader) || textOf(ariaHeader) || "");
      if (ariaLabel) return [ariaLabel];
    }

    const genericHeaders = [...root.querySelectorAll(".header,[data-header='true'],[class*='header']")]
      .map((header) => cleanMenuLabel(visibleTextOf(header) || textOf(header) || ""))
      .filter(Boolean);
    if (genericHeaders[index]) return [genericHeaders[index]];

    if (options.columnId) {
      const humanized = humanizeColumnIdentifier(options.columnId);
      if (humanized) return [humanized];
    }

    return [];
  }

  function gridEditorAssociatedLabel(gridContext) {
    const columnPath = normalizePathParts(gridContext?.column_path || null);
    if (columnPath.length > 0) return columnPath.join(" > ");
    return gridContext?.column_label || gridContext?.column_key || null;
  }

  function attachGridEditorInputPayload(payload, gridContext) {
    const basePayload =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? { ...payload }
        : {};
    const associatedLabel = gridEditorAssociatedLabel(gridContext);
    const cellValue =
      gridContext?.cell_value ??
      basePayload.value ??
      null;
    const existingInputContext =
      basePayload.input_context && typeof basePayload.input_context === "object"
        ? { ...basePayload.input_context }
        : {};

    if (cellValue != null && String(cellValue).trim()) {
      basePayload.clicked_value = basePayload.clicked_value ?? cellValue;
    }
    if (associatedLabel) {
      basePayload.clicked_col_label = basePayload.clicked_col_label || associatedLabel;
      basePayload.label = basePayload.label || associatedLabel;
    }

    basePayload.input_context = {
      ...existingInputContext,
      grid_editor: true,
      grid_id: gridContext?.grid_id || null,
      row_index: gridContext?.row_index ?? null,
      col_index: gridContext?.col_index ?? null,
      column_key: gridContext?.column_key || null,
      editor_id: gridContext?.editor_id || null
    };

    return basePayload;
  }

  function resolveGridEditorInputContext(target, event, options = {}) {
    if (!looksLikeGridEditorInput(target)) return null;

    const rawValue = options.value ?? controlValueOf(target);
    const webSquareHints = parseWebSquareEditorHints(target);
    const baseHints = parseGridEditorSelectorHints(target);
    const hints = {
      ...baseHints,
      ...(webSquareHints || {}),
      grid_id: webSquareHints?.grid_id || baseHints.grid_id || null,
      row_index: webSquareHints?.row_index ?? baseHints.row_index ?? null,
      col_index: webSquareHints?.col_index ?? baseHints.col_index ?? null,
      column_id: webSquareHints?.column_id || baseHints.column_id || null,
      editor_id: webSquareHints?.editor_id || baseHints.editor_id || null
    };
    const isWebSquareEditor = Boolean(webSquareHints);
    const directCellTarget = closestGridEditorCell(target);
    const cellTarget = directCellTarget || target.parentElement || target;
    const gridRoot =
      (isWebSquareEditor ? findWebSquareGridRoot(target) : null) ||
      closestGridEditorRoot(target) ||
      gridAdapterRootHint(cellTarget || target);
    const gridResolution = resolveGridContextCandidates(cellTarget, null);
    const gridCandidates = Array.isArray(gridResolution?.candidates) ? gridResolution.candidates : [];
    const bestCandidate = chooseBestGridContextCandidate(gridCandidates);
    const resolvedGridContext = bestCandidate?.normalized
      ? enhanceGridContextWithCandidates(bestCandidate.normalized, gridCandidates)
      : null;
    const recentGridContext = readRecentGridEditContext(target, hints);
    const recentCanReuseColumnIdentity = Boolean(recentGridContext && !recentGridContext.weak_match);
    const recentCanReuseRowIdentity = recentGridContext?.reuse_strength === "same_cell";
    const hasDirectCellAnchor = Boolean(directCellTarget);
    const hasExplicitColumnHint =
      hasFiniteNumericValue(hints.col_index) ||
      Boolean(hints.column_id) ||
      hasFiniteNumericValue(
        readNumericAttr(target, ["aria-colindex"]) ??
        readNumericAttr(directCellTarget, ["aria-colindex"])
      );
    const shouldDowngradeWeakRecentMatch =
      Boolean(recentGridContext?.weak_match) &&
      !hasDirectCellAnchor &&
      !hasExplicitColumnHint;
    const hintColIndex = shouldDowngradeWeakRecentMatch ? null : hints.col_index;
    const allowResolvedColumnIdentity =
      !recentGridContext?.weak_match ||
      hasDirectCellAnchor ||
      hasExplicitColumnHint;
    const preferredWebSquareColumnLabel =
      webSquareHints?.column_label ||
      humanizeColumnIdentifier(webSquareHints?.column_id) ||
      null;
    const rootColumnPath = resolveGridEditorColumnPathFromRoot(gridRoot, hintColIndex, {
      columnId: webSquareHints?.column_id || hints.column_id || null,
      ariaColIndex:
        readNumericAttr(target, ["aria-colindex"]) ??
        readNumericAttr(directCellTarget, ["aria-colindex"])
    });
    const columnPath = normalizePathParts(
      (isWebSquareEditor && preferredWebSquareColumnLabel ? [preferredWebSquareColumnLabel] : null) ||
      (allowResolvedColumnIdentity ? resolvedGridContext?.column_path : null) ||
      rootColumnPath ||
      (recentCanReuseColumnIdentity ? recentGridContext?.column_path : null) ||
      null
    );
    const columnLabel =
      (isWebSquareEditor ? preferredWebSquareColumnLabel : null) ||
      (allowResolvedColumnIdentity ? resolvedGridContext?.column_label : null) ||
      (columnPath.length > 0 ? columnPath[columnPath.length - 1] : null) ||
      (recentCanReuseColumnIdentity ? recentGridContext?.column_label : null) ||
      null;
    const rowIndex =
      resolvedGridContext?.row_index ??
      hints.row_index ??
      (recentCanReuseRowIdentity ? recentGridContext?.row_index : null) ??
      null;
    const colIndex =
      (allowResolvedColumnIdentity ? resolvedGridContext?.col_index : null) ??
      hintColIndex ??
      (recentCanReuseRowIdentity ? recentGridContext?.col_index : null) ??
      null;
    const columnId =
      hints.column_id ||
      (allowResolvedColumnIdentity ? resolvedGridContext?.column_id : null) ||
      (recentCanReuseColumnIdentity ? recentGridContext?.column_id : null) ||
      null;
    const columnKey =
      (isWebSquareEditor ? columnLabel || humanizeColumnIdentifier(columnId) : null) ||
      (allowResolvedColumnIdentity ? resolvedGridContext?.column_key : null) ||
      (recentCanReuseColumnIdentity ? recentGridContext?.column_key : null) ||
      (columnPath.length > 0 ? columnKeyFromPath(columnPath) : null) ||
      fallbackGridEditorColumnKey(colIndex);
    const rowContext =
      resolvedGridContext?.row_context ||
      recentGridContext?.row_context ||
      (hasFiniteNumericValue(rowIndex) ? { row_index: Number(rowIndex) } : null);
    const rowContextMap =
      resolvedGridContext?.row_context_map ||
      rowContext?.map ||
      rowContext?.values ||
      recentGridContext?.row_context_map ||
      null;
    const warnings = normalizeWarningList([
      "grid_editor_input_detected",
      ...(recentGridContext?.reuse_warnings || []),
      ...(resolvedGridContext?.warnings || []),
      ...((columnPath.length === 0 && !columnLabel) ? ["column_label_missing"] : [])
    ]);
    const effectiveColIndex = shouldDowngradeWeakRecentMatch
      ? null
      : toFiniteNumberOrNull(colIndex);
    const effectiveColumnId = shouldDowngradeWeakRecentMatch ? null : (columnId || null);
    const effectiveColumnPath = shouldDowngradeWeakRecentMatch
      ? null
      : (columnPath.length > 0 ? columnPath : null);
    const effectiveColumnLabel = shouldDowngradeWeakRecentMatch ? null : (columnLabel || null);
    const effectiveColumnKey = shouldDowngradeWeakRecentMatch ? null : (columnKey || null);
    const hasColumnIdentity =
      (Array.isArray(effectiveColumnPath) && effectiveColumnPath.length > 0) ||
      (effectiveColumnKey && !/^col_\d+$/i.test(effectiveColumnKey));
    const captureStatus = hasColumnIdentity ? "complete" : "partial";

    return {
      detected: true,
      promoted: captureStatus === "complete",
      candidate_only: captureStatus !== "complete",
      framework: isWebSquareEditor ? "websquare_like_dom" : (resolvedGridContext?.framework || (hints.grid_id ? "nexacro_like_dom" : "generic_grid_editor")),
      source: "grid_editor_input",
      parser: isWebSquareEditor ? "websquare_editor_dom" : (resolvedGridContext?.parser || "grid_editor_input_selector"),
      grid_type: isWebSquareEditor ? "grid" : (resolvedGridContext?.grid_type || "grid"),
      grid_role: resolvedGridContext?.grid_role || "data_grid",
      grid_id:
        (isWebSquareEditor ? (hints.grid_id || normalizeWebSquareGridId(gridRoot?.id || "") || null) : null) ||
        resolvedGridContext?.grid_id ||
        hints.grid_id ||
        recentGridContext?.grid_id ||
        gridRoot?.id ||
        null,
      grid_selector:
        resolvedGridContext?.grid_selector ||
        recentGridContext?.grid_selector ||
        (gridRoot instanceof Element ? cssPath(gridRoot) : null),
      row_index: toFiniteNumberOrNull(rowIndex),
      col_index: effectiveColIndex,
      column_id: effectiveColumnId,
      column_path: effectiveColumnPath,
      column_key: effectiveColumnKey,
      column_label: effectiveColumnLabel,
      column_candidates: resolvedGridContext?.column_candidates || (
        columnPath.length > 0 || columnKey
          ? [{
              path: columnPath.length > 0 ? columnPath : (columnKey ? [columnKey] : []),
              score: columnPath.length > 0 ? 6 : 2,
              selected: true,
              source: columnPath.length > 0 ? "parent_cell_grid" : "indexed_column"
            }]
          : null
      ),
      cell_value: rawValue ?? null,
      raw_value: rawValue ?? null,
      row_context: rowContext,
      row_context_map: rowContextMap,
      confidence: {
        grid: resolvedGridContext?.confidence?.grid ?? ((hints.grid_id || recentGridContext) ? 0.78 : 0.55),
        row_mapping: resolvedGridContext?.confidence?.row_mapping ?? (rowContext ? 0.65 : null),
        column_mapping: resolvedGridContext?.confidence?.column_mapping ?? (hasColumnIdentity ? 0.72 : 0.35),
        cell_value: rawValue != null && String(rawValue).trim() ? 0.98 : 0.2
      },
      capture_status: captureStatus,
      editor_id: hints.editor_id || null,
      warnings
    };
  }

  function enrichInputPayloadWithGridContext(target, event, action, basePayload) {
    const gridContext = resolveGridEditorInputContext(target, event, {
      value: controlValueOf(target),
      action
    });
    return {
      gridContext,
      associatedLabel: gridEditorAssociatedLabel(gridContext),
      payload: gridContext ? attachGridEditorInputPayload(basePayload, gridContext) : basePayload
    };
  }

  function looksLikeEmail(value) {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function looksLikePhone(value) {
    if (typeof value !== "string") return false;
    const digits = value.replace(/\D/g, "");
    return digits.length >= 9 && digits.length <= 12;
  }

  function looksLikeSensitiveToken(value) {
    if (typeof value !== "string") return false;
    const text = value.trim();
    if (!text) return false;
    if (/^Bearer\s+[A-Za-z0-9\-._~+/]+=*$/i.test(text)) return true;
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(text)) return true;
    return /^[A-Za-z0-9+/=_-]{24,}$/.test(text);
  }

  function detectSensitiveKind(value, key, el) {
    const hint = `${String(key || "")} ${fieldHintText(el)}`.toLowerCase();
    if (el && isLoginIdentifierInput(el)) return "identity";
    if (/(stud(?:ent)?[_-]?(?:id|no|nm|name)|birthday|birth[_-]?date|gender|resident|ssn|jumin|person[_-]?(?:id|name)|학번|학생번호|생년|성별|성명|주민|연락처|전화번호)/i.test(hint)) {
      return "identity";
    }
    if (/(password|passwd|pwd|secret|token|bearer|authorization|auth|api[_-]?key|session|cookie|otp|pin)/i.test(hint)) {
      return "secret";
    }
    if (/(email|mail)/i.test(hint)) {
      return "email";
    }
    if (/(phone|mobile|tel|contact)/i.test(hint)) {
      return "phone";
    }
    if (el instanceof HTMLInputElement) {
      if (el.type === "password") return "password";
      if (el.type === "email") return "email";
      if (el.type === "tel") return "phone";
    }
    if (looksLikeEmail(value)) return "email";
    if (looksLikePhone(value)) return "phone";
    if (looksLikeSensitiveToken(value)) return "secret";
    return null;
  }

  function maskEmail(value) {
    const text = String(value || "").trim();
    const [local, domain] = text.split("@");
    if (!local || !domain) return "[REDACTED_EMAIL]";
    return `${local.slice(0, 1)}***@${domain}`;
  }

  function maskPhone(value) {
    const text = String(value || "");
    let visibleDigits = 0;
    return text.split("").reverse().map((char) => {
      if (!/\d/.test(char)) return char;
      visibleDigits += 1;
      return visibleDigits <= 4 ? char : "*";
    }).reverse().join("");
  }

  function maskSensitiveString(value, kind) {
    if (value === null || value === undefined) return value;
    if (kind === "email") return maskEmail(value);
    if (kind === "phone") return maskPhone(value);
    if (kind === "password") return "[MASKED_PASSWORD]";
    if (kind === "identity") return "[IDENTITY_CONTEXT]";
    if (kind === "secret") return "[REDACTED]";
    return "[MASKED]";
  }

  function normalizePolicyKey(key) {
    return String(key || "").trim().toLowerCase();
  }

  function isSafeMetadataKey(key) {
    return SAFE_METADATA_KEYS.has(normalizePolicyKey(key));
  }

  function isSensitiveDataKey(key) {
    return /(password|passwd|pwd|secret|token|authorization|cookie|session|api[_-]?key|request_?body|response_?body|value|pasted_text|input_value|stud(?:ent)?[_-]?(?:id|no|nm|name)|birthday|birth[_-]?date|gender|resident|ssn|jumin|person[_-]?(?:id|name)|학번|학생번호|생년|성별|성명|주민)/i.test(String(key || ""));
  }

  function isSensitiveBodyKey(key) {
    return /(request_?body|response_?body|authorization|cookie|session)/i.test(String(key || ""));
  }

  function shouldApplyValuePatternMasking(key, options = {}) {
    const normalizedKey = normalizePolicyKey(key);
    if (isSafeMetadataKey(normalizedKey)) return false;
    if (options.sensitiveContext) return true;
    if (isSensitiveDataKey(normalizedKey)) return true;
    const element = options.element || null;
    if (element instanceof HTMLInputElement) {
      return element.type === "password" || element.type === "email" || element.type === "tel";
    }
    return false;
  }

  function sanitizeStructuredValue(value, options = {}) {
    const { key = null, element = null, sensitiveContext = false } = options;
    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if ((/body|payload|response/i.test(String(key || ""))) && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try {
          const parsed = JSON.parse(trimmed);
          return JSON.stringify(sanitizeStructuredValue(parsed, {
            ...options,
            sensitiveContext: sensitiveContext || isSensitiveBodyKey(key)
          }));
        } catch {}
      }
      if (isSafeMetadataKey(key)) return value;
      if (!shouldApplyValuePatternMasking(key, { element, sensitiveContext })) return value;
      const sensitiveKind = detectSensitiveKind(value, key, element);
      return sensitiveKind ? maskSensitiveString(value, sensitiveKind) : value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => sanitizeStructuredValue(item, options));
    }

    if (typeof value === "object") {
      const result = {};
      for (const [entryKey, entryValue] of Object.entries(value)) {
        result[entryKey] = sanitizeStructuredValue(entryValue, {
          ...options,
          key: entryKey,
          sensitiveContext: sensitiveContext || isSensitiveBodyKey(entryKey)
        });
      }
      return result;
    }

    return value;
  }

  function sanitizeGridValue(value, fieldKey, element = null) {
    return sanitizeStructuredValue(value, {
      key: String(fieldKey || "cell_value"),
      element
    });
  }

  function sanitizeGridRowData(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(limitObjectEntries(value, MAX_GRID_ROW_FIELDS))
      .map(([key, entryValue]) => [key, sanitizeGridValue(entryValue, key)]));
  }

  function sanitizeGridRowContext(rowContext, rowCandidatePairs = []) {
    if (!rowContext || typeof rowContext !== "object") return rowContext;
    const candidates = Array.isArray(rowContext.candidates) ? rowContext.candidates : [];
    const sourcePairs = [...(Array.isArray(rowCandidatePairs) ? rowCandidatePairs : []), ...candidates];
    const keyForValue = (value) => {
      const match = sourcePairs.find((candidate) =>
        candidate?.key && String(candidate?.value ?? "") === String(value ?? "")
      );
      return match?.key || null;
    };
    const sanitizedPath = Array.isArray(rowContext.row_path)
      ? rowContext.row_path.map((value) => {
          const key = keyForValue(value);
          return key ? sanitizeGridValue(value, key) : "[UNRESOLVED_ROW_VALUE]";
        })
      : rowContext.row_path;
    const sanitizedCandidates = candidates.map((candidate) => ({
      ...candidate,
      value: candidate?.key
        ? sanitizeGridValue(candidate.value, candidate.key)
        : "[UNRESOLVED_ROW_VALUE]"
    }));
    return {
      ...rowContext,
      row_path: sanitizedPath,
      row_label: Array.isArray(sanitizedPath) && sanitizedPath.length > 0 ? sanitizedPath.join(" > ") : null,
      values: sanitizeGridRowData(rowContext.values),
      map: sanitizeGridRowData(rowContext.map),
      row_data: sanitizeGridRowData(rowContext.row_data),
      candidates: sanitizedCandidates
    };
  }

  function sanitizeStructuredGridRow(row) {
    if (!row || typeof row !== "object") return row;
    const sourceCells = Array.isArray(row.cells) ? row.cells : [];
    const cells = sourceCells.map((cell) => ({
      ...cell,
      value: sanitizeGridValue(cell?.value, cell?.label || cell?.column_key || "cell_value")
    }));
    const sanitizedPath = Array.isArray(row.row_path)
      ? row.row_path.map((value) => {
          const sourceCell = sourceCells.find((cell) => String(cell?.value ?? "") === String(value ?? ""));
          return sourceCell
            ? sanitizeGridValue(value, sourceCell.label || sourceCell.column_key || "row_value")
            : "[UNRESOLVED_ROW_VALUE]";
        })
      : row.row_path;
    return {
      ...row,
      row_path: sanitizedPath,
      row_label: Array.isArray(sanitizedPath) && sanitizedPath.length > 0 ? sanitizedPath.join(" > ") : null,
      cells
    };
  }

  function sanitizeGridRowPath(values, gridContext = null) {
    if (!Array.isArray(values)) return values;
    const rowCandidates = [
      ...(Array.isArray(gridContext?.row_candidate_pairs) ? gridContext.row_candidate_pairs : []),
      ...(Array.isArray(gridContext?.row_context?.candidates) ? gridContext.row_context.candidates : [])
    ];
    return values.map((entry) => {
      const match = rowCandidates.find((candidate) =>
        candidate?.key && String(candidate?.value ?? "") === String(entry ?? "")
      );
      return match?.key ? sanitizeGridValue(entry, match.key) : "[UNRESOLVED_ROW_VALUE]";
    });
  }

  function sanitizeGridSnapshotValues(value, fieldKey, element = null, gridContext = null, path = []) {
    if (Array.isArray(value)) {
      return value.map((entry, index) => sanitizeGridSnapshotValues(entry, fieldKey, element, gridContext, [...path, index]));
    }
    if (!value || typeof value !== "object") return value;
    const inExtra = path.includes("extra");
    const clickedRowPath = inExtra && Array.isArray(value.clicked_row_path)
      ? sanitizeGridRowPath(value.clicked_row_path, gridContext)
      : null;
    const rowPath = inExtra && Array.isArray(value.row_path)
      ? sanitizeGridRowPath(value.row_path, gridContext)
      : null;
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => {
      if (/^(?:clicked_?value|cell_value)$/i.test(key)) {
        return [key, sanitizeGridValue(entryValue, fieldKey, element)];
      }
      if (inExtra && key === "clicked_row_path" && clickedRowPath) return [key, clickedRowPath];
      if (inExtra && key === "clicked_row_label" && clickedRowPath) return [key, clickedRowPath.join(" > ") || null];
      if (inExtra && key === "row_path" && rowPath) return [key, rowPath];
      if (inExtra && key === "row_label" && rowPath) return [key, rowPath.join(" > ") || null];
      if (/^(?:row_data|clicked_row)$/i.test(key) && entryValue && typeof entryValue === "object") {
        return [key, sanitizeGridRowData(entryValue)];
      }
      return [key, sanitizeGridSnapshotValues(entryValue, fieldKey, element, gridContext, [...path, key])];
    }));
  }

  function isTrackedUserAction(action) {
    return [
      "click",
      "change",
      "beforeinput",
      "input",
      "focus",
      "blur",
      "keydown",
      "paste",
      "submit",
      "compositionstart",
      "compositionend",
      "canvas_click",
      "grid_cell_click",
      "grid_row_select"
    ].includes(action);
  }

  function actionPriority(text, action) {
    const source = String(text || "").toLowerCase();
    if (/저장|등록|수정|삭제|조회|검색|승인|제출|확인|완료|save|submit|update|delete|search|query|register|apply|confirm|ok/.test(source)) return 10;
    if (action === "submit") return 9;
    if (action === "keydown" && /enter/i.test(source)) return 6;
    if (action === "click") return 5;
    if (action === "change") return 4;
    if (action === "input" || action === "beforeinput") return 2;
    if (action === "focus" || action === "blur" || action === "compositionstart" || action === "compositionend") return 1;
    return 0;
  }

  function rememberUserAction(row) {
    if (!row?.interaction_id || !row?.event_time) return;
    const textHint = row.element_text || row.payload?.value || row.payload?.label || row.payload?.event_context?.action || "";
    recentUserActions.push({
      interactionId: row.interaction_id,
      eventId: row.event_id,
      action: row.action,
      eventTime: row.event_time,
      timeMs: new Date(row.event_time).getTime(),
      text: textHint,
      popupContext: row.payload?.popup_context ? clonePayloadValue(row.payload.popup_context) : null,
      pageUrl: row.page_url || location.href,
      pageSessionId: row.page_session_id || pageSessionId,
      priority: actionPriority(textHint, row.action)
    });
    const cutoff = Date.now() - 10000;
    while (recentUserActions.length > 80 || (recentUserActions[0] && recentUserActions[0].timeMs < cutoff)) {
      recentUserActions.shift();
    }
  }

  function rememberGridEditContext(row) {
    const grid = row?.payload?.grid_context;
    if (!grid?.detected) return;
    lastGridEditContext = {
      savedAt: Date.now(),
      interactionId: row.interaction_id,
      eventId: row.event_id,
      grid_id: grid.grid_id || grid.gridId || null,
      grid_selector: grid.grid_selector || null,
      row_index: grid.row_index ?? grid.clicked_row_index ?? null,
      col_index: grid.col_index ?? grid.clicked_col_index ?? null,
      column_path: normalizePathParts(grid.column_path || null),
      column_key: grid.column_key || null,
      column_label: grid.column_label || null,
      row_context: grid.row_context || null,
      row_context_map: grid.row_context_map || null,
      source_grid_context: grid
    };
  }

  function readRecentGridEditContext(target, hints = {}) {
    if (!lastGridEditContext) return null;
    if ((Date.now() - Number(lastGridEditContext.savedAt || 0)) > GRID_EDIT_CONTEXT_TTL_MS) {
      lastGridEditContext = null;
      return null;
    }

    const targetRoot = closestGridEditorRoot(target);
    const targetRootSelector = targetRoot instanceof Element ? cssPath(targetRoot) : null;
    const sameCell =
      hasFiniteNumericValue(hints.row_index) &&
      hasFiniteNumericValue(hints.col_index) &&
      Number(lastGridEditContext.row_index) === Number(hints.row_index) &&
      Number(lastGridEditContext.col_index) === Number(hints.col_index);
    const sameGridAndColumn =
      hints.grid_id &&
      lastGridEditContext.grid_id &&
      hints.grid_id === lastGridEditContext.grid_id &&
      hasFiniteNumericValue(hints.col_index) &&
      Number(lastGridEditContext.col_index) === Number(hints.col_index);
    const sameGrid =
      hints.grid_id &&
      lastGridEditContext.grid_id &&
      hints.grid_id === lastGridEditContext.grid_id;
    const sameRoot =
      targetRootSelector &&
      lastGridEditContext.grid_selector &&
      targetRootSelector === lastGridEditContext.grid_selector;

    if (!sameCell && !sameGridAndColumn && !sameGrid && !sameRoot) return null;

    const cloned = {
      ...lastGridEditContext,
      column_path: normalizePathParts(lastGridEditContext.column_path),
      row_context: clonePayloadValue(lastGridEditContext.row_context),
      row_context_map: clonePayloadValue(lastGridEditContext.row_context_map),
      source_grid_context: clonePayloadValue(lastGridEditContext.source_grid_context)
    };

    if (sameCell) {
      return {
        ...cloned,
        reuse_strength: "same_cell",
        weak_match: false,
        reuse_warnings: ["grid_context_reused_from_recent_click"]
      };
    }

    if (sameGridAndColumn) {
      const canReuseRowContext =
        hasFiniteNumericValue(hints.row_index) &&
        hasFiniteNumericValue(cloned.row_index) &&
        Number(hints.row_index) === Number(cloned.row_index);
      return {
        ...cloned,
        row_context: canReuseRowContext ? cloned.row_context : null,
        row_context_map: canReuseRowContext ? cloned.row_context_map : null,
        source_grid_context: canReuseRowContext ? cloned.source_grid_context : null,
        reuse_strength: "same_grid_and_column",
        weak_match: false,
        reuse_warnings: ["grid_column_context_reused_from_recent_click"]
      };
    }

    return {
      savedAt: cloned.savedAt,
      interactionId: cloned.interactionId,
      eventId: cloned.eventId,
      grid_id: cloned.grid_id || null,
      grid_selector: cloned.grid_selector || null,
      row_index: null,
      col_index: null,
      column_path: null,
      column_key: null,
      column_label: null,
      row_context: null,
      row_context_map: null,
      source_grid_context: null,
      reuse_strength: sameGrid ? "same_grid" : "same_root",
      weak_match: true,
      reuse_warnings: ["weak_recent_grid_context_match"]
    };
  }

  function findRelatedActionAt(timeMs) {
    const baseTime = Number.isFinite(Number(timeMs)) ? Number(timeMs) : Date.now();
    let best = null;
    let bestScore = -Infinity;
    for (let index = recentUserActions.length - 1; index >= 0; index -= 1) {
      const item = recentUserActions[index];
      const diff = baseTime - item.timeMs;
      if (diff < 0 || diff > 5000) continue;
      const recencyScore = Math.max(0, 5 - (diff / 1000));
      const score = (item.priority || 0) + recencyScore;
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  }

  function resolveRelatedActionReference(timeMs = Date.now(), requestId = null) {
    if (requestId && apiRequestInteractions.has(requestId)) {
      const mapped = apiRequestInteractions.get(requestId) || null;
      return {
        interactionId: mapped?.interactionId || null,
        eventId: mapped?.eventId || null,
        action: mapped?.action || null,
        strategy: mapped?.related_strategy || "request_start_mapping"
      };
    }

    const related = findRelatedActionAt(timeMs);
    if (related?.interactionId) {
      return {
        interactionId: related.interactionId,
        eventId: related.eventId || null,
        action: related.action || null,
        strategy: "recent_action_fallback"
      };
    }

    if (!lastUserAction?.interactionId || !lastUserAction?.eventTime) {
      return {
        interactionId: null,
        eventId: null,
        action: null,
        strategy: "none"
      };
    }

    const elapsedMs = Number(timeMs) - new Date(lastUserAction.eventTime).getTime();
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 10000) {
      return {
        interactionId: null,
        eventId: null,
        action: null,
        strategy: "none"
      };
    }

    return {
      interactionId: lastUserAction.interactionId,
      eventId: lastUserAction.eventId || null,
      action: lastUserAction.action || null,
      strategy: "last_user_action_fallback"
    };
  }

  function resolveRelatedInteractionId(timeMs = Date.now(), requestId = null) {
    return resolveRelatedActionReference(timeMs, requestId)?.interactionId || null;
  }

  function relationContextFromReference(reference, strategyPrefix = "causal") {
    if (!reference?.interactionId) return null;
    return {
      related_interaction_id: reference.interactionId,
      related_event_id: reference.eventId || null,
      related_action: reference.action || null,
      related_strategy: reference.strategy
        ? `${strategyPrefix}_${reference.strategy}`
        : strategyPrefix
    };
  }

  function resolveSubmitRelationReference(timeMs = Date.now()) {
    const related = findRelatedActionAt(timeMs);
    if (!related?.interactionId) return null;
    if (!["click", "keydown", "canvas_click"].includes(related.action)) return null;
    return {
      interactionId: related.interactionId,
      eventId: related.eventId || null,
      action: related.action || null,
      strategy: "recent_action_fallback"
    };
  }

  function rememberApiTransactionLink(row) {
    if (!row?.interaction_id || !row?.event_time) return;
    lastApiTransactionLink = {
      interactionId: row.interaction_id,
      eventId: row.event_id || null,
      action: row.action || "api_transaction",
      eventTime: row.event_time,
      timeMs: new Date(row.event_time).getTime(),
      strategy: "recent_api_transaction"
    };
  }

  function resolveRouteChangeRelationReference(timeMs = Date.now()) {
    const baseTime = Number.isFinite(Number(timeMs)) ? Number(timeMs) : Date.now();
    if (lastApiTransactionLink?.interactionId && Number.isFinite(lastApiTransactionLink.timeMs)) {
      const elapsedMs = baseTime - lastApiTransactionLink.timeMs;
      if (elapsedMs >= 0 && elapsedMs <= CAUSAL_RELATION_TTL_MS) {
        return lastApiTransactionLink;
      }
    }
    const related = findRelatedActionAt(baseTime);
    if (!related?.interactionId) return null;
    return {
      interactionId: related.interactionId,
      eventId: related.eventId || null,
      action: related.action || null,
      strategy: "recent_action_fallback"
    };
  }

  function normalizePathParts(value) {
    if (Array.isArray(value)) {
      return dedupeOrderedParts(value
        .map((part) => String(part || "").trim())
        .filter(Boolean));
    }

    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }

    return [];
  }

  function normalizeMenuPathParts(value) {
    const source = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/\s*(?:>|›|»|→)\s*/)
        : [];
    return source.map((part) => String(part || "").trim()).filter(Boolean);
  }

  function looksRowDimensionHeader(label) {
    return /품종|제품명|품목|품명|상품|제품|코드|code|id|no|번호|이름|name|명칭|거래처|고객|업체|부서|팀|담당자|사용자|메뉴|프로그램/i.test(String(label || ""));
  }

  function looksMeasureHeader(label) {
    return /수량|단가|금액|합계|총계|평균|비율|율|total|sum|amount|price|qty|quantity|count|rate|percent|%/i.test(String(label || ""));
  }

  function scoreRowDimensionCandidate(headerLabel, value, colIndex = 0, clickedColIndex = 999) {
    const text = String(value || "").trim();
    if (!text) return -999;
    let score = 0;
    if (looksRowDimensionHeader(headerLabel)) score += 4;
    if (looksMeasureHeader(headerLabel)) score -= 4;
    if (Number.isFinite(Number(colIndex)) && Number.isFinite(Number(clickedColIndex)) && colIndex < clickedColIndex) score += 2;
    if (!looksNumericLikeText(text)) score += 2;
    if (looksNumericLikeText(text)) score -= 3;
    if (Number.isFinite(Number(colIndex)) && Number(colIndex) <= 1) score += 1;
    if (text.length > 80) score -= 2;
    return score;
  }

  function scoreRowDimensionCandidateDetails({ key, value, colIndex = 0, clickedColIndex = 999, source = null }) {
    const text = String(value || "").trim();
    if (!text) {
      return {
        key: key || null,
        value: text,
        col_index: Number.isFinite(Number(colIndex)) ? Number(colIndex) : null,
        clicked_col_index: Number.isFinite(Number(clickedColIndex)) ? Number(clickedColIndex) : null,
        source: source || null,
        score: -999,
        selected: false,
        reason: ["empty_value"]
      };
    }

    const score = scoreRowDimensionCandidate(key, text, colIndex, clickedColIndex);
    const reasons = [];
    if (looksRowDimensionHeader(key)) reasons.push("dimension_header");
    if (looksMeasureHeader(key)) reasons.push("measure_header");
    if (Number.isFinite(Number(colIndex)) && Number.isFinite(Number(clickedColIndex)) && Number(colIndex) < Number(clickedColIndex)) {
      reasons.push("left_of_clicked_cell");
    }
    if (!looksNumericLikeText(text)) reasons.push("non_numeric");
    if (looksNumericLikeText(text)) reasons.push("numeric_like");
    if (Number.isFinite(Number(colIndex)) && Number(colIndex) <= 1) reasons.push("early_column");
    if (text.length >= 1 && text.length <= 60) reasons.push("reasonable_length");
    if (text.length > 80) reasons.push("too_long");
    if (source) reasons.push(source);

    return {
      key: key || null,
      value: text,
      col_index: Number.isFinite(Number(colIndex)) ? Number(colIndex) : null,
      clicked_col_index: Number.isFinite(Number(clickedColIndex)) ? Number(clickedColIndex) : null,
      source: source || null,
      score,
      selected: score >= 5,
      reason: reasons
    };
  }

  function buildRowContextCandidates({ pairs = [], clickedColIndex = 999 } = {}) {
    return dedupeScoredCandidates(pairs
      .map((pair) => scoreRowDimensionCandidateDetails({
        key: pair?.key ?? null,
        value: pair?.value ?? null,
        colIndex: pair?.colIndex ?? null,
        clickedColIndex,
        source: pair?.source || null
      }))
      .filter((candidate) => candidate && candidate.value && candidate.score > -999), (candidate) =>
      `${candidate.key || ""}|${candidate.value}|${candidate.col_index ?? ""}|${candidate.source || ""}`)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || (a.col_index ?? 999) - (b.col_index ?? 999))
      .slice(0, 8);
  }

  function selectRowContextValues(candidates, existingValues = null) {
    const result = {};
    const confidenceByKey = {};
    for (const candidate of candidates) {
      if (!candidate?.selected || !candidate.key || !candidate.value) continue;
      if (Object.prototype.hasOwnProperty.call(result, candidate.key)) continue;
      result[candidate.key] = candidate.value;
      confidenceByKey[candidate.key] = toConfidenceFromScore(candidate.score, 0, 10);
    }

    const selectedValues = Object.keys(result).length > 0 ? result : (existingValues && typeof existingValues === "object" ? existingValues : null);
    if (!selectedValues) {
      return {
        values: null,
        confidenceByKey: null,
        confidence: null,
        captureStatus: "partial"
      };
    }

    const mergedValues = { ...selectedValues };
    if (!Object.keys(confidenceByKey).length) {
      for (const key of Object.keys(mergedValues)) {
        confidenceByKey[key] = 0.4;
      }
    }

    Object.defineProperty(mergedValues, "__confidence", { value: confidenceByKey, enumerable: false });

    return {
      values: mergedValues,
      confidenceByKey,
      confidence: averageConfidence(Object.values(confidenceByKey)),
      captureStatus: candidates.some((candidate) => candidate.selected) ? "complete" : "partial"
    };
  }

  function buildRowContextMap(rowPath, rowKeys = null, options = {}) {
    const values = normalizePathParts(rowPath);
    if (values.length === 0) return null;
    const keys = Array.isArray(rowKeys) && rowKeys.length > 0
      ? rowKeys.map((key) => String(key || "").trim()).filter(Boolean)
      : [];
    const clickedColIndex = options.clickedColIndex ?? 999;
    const minScore = options.minScore ?? 0;
    const result = {};
    const confidence = {};
    for (let index = 0; index < values.length; index += 1) {
      const key = keys[index] || (values.length === 2 && index === 0 ? "품종" : values.length === 2 && index === 1 ? "제품명" : `row_dim_${index + 1}`);
      const score = scoreRowDimensionCandidate(key, values[index], index, clickedColIndex);
      if (keys.length === 0 || score >= minScore || looksRowDimensionHeader(key)) {
        result[key] = values[index];
        confidence[key] = Math.max(0.35, Math.min(0.98, 0.5 + (score / 10)));
      }
    }
    if (Object.keys(result).length === 0) {
      for (let index = 0; index < values.length; index += 1) {
        const key = keys[index] || `row_dim_${index + 1}`;
        result[key] = values[index];
        confidence[key] = 0.35;
      }
    }
    Object.defineProperty(result, "__confidence", { value: confidence, enumerable: false });
    return Object.keys(result).length > 0 ? result : null;
  }

  function buildStandardRowContext({ rowIndex = null, rowPath = null, rowLabel = null, rowData = null, rowContextMap = null, rowKeys = null } = {}) {
    const normalizedPath = normalizePathParts(rowPath);
    const values = rowContextMap && typeof rowContextMap === "object"
      ? rowContextMap
      : buildRowContextMap(normalizedPath, rowKeys);
    return {
      row_index: Number.isFinite(Number(rowIndex)) ? Number(rowIndex) : null,
      row_path: normalizedPath.length > 0 ? normalizedPath : null,
      row_label: rowLabel || (normalizedPath.join(" > ") || null),
      row_data: rowData ?? null,
      values: values || null,
      map: values || null,
      confidence: values?.__confidence || null
    };
  }

  function enhanceRowContextWithScoring(rowContext, options = {}) {
    if (!rowContext || typeof rowContext !== "object") return null;
    const clickedColIndex = options.clickedColIndex ?? 999;
    const rowPairs = Array.isArray(options.rowPairs)
      ? options.rowPairs
      : normalizePathParts(rowContext.row_path).map((value, index) => ({
          key: rowContext.values ? Object.keys(rowContext.values)[index] : null,
          value,
          colIndex: index,
          source: "existing_row_path"
        }));
    const candidates = buildRowContextCandidates({
      pairs: rowPairs,
      clickedColIndex
    });
    const selected = selectRowContextValues(candidates, rowContext.values || rowContext.map || null);
    const warnings = [];
    if (!selected.values) warnings.push("row_context_unresolved");
    if (candidates.length === 0) warnings.push("row_candidates_missing");

    return {
      ...rowContext,
      values: selected.values || rowContext.values || rowContext.map || null,
      map: selected.values || rowContext.map || rowContext.values || null,
      candidates: limitCandidateList(candidates, MAX_CONTEXT_CANDIDATES),
      confidence: selected.confidence ?? rowContext.confidence ?? null,
      capture_status: selected.captureStatus || "partial",
      warnings
    };
  }

  function menuCandidateScoreToConfidence(score) {
    return toConfidenceFromScore(score, 0, 12);
  }

  function menuCandidateIdentity(candidate) {
    if (!candidate) return "__missing__";
    return [
      candidate.source || "",
      candidate.parser || candidate.tree_parser || "",
      candidate.path_text || candidate.selected_path_text || "",
      candidate.selected_label || ""
    ].join("|");
  }

  function dedupeMenuContextCandidates(candidates) {
    return dedupeScoredCandidates(candidates, (candidate) => menuCandidateIdentity(candidate), (candidate) =>
      Number(candidate?.score || 0));
  }

  function normalizeMenuContextCandidate(candidate) {
    if (!candidate) return null;
    const path = normalizeMenuPathParts(
      candidate.path || candidate.selected_path || candidate.selectedPath || candidate.path_text || candidate.selected_path_text
    );
    const pathText =
      candidate.path_text ||
      candidate.selected_path_text ||
      candidate.pathText ||
      (path.join(" > ") || null);
    const warnings = normalizeWarningList(candidate.warnings);
    const score = Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null;
    const confidence = candidate.confidence != null
      ? clampNumber(candidate.confidence, 0, 0.99)
      : score != null
        ? menuCandidateScoreToConfidence(score)
        : 0.35;

    return {
      detected: path.length > 0 || Boolean(pathText || candidate.selected_label || candidate.label),
      source: candidate.source || "tree",
      parser: candidate.parser || null,
      selected_label: candidate.selected_label || candidate.label || path[path.length - 1] || null,
      path,
      path_text: pathText,
      selected_path: candidate.selected_path || path,
      selected_path_text: candidate.selected_path_text || pathText,
      menu_id: candidate.menu_id || candidate.menuId || null,
      program_id: candidate.program_id || candidate.programId || candidate.pgm_id || candidate.PGM_ID || null,
      call_page: candidate.call_page || candidate.callPage || null,
      top_menu_id: candidate.top_menu_id || candidate.topMenuId || null,
      unit_system_rcd: candidate.unit_system_rcd || candidate.unitSystemRcd || null,
      wrk_ara_rcd: candidate.wrk_ara_rcd || candidate.wrkAraRcd || null,
      depth: candidate.depth || path.length || null,
      menu_kind: candidate.menu_kind || "tree_selection",
      tree_parser: candidate.tree_parser || candidate.parser || null,
      tree_confidence: candidate.tree_confidence ?? candidate.confidence ?? confidence,
      tree_confidence_reasons: candidate.tree_confidence_reasons || candidate.confidenceReasons || null,
      confidence,
      score,
      capture_status: candidate.capture_status || candidate.captureStatus || (confidence >= 0.75 ? "complete" : "partial"),
      warnings
    };
  }

  function chooseBestMenuCandidate(candidates) {
    const ranked = dedupeMenuContextCandidates((Array.isArray(candidates) ? candidates : [])
      .map((candidate) => normalizeMenuContextCandidate(candidate))
      .filter((candidate) => candidate?.detected)
      .sort((a, b) =>
        (Number(b.score || 0) - Number(a.score || 0)) ||
        (Number(b.confidence || 0) - Number(a.confidence || 0)) ||
        (Number(b.depth || 0) - Number(a.depth || 0))
      ));
    return ranked[0] || null;
  }

  function withMenuCandidates(best, candidates) {
    if (!best) return null;
    const rankedCandidates = dedupeMenuContextCandidates((Array.isArray(candidates) ? candidates : [])
      .map((candidate) => normalizeMenuContextCandidate(candidate))
      .filter(Boolean)
      .sort((a, b) =>
        (Number(b.score || 0) - Number(a.score || 0)) ||
        (Number(b.confidence || 0) - Number(a.confidence || 0)) ||
        (Number(b.depth || 0) - Number(a.depth || 0))
      ));
    const bestIdentity = menuCandidateIdentity(best);
    const normalizedCandidates = limitCandidateList(rankedCandidates
      .map((candidate) => ({
        source: candidate.source,
        parser: candidate.parser || candidate.tree_parser || null,
        path: candidate.path,
        path_text: candidate.path_text,
        score: candidate.score ?? null,
        confidence: candidate.confidence,
        selected: menuCandidateIdentity(candidate) === bestIdentity,
        warnings: normalizeWarningList(candidate.warnings)
      })), MAX_CONTEXT_CANDIDATES);

    return {
      ...best,
      warnings: normalizeWarningList(best.warnings || []),
      candidate_warnings: normalizedCandidates
        .filter((candidate) => !candidate.selected && Array.isArray(candidate.warnings) && candidate.warnings.length > 0)
        .map((candidate) => ({
          source: candidate.source,
          path_text: candidate.path_text,
          warnings: candidate.warnings
        })),
      candidates: normalizedCandidates,
    };
  }

  function buildActiveMenuContext(treeContext) {
    if (!treeContext) return null;
    const normalized = normalizeMenuContextCandidate({
      source: treeContext.source || "tree",
      parser: treeContext.parser || "aria_tree",
      label: treeContext.label || null,
      path: treeContext.path || [],
      pathText: treeContext.pathText || null,
      score: treeContext.score ?? 10,
      confidence: treeContext.confidence ?? 0.95,
      depth: treeContext.depth || treeContext.path?.length || null,
      captureStatus: treeContext.captureStatus || "complete",
      confidenceReasons: treeContext.confidenceReasons || ["aria_roles", "dom_hierarchy"],
      warnings: treeContext.warnings || []
    });
    return withMenuCandidates(normalized, [normalized]);
  }

  function updateActiveMenuContext(treeContext) {
    activeMenuContext = buildActiveMenuContext(treeContext);
    return activeMenuContext;
  }

  function resolveNormalizedGridContext(kind, source) {
    if (!source) return null;

    if (kind === "canvas") {
      const hit = source.hit || null;
      const rowContext = buildStandardRowContext({
        rowIndex: hit?.rowIndex ?? null,
        rowData: hit?.rowData ?? null
      });
      const columnPath = normalizePathParts(hit?.colLabel);
      return {
        grid_kind: "canvas",
        grid_parser: "canvas_hit_test",
        grid_region: hit?.region || null,
        row_context: rowContext,
        column_path: columnPath.length > 0 ? columnPath : null,
        column_label: hit?.colLabel || null,
        col_index: hit?.colIndex ?? null,
        col_id: hit?.colId || null,
        cell_value: hit?.clickedValue ?? null
      };
    }

    if (kind === "nexacro") {
      return {
        grid_kind: "nexacro_pivot",
        grid_parser: "nexacro_pivot",
        grid_region: source.band || null,
        cell_region: source.region || null,
        row_context: buildStandardRowContext({
          rowIndex: source.rowIndex,
          rowPath: source.rowPath,
          rowLabel: source.rowLabel,
          rowContextMap: source.rowContextMap || null,
          rowKeys: source.rowContextKeys || null
        }),
        column_path: normalizePathParts(source.colPath).length > 0 ? normalizePathParts(source.colPath) : null,
        column_label: source.colLabel || null,
        col_index: source.colIndex ?? null,
        cell_value: source.clickedValue ?? null
      };
    }

    if (kind === "table") {
      return {
        grid_kind: "html_table",
        grid_parser: "html_table",
        row_context: buildStandardRowContext({
          rowIndex: source.rowIndex,
          rowPath: source.rowPath,
          rowLabel: source.rowLabel,
          rowContextMap: source.rowContextMap || null,
          rowKeys: source.rowContextKeys || null
        }),
        column_path: normalizePathParts(source.colPath).length > 0 ? normalizePathParts(source.colPath) : null,
        column_label: source.colLabel || null,
        col_index: source.colIndex ?? null,
        cell_value: source.clickedValue ?? null
      };
    }

    if (kind === "aria") {
      return {
        grid_kind: "aria_grid",
        grid_parser: source.parser || "aria_grid",
        grid_confidence: source.confidence ?? null,
        grid_confidence_reasons: source.confidenceReasons || null,
        capture_status: source.captureStatus || null,
        row_context: buildStandardRowContext({
          rowIndex: source.rowIndex,
          rowPath: source.rowPath,
          rowLabel: source.rowLabel,
          rowContextMap: source.rowContextMap || null
        }),
        column_path: normalizePathParts(source.colPath).length > 0 ? normalizePathParts(source.colPath) : null,
        column_label: source.colLabel || null,
        col_index: source.colIndex ?? null,
        cell_value: source.clickedValue ?? null
      };
    }

    if (kind === "generic") {
      return {
        grid_kind: "generic_grid",
        grid_parser: source.parser || "generic_dom_grid",
        grid_confidence: source.confidence ?? null,
        grid_confidence_reasons: source.confidenceReasons || null,
        capture_status: source.captureStatus || null,
        row_context: buildStandardRowContext({
          rowIndex: source.rowIndex,
          rowPath: source.rowPath,
          rowLabel: source.rowLabel,
          rowContextMap: source.rowContextMap || null,
          rowKeys: source.rowContextKeys || null
        }),
        column_path: normalizePathParts(source.colPath).length > 0 ? normalizePathParts(source.colPath) : null,
        column_label: source.colLabel || null,
        col_index: source.colIndex ?? null,
        cell_value: source.clickedValue ?? null
      };
    }

    if (kind === "adapter") {
      return {
        ...source,
        grid_kind: source.grid_kind || `${source.framework || source.adapter_name || "adapter"}_grid`,
        grid_parser: source.grid_parser || source.parser || `${source.framework || source.adapter_name || "adapter"}_adapter`
      };
    }

    return null;
  }


  function columnKeyFromPath(columnPath) {
    const parts = normalizePathParts(columnPath);
    return parts.length > 0 ? parts.join(".") : null;
  }

  function enrichMenuContext(context) {
    if (!context) return null;
    const path = normalizeMenuPathParts(context.path || context.selected_path || context.path_text || context.selected_path_text);
    const pathText = context.path_text || context.selected_path_text || context.pathText || path.join(" > ") || null;
    return {
      ...context,
      detected: path.length > 0 || Boolean(pathText || context.selected_label),
      path,
      path_text: pathText,
      depth: path.length || context.depth || null,
      selected_path: context.selected_path || path,
      selected_path_text: context.selected_path_text || pathText
    };
  }

  function normalizeCprMenuPathParts(value) {
    if (Array.isArray(value)) {
      return value.flatMap((part) => normalizeCprMenuPathParts(part));
    }
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/\s*(?:>|›|»)\s*/)
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [];
  }

  function normalizeCprMenuContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const path = normalizeCprMenuPathParts(value.path || value.selected_path || value.path_text || value.selected_path_text);
    const pathText = value.path_text || value.selected_path_text || path.join(" > ") || null;
    if (!pathText && !value.selected_label) return null;
    return normalizeMenuContextCandidate({
      ...value,
      source: value.source || "cpr_runtime",
      parser: value.parser || "cpr_dsAllMenu_mdi",
      path,
      path_text: pathText,
      selected_path: value.selected_path || path,
      selected_path_text: value.selected_path_text || pathText,
      selected_label: value.selected_label || path[path.length - 1] || value.menu_name || null,
      score: value.score ?? 12,
      confidence: value.confidence ?? 0.95,
      captureStatus: value.capture_status || value.captureStatus || "complete",
      warnings: value.warnings || []
    });
  }

  function setActiveCprMenuContext(value) {
    const normalized = normalizeCprMenuContext(value);
    if (!normalized) return null;
    activeCprMenuContext = normalized;
    activeCprMenuContextUpdatedAt = Date.now();
    return activeCprMenuContext;
  }

  function currentActiveCprMenuContext() {
    if (!activeCprMenuContext) return null;
    if (Date.now() - activeCprMenuContextUpdatedAt > CPR_MENU_CONTEXT_TTL_MS) return null;
    return activeCprMenuContext;
  }

  function requestCprMenuContext(reason = "manual", detail = {}) {
    const requestId = `cpr-menu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    requestMainWorldState("cpr_context", requestId, {
      reason,
      page_url: location.href,
      page_title: document.title,
      ...detail
    });
  }

  function scheduleCprMenuContextRefresh(reason = "scheduled", detail = {}) {
    if (cprMenuContextRefreshTimer) clearTimeout(cprMenuContextRefreshTimer);
    cprMenuContextRefreshTimer = setTimeout(() => {
      cprMenuContextRefreshTimer = null;
      requestCprMenuContext(reason, detail);
    }, CPR_MENU_CONTEXT_REFRESH_DEBOUNCE_MS);
  }

  function navLabelOf(el) {
    if (!(el instanceof Element)) return null;
    return extractMenuItemLabel(el) || visibleTextOf(el) || textOf(el);
  }

  function shouldUseMenuLabel(label) {
    const text = cleanMenuLabel(label || "");
    if (!text) return false;
    if (text.length > 80) return false;
    if (/^(navigation|sidebar|menu|nav|lnb|breadcrumb)$/i.test(text)) return false;
    return true;
  }

  function closestMenuSectionLabel(active, root) {
    if (!(active instanceof Element) || !(root instanceof Element)) return null;
    const headingSelector = ".menu-title, .menu-section, .group-title, .nav-title, .section-title, .accordion-title, strong, h1, h2, h3, h4, h5, h6, summary";
    let current = active.parentElement;
    while (current && current !== root) {
      const heading = current.querySelector(`:scope > ${headingSelector.replace(/, /g, ", :scope > ")}`);
      const label = shouldUseMenuLabel(navLabelOf(heading)) ? cleanMenuLabel(navLabelOf(heading)) : null;
      if (label) return label;
      current = current.parentElement;
    }
    const rootLabel = root.getAttribute("aria-label") || root.getAttribute("title") || root.getAttribute("data-label") || null;
    return shouldUseMenuLabel(rootLabel) ? cleanMenuLabel(rootLabel) : null;
  }

  function buildSidebarMenuPath(root, active) {
    if (!(root instanceof Element) || !(active instanceof Element)) return [];
    const labels = [];
    const pushLabel = (label) => {
      const cleaned = cleanMenuLabel(label || "");
      if (!shouldUseMenuLabel(cleaned)) return;
      labels.push(cleaned);
    };

    const ancestorItems = [];
    let current = active.parentElement?.closest?.("li, .menu-item, .tree-item, .folder-item, .menu-node, .folder-node, .tree-node, [role='menuitem'], [role='treeitem']") || null;
    while (current && current !== root && ancestorItems.length < 2) {
      const label = navLabelOf(current);
      if (shouldUseMenuLabel(label)) ancestorItems.unshift(cleanMenuLabel(label));
      current = current.parentElement?.closest?.("li, .menu-item, .tree-item, .folder-item, .menu-node, .folder-node, .tree-node, [role='menuitem'], [role='treeitem']") || null;
    }

    const sectionLabel = closestMenuSectionLabel(active, root);
    pushLabel(sectionLabel);
    for (const label of ancestorItems) pushLabel(label);
    pushLabel(navLabelOf(active));

    return dedupeOrderedParts(labels).slice(-4);
  }

  function mergeMenuPaths(leftPath, rightPath) {
    const left = normalizeMenuPathParts(leftPath);
    const right = normalizeMenuPathParts(rightPath);
    let overlap = Math.min(left.length, right.length);
    while (overlap > 0) {
      const suffix = left.slice(left.length - overlap);
      const prefix = right.slice(0, overlap);
      if (suffix.every((part, index) => part === prefix[index])) break;
      overlap -= 1;
    }
    return [...left, ...right.slice(overlap)].slice(-6);
  }

  function resolveBreadcrumbMenuCandidate(options = {}) {
    const root = options.root instanceof Element
      ? options.root
      : document.querySelector("[aria-label*='breadcrumb' i], nav.breadcrumb, .breadcrumb, [class*='breadcrumb']");
    if (!(root instanceof Element)) return null;
    const items = [...root.querySelectorAll("[aria-current='page'], .breadcrumb-item, li, a, button, span")]
      .filter((item) => item instanceof Element && !isElementVisuallyHidden(item))
      .map((item) => navLabelOf(item))
      .map((label) => String(label || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const path = dedupeOrderedParts(items);
    if (path.length === 0) return null;
    const warnings = [];
    if (path.length === 1) warnings.push("single_breadcrumb_segment");
    return {
      source: "breadcrumb",
      parser: "breadcrumb_dom",
      path,
      selected_label: path[path.length - 1],
      score: path.length > 1 ? 8 : 4,
      confidence: path.length > 1 ? 0.82 : 0.58,
      captureStatus: path.length > 1 ? "complete" : "partial",
      warnings
    };
  }

  function sidebarActiveSelector() {
    return [
      "[aria-current='page']",
      "[aria-selected='true']",
      ".active",
      ".selected",
      ".current",
      ".on",
      ".is-active",
      ".router-link-active"
    ].join(",");
  }

  function collectSidebarRoots(target, options = {}) {
    const roots = [];
    const rootSelector = "aside, nav, [role='navigation'], [class*='sidebar'], [class*='side-menu'], [class*='lnb'], [class*='menu']";
    if (target instanceof Element) {
      const nearby = target.closest(rootSelector);
      if (nearby) roots.push(nearby);
    }
    if (options.allowGlobal !== false) {
      roots.push(...document.querySelectorAll(rootSelector));
    }
    return [...new Set(roots)].filter((root) => root instanceof Element).slice(0, 8);
  }

  function looksLikeUtilityNavRoot(root) {
    if (!(root instanceof Element)) return false;
    const hint = [
      root.id,
      root.className,
      root.getAttribute("aria-label"),
      root.getAttribute("title")
    ].filter(Boolean).join(" ").toLowerCase();
    return /(header|global|utility|top|toolbar|gnb|user[-_\s]?menu|quick[-_\s]?menu)/i.test(hint);
  }

  function scoreSidebarMenuCandidate({ root, active, target, path }) {
    const normalizedPath = normalizePathParts(path);
    const activeLabel = cleanMenuLabel(navLabelOf(active) || "");
    const rootHint = [
      root?.id,
      root?.className,
      root?.getAttribute?.("aria-label"),
      root?.getAttribute?.("title")
    ].filter(Boolean).join(" ").toLowerCase();
    const warnings = [];
    let score = 0;

    if (target instanceof Element && root instanceof Element && root.contains(target)) score += 5;
    if (active instanceof Element) score += 4;
    if (normalizedPath.length >= 2) score += 3;
    if (root instanceof Element && root.matches("aside, [class*='sidebar'], [class*='side-menu'], [class*='lnb']")) score += 2;
    if (active instanceof Element && active.matches("[aria-current='page'], [aria-selected='true']")) score += 2;
    if (root instanceof Element && (root.getAttribute("aria-label") || root.getAttribute("title"))) score += 1;
    if (normalizedPath.length <= 1) {
      score -= 2;
      warnings.push("single_sidebar_label");
    }
    if (looksLikeUtilityNavRoot(root) || /(header|global|utility|top|toolbar|gnb)/i.test(rootHint)) {
      score -= 2;
      warnings.push("utility_nav_suspected");
    }
    if (/^(home|menu|nav|more|list)$/i.test(activeLabel)) {
      score -= 2;
      warnings.push("generic_active_label");
    }
    const textLength = String(root?.textContent || "").replace(/\s+/g, " ").trim().length;
    if (textLength > 800) score -= 3;

    return {
      score,
      confidence: menuCandidateScoreToConfidence(score),
      warnings: normalizeWarningList(warnings)
    };
  }

  function buildSidebarCandidateFromRoot(root, target) {
    if (!(root instanceof Element)) return null;
    const active = root.querySelector(sidebarActiveSelector());
    if (!(active instanceof Element) || isElementVisuallyHidden(active)) return null;
    const path = buildSidebarMenuPath(root, active);
    if (path.length === 0) return null;
    const scored = scoreSidebarMenuCandidate({ root, active, target, path });
    return {
      source: root.matches("nav,[role='navigation']") ? "nav" : "sidebar",
      parser: "sidebar_active_dom",
      path,
      selected_label: path[path.length - 1],
      score: scored.score,
      confidence: scored.confidence,
      captureStatus: path.length >= 2 ? "complete" : "partial",
      warnings: scored.warnings
    };
  }

  function resolveSidebarMenuCandidates(target, options = {}) {
    return dedupeMenuContextCandidates(collectSidebarRoots(target, options)
      .map((root) => buildSidebarCandidateFromRoot(root, target))
      .filter(Boolean))
      .sort((a, b) =>
        (Number(b.score || 0) - Number(a.score || 0)) ||
        (Number(b.confidence || 0) - Number(a.confidence || 0)) ||
        (Number((b.path || []).length || 0) - Number((a.path || []).length || 0)))
      .slice(0, MAX_CONTEXT_CANDIDATES);
  }

  function resolveSidebarMenuCandidate(target, options = {}) {
    return resolveSidebarMenuCandidates(target, options)[0] || null;
  }

  function resolveTabMenuCandidate(target, options = {}) {
    const root = (target instanceof Element
      ? target.closest("[role='tablist'], .tabs, .tablist")
      : null) || (options.allowGlobal !== false ? document.querySelector("[role='tablist'], .tabs, .tablist") : null);
    if (!(root instanceof Element)) return null;
    const active = root.querySelector("[role='tab'][aria-selected='true'], .tab.active, .tab.is-active, [class*='tab'].active");
    if (!(active instanceof Element)) return null;
    const label = navLabelOf(active);
    const path = normalizePathParts(label);
    if (path.length === 0) return null;
    return {
      source: "tab",
      parser: "tablist_dom",
      path,
      selected_label: path[path.length - 1],
      score: 5,
      confidence: 0.62,
      captureStatus: "partial",
      warnings: ["tab_context_only"]
    };
  }

  function resolveUrlTitleMenuCandidate() {
    const pathSegments = location.pathname.split("/").map((segment) => decodeURIComponent(segment || "").trim()).filter(Boolean);
    if (pathSegments.length > 0) {
      return {
        source: "url",
        parser: "location_path",
        path: pathSegments.slice(-4),
        selected_label: pathSegments[pathSegments.length - 1],
        score: 2,
        confidence: 0.42,
        captureStatus: "partial",
        warnings: ["url_fallback"],
        fallbackOnly: true
      };
    }
    const titlePath = normalizePathParts(document.title);
    return titlePath.length > 0 ? {
      source: "title",
      parser: "document_title",
      path: titlePath,
      selected_label: titlePath[titlePath.length - 1],
      score: 1,
      confidence: 0.35,
      captureStatus: "partial",
      warnings: ["title_fallback"],
      fallbackOnly: true
    } : null;
  }

  function resolveTreeMenuCandidate(target) {
    const treeContext = resolveTreePath(target);
    if (!treeContext) return null;
    const warnings = [];
    if ((treeContext.path?.length || 0) <= 1) warnings.push("shallow_tree_path");
    return {
      source: "tree",
      parser: treeContext.parser || "aria_tree",
      path: treeContext.path,
      pathText: treeContext.pathText,
      label: treeContext.label,
      selected_label: treeContext.label,
      score: treeContext.parser === "aria_tree" ? 10 : 9,
      confidence: treeContext.confidence ?? (treeContext.parser === "aria_tree" ? 0.95 : 0.82),
      captureStatus: treeContext.captureStatus || "complete",
      confidenceReasons: treeContext.confidenceReasons || null,
      warnings
    };
  }

  function menuPathsCompatible(left, right) {
    const a = normalizeMenuPathParts(left?.path || left?.selected_path || left?.path_text || left?.selected_path_text);
    const b = normalizeMenuPathParts(right?.path || right?.selected_path || right?.path_text || right?.selected_path_text);
    if (!a.length || !b.length) return false;
    if (a[a.length - 1] === b[b.length - 1]) return true;
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    return short.every((part, index) =>
      part === long[long.length - short.length + index]);
  }

  function cprMenuCandidateScore(context) {
    if (!activeMenuContext?.selected_path_text) return 12;
    if (!menuPathsCompatible(activeMenuContext, context)) return 7;
    const activeDepth = normalizeMenuPathParts(activeMenuContext.path || activeMenuContext.selected_path).length;
    const cprDepth = normalizeMenuPathParts(context?.path || context?.selected_path).length;
    return cprDepth > activeDepth ? 12 : 10;
  }

  function chooseActiveAndCprMenuContext(context) {
    const candidates = [];
    if (activeMenuContext?.selected_path_text) {
      candidates.push({ ...activeMenuContext, score: 11 });
    }
    if (context?.selected_path_text || context?.path_text) {
      const score = cprMenuCandidateScore(context);
      candidates.push({
        ...context,
        score,
        warnings: normalizeWarningList([
          ...(context.warnings || []),
          ...(score < 12 ? ["cpr_active_path_conflict"] : [])
        ])
      });
    }
    const best = chooseBestMenuCandidate(candidates);
    return best ? withMenuCandidates(best, candidates) : null;
  }

  function resolveMenuContextCandidates(target) {
    const candidates = [];
    const allowGlobalFallback = !(target instanceof Element && isInputLikeElement(target));
    if (activeMenuContext?.selected_path_text) {
      candidates.push({
        ...activeMenuContext,
        score: 11,
        warnings: activeMenuContext.warnings || []
      });
    }
    const cprMenuContext = currentActiveCprMenuContext();
    if (cprMenuContext?.selected_path_text) {
      const score = cprMenuCandidateScore(cprMenuContext);
      candidates.push({
        ...cprMenuContext,
        score,
        warnings: normalizeWarningList([
          ...(cprMenuContext.warnings || []),
          ...(score < 12 ? ["cpr_active_path_conflict"] : [])
        ])
      });
    }
    const treeCandidate = resolveTreeMenuCandidate(target);
    if (treeCandidate) candidates.push(treeCandidate);
    const sidebarCandidates = resolveSidebarMenuCandidates(target, { allowGlobal: allowGlobalFallback });
    if (sidebarCandidates.length > 0) candidates.push(...sidebarCandidates);
    const sidebarCandidate = sidebarCandidates[0] || null;
    const breadcrumbRoot = target instanceof Element ? target.closest("[aria-label*='breadcrumb' i], nav.breadcrumb, .breadcrumb, [class*='breadcrumb']") : null;
    const breadcrumbCandidate = allowGlobalFallback || breadcrumbRoot ? resolveBreadcrumbMenuCandidate({ root: breadcrumbRoot || null }) : null;
    if (breadcrumbCandidate) candidates.push(breadcrumbCandidate);
    if (breadcrumbCandidate && sidebarCandidate) {
      const mergedPath = mergeMenuPaths(breadcrumbCandidate.path, [sidebarCandidate.selected_label || sidebarCandidate.path?.slice(-1)?.[0]]);
      if (mergedPath.length > 0) {
        candidates.push({
          source: "breadcrumb_sidebar_merged",
          parser: "breadcrumb_sidebar_merged",
          path: mergedPath,
          selected_label: mergedPath[mergedPath.length - 1],
          score: Math.min(9, Math.max(Number(breadcrumbCandidate.score || 0), Number(sidebarCandidate.score || 0)) + 1),
          confidence: 0.8,
          captureStatus: mergedPath.length >= 2 ? "complete" : "partial",
          warnings: mergedPath.length <= 1 ? ["shallow_merged_path"] : []
        });
      }
    }
    const tabCandidate = resolveTabMenuCandidate(target, { allowGlobal: allowGlobalFallback });
    if (tabCandidate) candidates.push(tabCandidate);
    const urlTitleCandidate = resolveUrlTitleMenuCandidate();
    if (urlTitleCandidate) candidates.push(urlTitleCandidate);
    return dedupeMenuContextCandidates(candidates).slice(0, 8);
  }

  function inferGenericNavigationContext(target) {
    return chooseBestMenuCandidate(resolveMenuContextCandidates(target));
  }

  function resolveCurrentMenuContext(target) {
    const candidates = resolveMenuContextCandidates(target);
    const best = chooseBestMenuCandidate(candidates);
    return best ? withMenuCandidates(best, candidates) : null;
  }

  function resolveEffectiveMenuContext(target) {
    return resolveCurrentMenuContext(target);
  }

  function resetActiveMenuContext(reason = "manual_reset") {
    activeCprDomMenuPath = [];
    activeCprTopMenuPath = [];
    if (!activeMenuContext) return false;
    activeMenuContext = null;
    return true;
  }

  function gridTypeFromKind(kind) {
    if (!kind) return null;
    if (/pivot/i.test(kind)) return "pivot";
    if (/table/i.test(kind)) return "table";
    if (/canvas/i.test(kind)) return "canvas_grid";
    if (/treegrid/i.test(kind)) return "treegrid";
    return "grid";
  }

  function frameworkFromGridKind(kind) {
    if (!kind) return null;
    if (/nexacro/i.test(kind)) return "nexacro";
    if (/websquare/i.test(kind)) return "websquare";
    if (/html_table/i.test(kind)) return "html_table";
    if (/generic/i.test(kind)) return "generic_dom";
    if (/aria/i.test(kind)) return "aria_grid";
    if (/canvas/i.test(kind)) return "canvas";
    return null;
  }

  function enrichGridContext(context) {
    if (!context) return null;
    const columnPath = normalizePathParts(context.column_path || context.col_path);
    const rowContextValues = context.row_context?.values || context.row_context?.map || context.row_context_map || null;
    const enriched = {
      ...context,
      detected: true,
      promoted: context.promoted ?? true,
      candidate_only: context.candidate_only ?? false,
      grid_role: context.grid_role || "data_grid",
      framework: context.framework || frameworkFromGridKind(context.grid_kind),
      grid_type: context.grid_type || gridTypeFromKind(context.grid_kind),
      row_index: context.row_index ?? context.row_context?.row_index ?? null,
      col_index: context.col_index ?? context.colIndex ?? context.col_index ?? null,
      row_context_map: rowContextValues,
      column_path: columnPath.length > 0 ? columnPath : null,
      column_key: context.column_key || columnKeyFromPath(columnPath),
      cell_value: context.cell_value ?? context.clicked_value ?? null
    };
    const fieldKey = enriched.column_key || enriched.column_label || enriched.column_id || "cell_value";
    enriched.cell_value = sanitizeGridValue(enriched.cell_value, fieldKey, context.cell || null);
    if (Object.prototype.hasOwnProperty.call(enriched, "clicked_value")) {
      enriched.clicked_value = sanitizeGridValue(enriched.clicked_value, fieldKey, context.cell || null);
    }
    enriched.row_context_map = sanitizeGridRowData(enriched.row_context_map);
    enriched.row_context = sanitizeGridRowContext(enriched.row_context, enriched.row_candidate_pairs);
    if (Array.isArray(enriched.row_candidate_pairs)) {
      enriched.row_candidate_pairs = enriched.row_candidate_pairs.map((pair) => ({
        ...pair,
        value: sanitizeGridValue(pair?.value, pair?.key || "row_value")
      }));
    }
    return enriched;
  }

  function gridRowDataFromContext(context) {
    if (!context || typeof context !== "object") return null;
    const rowContext = context.row_context && typeof context.row_context === "object"
      ? context.row_context
      : {};
    const value =
      rowContext.row_data ||
      rowContext.map ||
      rowContext.values ||
      context.row_context_map ||
      null;
    return value && typeof value === "object" && !Array.isArray(value)
      ? sanitizeGridRowData(value)
      : value;
  }

  function gridHeadersFromContext(context) {
    if (!context || typeof context !== "object") return null;
    if (Array.isArray(context.headers) && context.headers.length > 0) {
      return context.headers.slice(0, 40);
    }
    const headers = [];
    const addHeader = (value) => {
      const text = cleanMenuLabel(value || "");
      if (text && !headers.includes(text)) headers.push(text);
    };
    if (Array.isArray(context.column_candidates)) {
      for (const candidate of context.column_candidates) {
        if (Array.isArray(candidate?.path)) {
          addHeader(candidate.path[candidate.path.length - 1]);
        }
        addHeader(candidate?.label || candidate?.column_label || candidate?.key);
      }
    }
    addHeader(context.column_label || context.column_key || context.column_id);
    return headers.length > 0 ? headers.slice(0, 40) : null;
  }

  function buildGridCellInteractionPayload(gridContext, options = {}) {
    const context = enrichGridContext(gridContext);
    if (!context) return null;
    const rowData = gridRowDataFromContext(context);
    const rowIndex = context.row_index ?? context.row_context?.row_index ?? null;
      const colIndex = context.col_index ?? null;
      const modelColIndex = context.model_col_index ?? null;
    const columnLabel = context.column_label || null;
    const columnKey = context.column_key || context.column_id || columnLabel || null;
    const cellValue = sanitizeGridValue(
      context.cell_value ?? null,
      columnKey || columnLabel || "cell_value",
      context.cell || null
    );
    return {
      kind: options.kind || "grid_cell_click",
      source: options.source || context.source || context.parser || null,
      framework: context.framework || null,
      capture_status: context.capture_status || null,
      grid_id: context.grid_id || context.component_id || null,
      dataset_id: context.dataset_id || null,
      component_id: context.component_id || null,
        row_index: rowIndex,
        col_index: colIndex,
        model_col_index: modelColIndex,
      column_key: columnKey,
      column_id: context.column_id || null,
      column_label: columnLabel,
      cell_value: cellValue,
      clicked_col_label: columnLabel || columnKey,
      clicked_value: cellValue,
      label: columnLabel || columnKey,
      row_data: rowData || null,
      selected_row: rowData ? {
        row_index: rowIndex,
        row_data: rowData
      } : null,
      headers: gridHeadersFromContext(context),
      related_interaction_id: options.relatedInteractionId || null,
      related_event_id: options.relatedEventId || null,
      original_interaction_id: options.originalInteractionId || null,
      original_event_id: options.originalEventId || null
    };
  }

  function looksLikeLayoutTable(table) {
    const score = scoreTableAsDataGrid(table);
    return score < 3;
  }

  function firstRowLooksHeader(table) {
    if (!(table instanceof HTMLTableElement)) return false;
    const firstRow = table.querySelector("tr");
    if (!(firstRow instanceof HTMLTableRowElement)) return false;
    if (firstRow.querySelector("th")) return true;
    const cells = [...firstRow.children].filter((cell) => cell instanceof HTMLTableCellElement);
    if (cells.length < 2) return false;
    const shortTextCount = cells
      .map((cell) => cleanMenuLabel(visibleTextOf(cell) || textOf(cell) || ""))
      .filter(Boolean)
      .filter((value) => value.length <= 40 && !looksNumericLikeText(value)).length;
    return shortTextCount >= Math.max(2, Math.ceil(cells.length * 0.6));
  }

  function repeatedTableColumnStructureScore(rows) {
    const signatureCounts = new Map();
    for (const row of rows) {
      const signature = [...row.children].map((cell) => cell.tagName).join("|");
      signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
    }
    return Math.max(0, ...signatureCounts.values());
  }

  function labelInputRowCount(rows) {
    let count = 0;
    for (const row of rows) {
      const cells = [...row.children].filter((cell) => cell instanceof HTMLTableCellElement);
      if (cells.length < 2) continue;
      const firstText = cleanMenuLabel(visibleTextOf(cells[0]) || textOf(cells[0]) || "");
      const inputLikeCount = cells.filter((cell) => cell.querySelector("input, select, textarea")).length;
      if (firstText && firstText.length <= 30 && inputLikeCount >= Math.max(1, cells.length - 1)) {
        count += 1;
      }
    }
    return count;
  }

  function countTableControls(table) {
    if (!(table instanceof HTMLTableElement)) {
      return {
        formControlCount: 0,
        buttonCount: 0,
        linkButtonCount: 0
      };
    }
    return {
      formControlCount: table.querySelectorAll("input, select, textarea").length,
      buttonCount: table.querySelectorAll("button, a[role='button'], [role='button'], .btn").length,
      linkButtonCount: table.querySelectorAll("a, [role='button']").length
    };
  }

  function looksLikeActionColumnHeader(label) {
    return /상세|보기|수정|삭제|선택|관리|작업|처리|action|view|edit|delete|select|manage|operation/i.test(String(label || ""));
  }

  function scoreActionHeavyDataTable(table, rows, columnCount) {
    if (!(table instanceof HTMLTableElement)) return 0;
    const headerLabels = [...table.querySelectorAll("thead th, tr:first-child th, tr:first-child td")]
      .map((cell) => cleanMenuLabel(visibleTextOf(cell) || textOf(cell) || ""))
      .filter(Boolean);
    const controlCounts = countTableControls(table);
    let score = 0;
    if (controlCounts.buttonCount > 0 && rows.length >= 2) score += 2;
    if (headerLabels.some((label) => looksLikeActionColumnHeader(label))) score += 2;
    if (controlCounts.buttonCount >= Math.max(2, rows.length) && columnCount >= 3) score += 1;
    return score;
  }

  function scoreTableAsDataGrid(table, clickedCell = null) {
    if (!(table instanceof HTMLTableElement)) return 0;
    const rows = [...table.querySelectorAll("tr")];
    const bodyRows = [...table.querySelectorAll("tbody tr")];
    const effectiveBodyRows = bodyRows.length > 0 ? bodyRows : rows.slice(table.querySelectorAll("thead tr").length || 0);
    const columnCount = Math.max(...rows.map((row) => row.children.length), 0);
    const headerCount = table.querySelectorAll("thead th, tr > th").length;
    const controlCounts = countTableControls(table);
    const cells = [...table.querySelectorAll("td, th")];
    const numericCells = cells
      .map((cell) => visibleTextOf(cell) || textOf(cell))
      .filter(Boolean)
      .filter((value) => looksNumericLikeText(value)).length;
    const textCells = cells
      .map((cell) => cleanMenuLabel(visibleTextOf(cell) || textOf(cell) || ""))
      .filter(Boolean).length;
    const captionLike = Boolean(table.querySelector("caption")) || Boolean(table.getAttribute("aria-label"));
    const repeatedStructure = repeatedTableColumnStructureScore(rows);
    const labelInputRows = labelInputRowCount(rows);
    const actionHeavyScore = scoreActionHeavyDataTable(table, effectiveBodyRows, columnCount);
    let score = 0;
    if (headerCount > 0) score += 4;
    if (effectiveBodyRows.length >= 2) score += 3;
    if (columnCount >= 2) score += 2;
    if (clickedCell instanceof HTMLTableCellElement) score += 2;
    if (firstRowLooksHeader(table)) score += 2;
    if (numericCells >= 2 || textCells >= Math.max(4, columnCount * 2)) score += 1;
    if (captionLike) score += 1;
    if (repeatedStructure >= 2) score += 1;
    score += actionHeavyScore;
    if (controlCounts.formControlCount >= Math.max(2, Math.ceil(cells.length * 0.35))) score -= 4;
    if (labelInputRows >= Math.max(1, Math.ceil(rows.length * 0.5))) score -= 3;
    if (effectiveBodyRows.length <= 1) score -= 2;
    if (columnCount <= 1) score -= 2;
    if (headerCount === 0 && !firstRowLooksHeader(table) && repeatedStructure < 2) score -= 2;
    return score;
  }

  function classifyTableGridRole(table, clickedCell = null) {
    const score = scoreTableAsDataGrid(table, clickedCell);
    if (score >= 5) {
      return {
        score,
        promoted: true,
        candidate_only: false,
        grid_role: "data_grid",
        capture_status: "complete",
        confidence: 0.84,
        warnings: []
      };
    }
    if (score >= 3) {
      return {
        score,
        promoted: true,
        candidate_only: false,
        grid_role: "data_grid_candidate",
        capture_status: "partial",
        confidence: 0.62,
        warnings: ["data_table_low_confidence"]
      };
    }
    return {
      score,
      promoted: false,
      candidate_only: true,
      grid_role: "layout_table",
      capture_status: "partial",
      confidence: 0.48,
      warnings: ["layout_table_suspected"]
    };
  }

  function scoreColumnPathCandidate(candidate) {
    const path = normalizePathParts(candidate?.path);
    if (path.length === 0) return -999;
    let score = Number(candidate?.score || 0);
    const source = String(candidate?.source || "");
    if (source === "html_thead") score += 4;
    if (source === "headers_attr") score += 3;
    if (source === "aria_columnheader") score += 4;
    if (source === "header_overlap") score += 3;
    if (source === "same_column_th") score += 2;
    if (source === "indexed_column") score += 2;
    if (source === "top_row_fallback") score += 1;
    if (source === "cell_attr_fallback") score += 1;
    if (path.some((part) => !String(part || "").trim())) score -= 3;
    if (path.some((part) => String(part || "").trim().length > 80)) score -= 2;
    return score;
  }

  function dedupeColumnPathCandidates(candidates) {
    return dedupeScoredCandidates(candidates, (candidate) =>
      normalizePathParts(candidate?.path).join("."), scoreColumnPathCandidate);
  }

  function buildColumnPathCandidates({ kind = null, cell = null, model = null, headerPaths = null, existingColPath = null, existingColSource = null, existingCandidates = null, colIndex = null } = {}) {
    const candidates = [];
    if (Array.isArray(existingCandidates)) {
      candidates.push(...existingCandidates);
    }
    const existingPath = normalizePathParts(existingColPath);
    if (existingPath.length > 0 && (!Array.isArray(existingCandidates) || existingCandidates.length === 0)) {
      const source =
        existingColSource ||
        (kind === "table" ? "html_thead" :
        kind === "aria" ? "aria_columnheader" :
        kind === "generic" || kind === "nexacro" ? "header_overlap" :
        kind === "canvas" ? "indexed_column" :
        "existing_path");
      candidates.push({ path: existingPath, source, score: 4 });
    }

    if (kind === "table" && Array.isArray(headerPaths) && Number.isFinite(Number(colIndex))) {
      const path = normalizePathParts(headerPaths[Number(colIndex)] || []);
      if (path.length > 0) {
        candidates.push({ path, source: "html_thead", score: 5 });
      }
    }

    if ((kind === "generic" || kind === "nexacro") && model?.cells && cell) {
      const overlapPath = genericGridColumnPathForCell(model, cell);
      if (overlapPath.length > 0) {
        candidates.push({ path: overlapPath, source: "header_overlap", score: 4 });
      }
      const topRowIndex = Math.min(...model.cells.map((candidate) => candidate.visualRowIndex));
      const topRowPath = dedupeOrderedParts(model.cells
        .filter((candidate) =>
          candidate.visualRowIndex === topRowIndex &&
          candidate.rect.bottom <= cell.rect.top + 1 &&
          horizontalOverlapRatio(candidate.rect, cell.rect) >= 0.35
        )
        .sort((a, b) => a.rect.left - b.rect.left)
        .map((candidate) => candidate.value));
      if (topRowPath.length > 0) {
        candidates.push({ path: topRowPath, source: "top_row_fallback", score: 2 });
      }
    }

    return dedupeColumnPathCandidates(candidates
      .map((candidate) => ({
        ...candidate,
        path: normalizePathParts(candidate.path),
        score: scoreColumnPathCandidate(candidate)
      }))
      .filter((candidate) => candidate.path.length > 0 && candidate.score > -999)
      .sort((a, b) => b.score - a.score || b.path.length - a.path.length))
      .slice(0, 6);
  }

  function selectBestColumnPath(candidates, fallbackPath = null) {
    const normalizedCandidates = Array.isArray(candidates) ? candidates : [];
    const best = normalizedCandidates[0] || null;
    const fallback = normalizePathParts(fallbackPath);
    const path = best?.path?.length ? best.path : fallback;
    return {
      path: path.length > 0 ? path : null,
      key: path.length > 0 ? columnKeyFromPath(path) : null,
      candidates: limitCandidateList(normalizedCandidates.map((candidate, index) => ({
        path: candidate.path,
        score: candidate.score,
        selected: index === 0,
        source: candidate.source
      })), MAX_CONTEXT_CANDIDATES),
      confidence: best ? toConfidenceFromScore(best.score, 0, 10) : (fallback.length > 0 ? 0.45 : null)
    };
  }

  function buildGridConfidence(gridCandidate, rowContext, columnSelection, cellValue) {
    const gridScore = Number(gridCandidate?.score || 0);
    return {
      grid: gridCandidate?.confidence ?? toConfidenceFromScore(gridScore, 0, 12),
      row_mapping: rowContext?.confidence ?? null,
      column_mapping: columnSelection?.confidence ?? null,
      cell_value: cellValue != null && String(cellValue).trim() ? 0.98 : 0.2
    };
  }

  function normalizeGridCandidate(candidate) {
    if (!candidate?.context || !candidate.kind) return null;
    const baseContext = resolveNormalizedGridContext(candidate.kind, candidate.context);
    if (!baseContext) return null;
    const rowContext = enhanceRowContextWithScoring(baseContext.row_context, {
      rowPairs: candidate.rowPairs || candidate.context.rowCandidatePairs || [],
      clickedColIndex: baseContext.col_index ?? candidate.context.colIndex ?? 999
    });
    const columnSelection = selectBestColumnPath(
      buildColumnPathCandidates({
        kind: candidate.kind,
        cell: candidate.modelCell || null,
        model: candidate.model || null,
        headerPaths: candidate.headerPaths || null,
        existingCandidates: candidate.context.columnPathCandidates || null,
        existingColSource: candidate.context.columnPathSource || null,
        existingColPath: baseContext.column_path || candidate.context.colPath || null,
        colIndex: baseContext.col_index ?? candidate.context.colIndex ?? null
      }),
      baseContext.column_path || candidate.context.colPath || null
    );
    const warnings = normalizeWarningList([
      ...(candidate.warnings || []),
      ...(rowContext?.warnings || []),
      ...((columnSelection?.path?.length || 0) === 0 ? ["column_path_missing"] : [])
    ]);
    const confidence = buildGridConfidence(candidate, rowContext, columnSelection, baseContext.cell_value);
    return {
      ...baseContext,
      ...candidate.aliases,
      detected: true,
      framework: candidate.framework || baseContext.framework || frameworkFromGridKind(baseContext.grid_kind),
      grid_type: candidate.gridType || baseContext.grid_type || gridTypeFromKind(baseContext.grid_kind),
      grid_id: candidate.root?.id || candidate.context.root?.id || candidate.context.root?.id || null,
      grid_selector: candidate.root instanceof Element ? cssPath(candidate.root) : candidate.context.root?.selector || null,
      source: candidate.source || candidate.kind,
      parser: candidate.parser || baseContext.grid_parser || null,
      row_context: rowContext || baseContext.row_context,
      row_context_map: rowContext?.map || rowContext?.values || baseContext.row_context_map || null,
      row_index: baseContext.row_index ?? baseContext.row_context?.row_index ?? candidate.context.rowIndex ?? null,
      col_index: baseContext.col_index ?? candidate.context.colIndex ?? null,
      column_path: columnSelection.path || baseContext.column_path || null,
      column_key: columnSelection.key || baseContext.column_key || null,
      column_candidates: columnSelection.candidates,
      cell_value: baseContext.cell_value ?? candidate.context.clickedValue ?? null,
      confidence,
      capture_status: warnings.length === 0 && (confidence.grid || 0) >= 0.8 ? "complete" : "partial",
      warnings
    };
  }

  function enhanceGridContextWithCandidates(gridContext, candidates) {
    if (!gridContext) return null;
    const best = chooseBestGridContextCandidate(candidates) || null;
    const normalized = best?.normalized || best || null;
    if (!normalized) return gridContext;
    return {
      ...gridContext,
      ...normalized,
      candidates: limitCandidateList((Array.isArray(candidates) ? candidates : [])
        .map((candidate, index) => {
          const normalizedCandidate = candidate?.normalized || normalizeGridCandidate(candidate);
          if (!normalizedCandidate) return null;
          return {
            source: normalizedCandidate.source,
            parser: normalizedCandidate.parser,
            grid_type: normalizedCandidate.grid_type,
            column_key: normalizedCandidate.column_key,
            score: candidate.score ?? null,
            confidence: normalizedCandidate.confidence?.grid ?? null,
            selected: index === 0,
            warnings: normalizeWarningList(normalizedCandidate.warnings)
          };
        })
        .filter(Boolean), MAX_CONTEXT_CANDIDATES)
    };
  }

  function chooseBestGridContextCandidate(candidates) {
    const ranked = (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => {
        const normalized = candidate?.normalized || normalizeGridCandidate(candidate);
        if (!normalized) return null;
        return {
          ...candidate,
          normalized,
          score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : Math.round((normalized.confidence?.grid || 0.3) * 10)
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        (Number(b.score || 0) - Number(a.score || 0)) ||
        (Number((b.normalized?.confidence?.grid) || 0) - Number((a.normalized?.confidence?.grid) || 0))
      );
    return ranked[0] || null;
  }

  function isInputAction(action) {
    return ["change", "beforeinput", "input", "focus", "blur", "keydown", "paste", "submit", "compositionstart", "compositionend"].includes(action);
  }

  function sanitizeInputPayloadForElement(payload, element) {
    const result = clonePayloadValue(payload) || {};
    if (!isInputLikeElement(element)) return result;
    for (const key of ["value", "data", "pasted_text"]) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = sanitizeStructuredValue(result[key], { key, element });
      }
    }
    if (result.input_context && typeof result.input_context === "object") {
      for (const key of ["value", "data", "pasted_text"]) {
        if (Object.prototype.hasOwnProperty.call(result.input_context, key)) {
          result.input_context[key] = sanitizeStructuredValue(result.input_context[key], { key, element });
        }
      }
    }
    return result;
  }

  function buildInputContextFromPayload(payload, element, action) {
    if (!isInputAction(action) && !isInputLikeElement(element)) return null;
    const inputContextSource =
      payload?.input_context && typeof payload.input_context === "object"
        ? payload.input_context
        : null;
    const source = payload || {};
    return {
      detected: Boolean(isInputLikeElement(element) || isInputAction(action)),
      value: inputContextSource?.value ?? source.value ?? null,
      name: inputContextSource?.name ?? source.name ?? element?.getAttribute?.("name") ?? null,
      id: inputContextSource?.id ?? source.id ?? element?.id ?? null,
      type: inputContextSource?.type ?? source.type ?? (element instanceof HTMLInputElement ? element.type || null : null),
      input_type: inputContextSource?.input_type ?? source.input_type ?? null,
      key: inputContextSource?.key ?? source.key ?? null,
      code: inputContextSource?.code ?? source.code ?? null,
      data: inputContextSource?.data ?? source.data ?? null,
      pasted_text: inputContextSource?.pasted_text ?? source.pasted_text ?? null,
      is_composing: Boolean(inputContextSource?.is_composing ?? source.is_composing),
      grid_editor: Boolean(inputContextSource?.grid_editor),
      grid_id: inputContextSource?.grid_id ?? null,
      row_index: inputContextSource?.row_index ?? null,
      col_index: inputContextSource?.col_index ?? null,
      column_key: inputContextSource?.column_key ?? null,
      editor_id: inputContextSource?.editor_id ?? null,
      associated_label: inputContextSource?.associated_label ?? associatedLabelOf(element)?.text ?? null
    };
  }

  function buildApiContextFromPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    const source = payload.api_context && typeof payload.api_context === "object"
      ? payload.api_context
      : payload;
    if (!source.url && !source.method && !source.status && !source.request_id && !source.requestId) return null;
    return {
      request_id: source.requestId || source.request_id || null,
      transport: source.transport || null,
      method: source.method || null,
      url: source.url || null,
      url_path: source.url_path || null,
      status: source.status ?? null,
      started_at: source.startedAt || source.started_at || null,
      ended_at: source.endedAt || source.ended_at || null,
      duration_ms: source.durationMs ?? source.duration_ms ?? null,
      success: source.success ?? null,
      correlation_id: source.correlationId || source.correlation_id || null,
      related_interaction_id: source.related_interaction_id || payload.related_interaction_id || null,
      related_event_id: source.related_event_id || payload.related_event_id || null,
      related_strategy: source.related_strategy || payload.related_strategy || null,
      body_capture: source.body_capture || payload.body_capture || {
        request_body_captured: false,
        response_body_captured: false,
        reason: source.body_capture_skip_reason || payload.body_capture_skip_reason || "disabled_by_privacy_policy"
      },
      body_capture_skipped: Boolean(source.body_capture_skipped || payload.body_capture_skipped),
      body_capture_skip_reason: source.body_capture_skip_reason || payload.body_capture_skip_reason || null,
      received_at: source.receivedAt || source.received_at || null,
      received_at_ms: source.receivedAtMs ?? source.received_at_ms ?? null,
      error_type: source.errorType || source.error_type || null,
      error_message: source.errorMessage || source.error_message || null,
      failure_stage: source.failureStage || source.failure_stage || null,
      is_internal_collector_endpoint: Boolean(source.is_internal_collector_endpoint),
      error: source.error || null
    };
  }

  function buildUiOutcomeContextFromPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (!payload.outcome_kind && !payload.outcome_message) return null;
    return {
      type: payload.outcome_kind || null,
      message: payload.outcome_message || null,
      source_action: payload.source_action || null,
      source_interaction_id: payload.source_interaction_id || null,
      observed_at: payload.observed_at || null
    };
  }

  function uiOutcomeSignature(element, outcomeKind, message) {
    return `${outcomeKind || "unknown"}|${cssPath(element) || ""}|${String(message || "").trim()}`;
  }

  function collectUiOutcomeSignatures() {
    const signatures = new Set();
    for (const candidate of uiOutcomeCandidates()) {
      if (!(candidate instanceof Element) || !isVisibleCandidate(candidate)) continue;
      const resolved = resolveUiOutcomeCandidate(candidate);
      if (!resolved) continue;
      signatures.add(uiOutcomeSignature(candidate, resolved.kind, resolved.message));
    }
    return signatures;
  }

  function visibleTextOf(el) {
    if (!(el instanceof Element)) return null;
    return String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() || null;
  }

  function compactSemanticText(value, maxLength = MAX_SEMANTIC_TEXT_CHARS) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
  }

  function ariaLabelledByText(el) {
    if (!(el instanceof Element)) return null;
    const values = `${el.getAttribute("aria-labelledby") || ""}`
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => compactSemanticText(visibleTextOf(document.getElementById(id)) || textOf(document.getElementById(id))))
      .filter(Boolean);
    return compactSemanticText(values.join(" "));
  }

  function labelTextWithoutControls(label) {
    if (!(label instanceof Element)) return null;
    const clone = label.cloneNode(true);
    clone.querySelectorAll?.("input,select,textarea,button,[role='button']").forEach((node) => node.remove());
    return compactSemanticText(clone.textContent);
  }

  function associatedLabelOf(el) {
    if (!(el instanceof Element)) return null;
    const labelledBy = ariaLabelledByText(el);
    if (labelledBy) return { text: labelledBy, source: "aria-labelledby", confidence: 1 };

    const ariaLabel = compactSemanticText(el.getAttribute("aria-label"));
    if (ariaLabel) return { text: ariaLabel, source: "aria-label", confidence: 0.98 };

    if (el.id) {
      try {
        const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const text = labelTextWithoutControls(explicit);
        if (text) return { text, source: "label-for", confidence: 1 };
      } catch {}
    }

    const wrapping = labelTextWithoutControls(el.closest?.("label"));
    if (wrapping) return { text: wrapping, source: "wrapping-label", confidence: 0.95 };

    for (const [source, value] of [
      ["placeholder", el.getAttribute("placeholder")],
      ["title", el.getAttribute("title")]
    ]) {
      const text = compactSemanticText(value);
      if (text) return { text, source, confidence: 0.7 };
    }
    return null;
  }

  function semanticTextContextOf(el, action, rawText) {
    const raw = String(rawText || "").replace(/\s+/g, " ").trim();
    const label = associatedLabelOf(el);
    const broadContainer = Boolean(
      el?.matches?.("dialog,[role='dialog'],[role='alertdialog'],[role='grid'],[role='treegrid'],table,tbody,thead,ul,ol,main,section,article,form,.modal,.cl-popup,.cl-dialog,.cl-window") ||
      looksLikeBroadClickContainer(el)
    );
    const heading = broadContainer ? compactSemanticText(primaryContainerHeadingLabel(el)) : null;
    const direct = compactSemanticText(directTextOf(el));
    const outcomeMessage = action === "ui_outcome" ? compactSemanticText(raw) : null;
    const popupTitle = /popup_(?:open|close)/.test(String(action || "")) ? popupTitleOf(el) : null;
    const candidate = popupTitle || outcomeMessage || label?.text || heading || direct || (!broadContainer ? compactSemanticText(raw) : null);
    const source = popupTitle ? "popup-title" : outcomeMessage ? "ui-outcome-message" : label?.text ? label.source : heading ? "container-heading" : direct ? "direct-text" : candidate ? "visible-text" : "excluded-container-text";
    return {
      version: TEXT_CONTEXT_VERSION,
      semantic_text: candidate,
      source,
      confidence: popupTitle || outcomeMessage ? 0.98 : label?.confidence ?? (heading ? 0.9 : direct ? 0.85 : candidate ? 0.55 : 0),
      original_length: raw.length,
      descendant_text_excluded: broadContainer && raw.length > String(candidate || "").length,
      truncated: Boolean(candidate && candidate.length >= MAX_SEMANTIC_TEXT_CHARS && raw.length > candidate.length)
    };
  }

  function directTextOf(el) {
    if (!(el instanceof Element)) return null;
    const parts = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const value = String(node.textContent || "").replace(/\s+/g, " ").trim();
      if (value) parts.push(value);
    }
    return parts.join(" ").trim() || null;
  }

  function cleanMenuLabel(label) {
    const text = String(label || "")
      .replace(/[▸▾▶▼•]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text || null;
  }

  function directOwnTextExcludingChildItems(el) {
    if (!(el instanceof Element)) return null;
    const parts = [];
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = cleanMenuLabel(node.textContent || "");
        if (value) parts.push(value);
        continue;
      }
      if (!(node instanceof Element)) continue;
      if (node.matches?.("[role='treeitem'], [role='menuitem'], li, .tree-node, .tree-item, .folder-node, .folder-item, .menu-item, .menu-node")) continue;
      if (node.matches?.("svg, path, icon, i, .icon, .expander, .toggle")) continue;
      if (node.querySelector?.("[role='treeitem'], [role='menuitem'], li, .tree-node, .tree-item, .folder-node, .folder-item, .menu-item, .menu-node")) continue;
      const value = cleanMenuLabel(directTextOf(node) || visibleTextOf(node) || textOf(node) || "");
      if (value) parts.push(value);
    }
    return parts.join(" ").trim() || null;
  }

  function extractMenuItemLabel(el) {
    if (!(el instanceof Element)) return null;
    const primaryNode = el.querySelector(":scope > .tree-row, :scope > .row, :scope > .tree-item-row, :scope > .label, :scope > .cl-text, :scope > .cl-control .cl-text, :scope > .tree-label, :scope > .tree-text, :scope > .node-label, :scope > .item-label, :scope > a, :scope > button");
    const candidates = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("data-label"),
      directOwnTextExcludingChildItems(primaryNode),
      visibleTextOf(primaryNode),
      directOwnTextExcludingChildItems(el),
      directTextOf(el),
      textOf(el)
    ];
    for (const candidate of candidates) {
      const cleaned = cleanMenuLabel(candidate);
      if (cleaned) return cleaned;
    }
    return null;
  }

  function isSemanticClickIdentity(el) {
    if (!(el instanceof Element)) return false;
    if (el.matches([
      "button",
      "a[href]",
      "input",
      "select",
      "textarea",
      "td",
      "th",
      "canvas",
      "[contenteditable='true']",
      "[contenteditable='']",
      "[role='button']",
      "[role='link']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='treeitem']",
      "[role='gridcell']",
      "[role='cell']",
      "[role='columnheader']",
      "[role='rowheader']",
      "[role='switch']",
      "[aria-pressed]",
      "[aria-expanded]",
      "[data-action]",
      "[data-click]",
      "[onclick]",
      "[data-row-index][data-col-id]",
      "[data-row-index][data-col-index]"
    ].join(","))) {
      return true;
    }

    if (typeof el.onclick === "function") return true;

    const descriptor = `${classTextOf(el)} ${el.id || ""}`;
    const directLabel = cleanMenuLabel(
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("data-label") ||
      directOwnTextExcludingChildItems(el) ||
      directTextOf(el) ||
      ""
    );
    const tabIndex = readNumericAttr(el, ["tabindex"]);
    const descendantSemanticCount = el.querySelectorAll("button, a[href], input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [role='tab']").length;
    const interactiveClass = /\b(btn|button|action|clickable|card-action|card_action|cta|trigger|selectable|interactive)\b/i.test(descriptor);

    return Boolean(
      directLabel &&
      directLabel.length <= 120 &&
      descendantSemanticCount <= 4 &&
      (
        interactiveClass ||
        (tabIndex != null && tabIndex >= 0)
      )
    );
  }

  function primaryContainerHeadingLabel(el) {
    if (!(el instanceof Element)) return null;
    const heading = el.querySelector(":scope > .panel-head h1, :scope > .panel-head h2, :scope > .panel-head h3, :scope > header h1, :scope > header h2, :scope > header h3, :scope > h1, :scope > h2, :scope > h3, :scope > legend");
    return cleanMenuLabel(visibleTextOf(heading) || textOf(heading) || "");
  }

  function looksLikeBroadClickContainer(el) {
    if (!(el instanceof Element) || isSemanticClickIdentity(el)) return false;
    const tag = el.tagName?.toLowerCase() || "";
    if (!/^(div|section|article|main|aside|nav|form)$/.test(tag)) return false;

    const text = visibleTextOf(el) || textOf(el) || "";
    if (!text) return false;

    const directText = directTextOf(el) || "";
    const descriptor = `${tag} ${classTextOf(el)} ${el.id || ""} ${el.getAttribute("role") || ""}`;
    const rect = el.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const descendantSemanticCount = el.querySelectorAll("button, a, input, select, textarea, td, th, table, [role='button'], [role='treeitem'], [role='gridcell'], [role='cell'], [role='columnheader'], [role='rowheader'], [role='grid'], [role='treegrid']").length;

    return (
      text.length > 160 ||
      descendantSemanticCount >= 6 ||
      area > 180000 ||
      (directText.length <= 40 && /\b(panel|layout|shell|content|container|frame|body|wrap|wrapper)\b/i.test(descriptor))
    );
  }

  function clickElementTextOf(el) {
    if (!(el instanceof Element)) return null;
    const semanticCandidate = cleanMenuLabel(
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("data-label") ||
      primaryContainerHeadingLabel(el) ||
      directOwnTextExcludingChildItems(el) ||
      directTextOf(el) ||
      ""
    );
    if (!looksLikeBroadClickContainer(el)) {
      if (
        isSemanticClickIdentity(el) &&
        !el.matches?.("button, a[href], input, select, textarea, td, th, canvas, [role='gridcell'], [role='cell'], [role='columnheader'], [role='rowheader']")
      ) {
        const fullText = visibleTextOf(el) || textOf(el) || "";
        if (semanticCandidate && (fullText.length > 120 || el.querySelector?.("p, small, pre, table, ul, ol, .description"))) {
          return semanticCandidate;
        }
      }
      return visibleTextOf(el) || textOf(el);
    }

    return semanticCandidate;
  }

  function looksNumericLikeText(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if (/^[-+]?[\d,.]+(?:%|)$/.test(text)) return true;
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(text)) return true;
    return false;
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts = [];
    let current = el;

    while (current && current.nodeType === 1 && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.classList.length) {
        part += `.${[...current.classList].slice(0, 3).map((item) => CSS.escape(item)).join(".")}`;
      }
      const siblings = [...(current.parentElement?.children || [])].filter((item) => item.tagName === current.tagName);
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }

    return parts.join(" > ");
  }

  function xPath(el) {
    if (!(el instanceof Element)) return null;
    if (el.id) return `//*[@id="${el.id}"]`;
    const segments = [];
    let current = el;

    while (current && current.nodeType === 1) {
      let index = 1;
      for (let sibling = current.previousSibling; sibling; sibling = sibling.previousSibling) {
        if (sibling.nodeType === 1 && sibling.nodeName === current.nodeName) {
          index += 1;
        }
      }
      segments.unshift(`${current.nodeName.toLowerCase()}[${index}]`);
      current = current.parentNode;
    }

    return `/${segments.join("/")}`;
  }

  function boundsOf(el) {
    try {
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      };
    } catch {
      return null;
    }
  }

  function parseWebSquareCellMeta(cell) {
    if (!(cell instanceof Element) || !cell.id) return null;

    const rowNumberMatch = cell.id.match(/headerRowNumber_bodyRow_(\d+)$/);
    if (rowNumberMatch) {
      return {
        type: "row_number",
        rowIndex: Number(rowNumberMatch[1])
      };
    }

    const bodyCellMatch = cell.id.match(/_cell_(\d+)_(\d+)$/);
    if (bodyCellMatch) {
      return {
        type: "body_cell",
        rowIndex: Number(bodyCellMatch[1]),
        colIndex: Number(bodyCellMatch[2])
      };
    }

    return null;
  }

  function buildWebSquareRows(table, headers) {
    const cellNodes = [...table.querySelectorAll("tbody td, tbody th, td, th")];
    const rowMap = new Map();
    let matchedCellCount = 0;

    for (const cell of cellNodes) {
      const meta = parseWebSquareCellMeta(cell);
      if (!meta) continue;
      matchedCellCount += 1;

      const rowEntry = rowMap.get(meta.rowIndex) || {
        row_index: meta.rowIndex,
        row_number: null,
        cells: []
      };

      const columnLabel = headers[meta.colIndex - 1] || `col_${meta.colIndex}`;
      const value = sanitizeGridValue(visibleTextOf(cell) || textOf(cell), columnLabel, cell);
      if (!value) {
        rowMap.set(meta.rowIndex, rowEntry);
        continue;
      }

      if (meta.type === "row_number") {
        rowEntry.row_number = value;
        rowMap.set(meta.rowIndex, rowEntry);
        continue;
      }

      rowEntry.cells.push({
        label: columnLabel,
        value,
        selector: cssPath(cell),
        row_index: meta.rowIndex,
        col_index: meta.colIndex
      });
      rowMap.set(meta.rowIndex, rowEntry);
    }

    if (matchedCellCount === 0) return null;

    return [...rowMap.values()]
      .sort((a, b) => a.row_index - b.row_index)
      .map((row) => {
        row.cells.sort((a, b) => a.col_index - b.col_index);
        return row;
      })
      .filter((row) => row.cells.length > 0);
  }

  function parsePixel(value) {
    const parsed = Number.parseFloat(String(value || "").replace("px", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isElementVisuallyHidden(el) {
    if (!(el instanceof Element)) return false;
    try {
      const style = window.getComputedStyle(el);
      return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
    } catch {
      return false;
    }
  }

  function findNexacroPivotRoot(target) {
    if (!(target instanceof Element)) return null;
    return target.closest(".Grid.NxPivot_grid");
  }

  function parseNexacroPivotCell(cell) {
    if (!(cell instanceof Element) || !cell.id) return null;
    const match = cell.id.match(/\.(head|body|summary)\.gridrow_(-?\d+)\.cell_(-?\d+)_(\d+)$/);
    if (!match) return null;

    const [, band, gridRowIndexText, rowIndexText, colIndexText] = match;
    const container = cell.parentElement;
    const containerId = container?.id || "";
    const region = containerId.endsWith(":containerleft")
      ? "left"
      : containerId.endsWith(":containerright")
        ? "right"
        : "body";
    const textNode = cell.querySelector('[id$=":text"]');
    const textTarget = textNode || cell;
    const value = visibleTextOf(textTarget) || textOf(textTarget);
    const rect = cell.getBoundingClientRect();

    return {
      element: cell,
      band,
      region,
      gridRowIndex: Number(gridRowIndexText),
      rowIndex: Number(rowIndexText),
      colIndex: Number(colIndexText),
      value,
      hidden: isElementVisuallyHidden(textTarget),
      rect: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      styleRect: {
        left: parsePixel(cell.style.left),
        top: parsePixel(cell.style.top),
        width: parsePixel(cell.style.width),
        height: parsePixel(cell.style.height)
      }
    };
  }

  function collectNexacroPivotCells(root, bandName) {
    if (!(root instanceof Element)) return [];
    const band = root.querySelector(`.GridBandControl.${bandName}`);
    if (!(band instanceof Element)) return [];
    return [...band.querySelectorAll(".GridCellControl.cell")]
      .map((cell) => parseNexacroPivotCell(cell))
      .filter(Boolean);
  }

  function dedupeOrderedParts(parts) {
    const deduped = [];
    for (const part of parts) {
      if (!part) continue;
      if (deduped[deduped.length - 1] !== part) deduped.push(part);
    }
    return deduped;
  }

  function buildNexacroPivotHeaderIndex(root) {
    const headCells = collectNexacroPivotCells(root, "head").filter((info) => info.value);
    return {
      rowHeaders: headCells
        .filter((info) => info.region === "left")
        .sort((a, b) => a.colIndex - b.colIndex),
      dataHeaders: headCells
        .filter((info) => info.region !== "left")
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left || b.rect.width - a.rect.width)
    };
  }

  function nexacroPivotColumnPathForRect(headerIndex, rect) {
    const centerX = rect.left + (rect.width / 2);
    const parts = headerIndex.dataHeaders
      .filter((header) => centerX >= header.rect.left - 1 && centerX <= header.rect.right + 1)
      .map((header) => header.value);
    return dedupeOrderedParts(parts);
  }

  function buildNexacroPivotColumnPaths(root, headerIndex) {
    const bodyCells = collectNexacroPivotCells(root, "body")
      .filter((info) => info.region !== "left" && info.value);
    if (bodyCells.length === 0) return [];

    const firstRowIndex = Math.min(...bodyCells.map((info) => info.rowIndex));
    return bodyCells
      .filter((info) => info.rowIndex === firstRowIndex)
      .sort((a, b) => a.colIndex - b.colIndex)
      .map((info) => {
        const colPath = nexacroPivotColumnPathForRect(headerIndex, info.rect);
        return {
          col_index: info.colIndex,
          label: colPath.join(" > ") || `col_${info.colIndex}`,
          col_path: colPath
        };
      });
  }

  function buildNexacroPivotBodyRows(root, headerIndex) {
    const bodyCells = collectNexacroPivotCells(root, "body").filter((info) => info.value);
    if (bodyCells.length === 0) return [];

    const rowMap = new Map();
    for (const info of bodyCells.sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex)) {
      const row = rowMap.get(info.rowIndex) || {
        row_index: info.rowIndex,
        left_cells: [],
        value_cells: []
      };
      if (info.region === "left") {
        row.left_cells.push(info);
      } else {
        row.value_cells.push(info);
      }
      rowMap.set(info.rowIndex, row);
    }

    const carryForward = [];
    return [...rowMap.values()]
      .sort((a, b) => a.row_index - b.row_index)
      .map((row) => {
        const rowPath = [];
        for (const leftCell of row.left_cells.sort((a, b) => a.colIndex - b.colIndex)) {
          const depth = leftCell.colIndex;
          const nextValue = leftCell.hidden ? (carryForward[depth] ?? leftCell.value ?? null) : leftCell.value;
          if (!leftCell.hidden && leftCell.value) {
            carryForward[depth] = leftCell.value;
          }
          if (nextValue) rowPath.push(nextValue);
        }

        const cells = row.value_cells
          .sort((a, b) => a.colIndex - b.colIndex)
          .map((cell) => {
            const colPath = nexacroPivotColumnPathForRect(headerIndex, cell.rect);
            return {
              label: colPath.join(" > ") || `col_${cell.colIndex}`,
              value: cell.value,
              selector: cssPath(cell.element),
              row_index: row.row_index,
              col_index: cell.colIndex,
              col_path: colPath
            };
          });

        return {
          row_index: row.row_index,
          row_path: rowPath,
          row_label: rowPath.join(" > ") || null,
          cells
        };
      })
      .filter((row) => row.cells.length > 0);
  }

  function buildNexacroPivotSummary(root, headerIndex) {
    const summaryCells = collectNexacroPivotCells(root, "summary").filter((info) => info.value);
    if (summaryCells.length === 0) return null;

    const label = summaryCells
      .filter((info) => info.region === "left")
      .sort((a, b) => a.colIndex - b.colIndex)
      .map((info) => info.value)
      .filter(Boolean)
      .join(" > ") || null;

    const cells = summaryCells
      .filter((info) => info.region !== "left")
      .sort((a, b) => a.colIndex - b.colIndex)
      .map((cell) => {
        const colPath = nexacroPivotColumnPathForRect(headerIndex, cell.rect);
        return {
          label: colPath.join(" > ") || `col_${cell.colIndex}`,
          value: cell.value,
          selector: cssPath(cell.element),
          row_index: cell.rowIndex,
          col_index: cell.colIndex,
          col_path: colPath
        };
      });

    return {
      label,
      cells
    };
  }

  function structuredNexacroPivots() {
    return [...document.querySelectorAll(".Grid.NxPivot_grid")].slice(0, 4).map((root, pivotIndex) => {
      const headerIndex = buildNexacroPivotHeaderIndex(root);
      const rows = buildNexacroPivotBodyRows(root, headerIndex);
      if (rows.length === 0) return null;

      return {
        kind: "nexacro_pivot",
        pivot_index: pivotIndex,
        id: root.id || null,
        selector: cssPath(root),
        row_headers: headerIndex.rowHeaders.map((header) => header.value),
        column_paths: buildNexacroPivotColumnPaths(root, headerIndex),
        rows,
        summary: buildNexacroPivotSummary(root, headerIndex)
      };
    }).filter(Boolean);
  }

  function resolveNexacroPivotCellContext(target) {
    const root = findNexacroPivotRoot(target);
    const cell = target instanceof Element ? target.closest(".GridCellControl.cell") : null;
    if (!(root instanceof Element) || !(cell instanceof Element)) return null;

    const info = parseNexacroPivotCell(cell);
    if (!info || !info.value) return null;

    const headerIndex = buildNexacroPivotHeaderIndex(root);
    const rowMap = new Map(buildNexacroPivotBodyRows(root, headerIndex).map((row) => [row.row_index, row]));
    const summary = buildNexacroPivotSummary(root, headerIndex);
    const colPath = info.region === "left" ? [] : nexacroPivotColumnPathForRect(headerIndex, info.rect);
    const rowPath = info.band === "body"
      ? (rowMap.get(info.rowIndex)?.row_path || [])
      : info.band === "summary" && summary?.label
        ? [summary.label]
        : [];
    const rowContextKeys = headerIndex.rowHeaders.map((header) => header.value).filter(Boolean);
    const rowContextMap = buildRowContextMap(rowPath, rowContextKeys);
    const rowCandidatePairs = rowPath.map((value, index) => ({
      key: rowContextKeys[index] || `row_dim_${index + 1}`,
      value,
      colIndex: index,
      source: "nexacro_row_header"
    }));

    return {
      root,
      cell: info.element,
      band: info.band,
      region: info.region,
      rowIndex: info.rowIndex,
      colIndex: info.colIndex,
      clickedValue: info.value,
      colPath,
      colLabel: colPath.join(" > ") || info.value,
      rowPath,
      rowLabel: rowPath.join(" > ") || null,
      rowContextKeys,
      rowContextMap,
      rowCandidatePairs
    };
  }

  function classTextOf(el) {
    if (!(el instanceof Element)) return "";
    return String(el.getAttribute("class") || "");
  }

  function genericGridMarkerText(el) {
    return `${el.id || ""} ${classTextOf(el)} ${el.getAttribute?.("role") || ""}`;
  }

  function hasGenericGridMarker(el) {
    if (!(el instanceof Element)) return false;
    const role = el.getAttribute("role");
    if (role === "grid" || role === "treegrid" || role === "table") return true;
    return /(?:^|[\s_.:-])(grid|pivot|table|sheet|spread)(?:$|[\s_.:-])/i.test(genericGridMarkerText(el));
  }

  function readNumericAttr(el, names) {
    if (!(el instanceof Element)) return null;
    for (const name of names) {
      const value = el.getAttribute?.(name);
      if (value == null || value === "") continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function parseGenericCellIndex(el) {
    const rowAttr =
      readNumericAttr(el, ["data-row-index", "data-rowindex", "aria-rowindex", "data-row"]) ??
      readNumericAttr(el.parentElement, ["data-row-index", "data-rowindex", "aria-rowindex", "data-row"]);
    let colAttr = readNumericAttr(el, ["data-col-index", "data-colindex", "aria-colindex", "data-col"]);
    if (colAttr == null && el.parentElement) {
      const role = el.getAttribute("role");
      if (["columnheader", "rowheader", "gridcell", "cell"].includes(role)) {
        const siblings = [...el.parentElement.children].filter((candidate) =>
          ["columnheader", "rowheader", "gridcell", "cell"].includes(candidate.getAttribute?.("role"))
        );
        const siblingIndex = siblings.indexOf(el);
        if (siblingIndex >= 0) colAttr = siblingIndex + 1;
      }
    }
    if (rowAttr != null || colAttr != null) {
      return { rowIndex: rowAttr, colIndex: colAttr };
    }

    const source = `${el.id || ""} ${classTextOf(el)}`;
    const cellMatch = source.match(/(?:^|[._:-])cell[_-]?(-?\d+)[_-](\d+)(?:$|[\s._:-])/i);
    if (cellMatch) {
      return {
        rowIndex: Number(cellMatch[1]),
        colIndex: Number(cellMatch[2])
      };
    }

    return { rowIndex: null, colIndex: null };
  }

  function genericCellSelector() {
    return [
      '[role="gridcell"]',
      '[role="cell"]',
      '[role="columnheader"]',
      '[role="rowheader"]',
      '[data-row-index][data-col-id]',
      '[data-row-index][data-col-index]',
      '[data-rowindex][data-colindex]',
      '[aria-rowindex][aria-colindex]',
      '[id*="cell_"]',
      '[id*="Cell_"]',
      '[id*="_cell_"]',
      '[id*="_Cell_"]',
      '.cell',
      '.Cell',
      '[class*="cell"]',
      '[class*="Cell"]'
    ].join(",");
  }

  function genericCellInfo(el, root) {
    if (!(el instanceof Element) || el.closest("table")) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;

    const value = visibleTextOf(el) || textOf(el);
    if (!value) return null;

    const role = el.getAttribute("role");
    const marker = genericGridMarkerText(el);
    const parentMarker = genericGridMarkerText(el.parentElement);
    const isColumnHeader = role === "columnheader" || /(?:head|header|columnheader)/i.test(`${marker} ${parentMarker}`);
    const isRowHeader = role === "rowheader" || /(?:rowheader)/i.test(`${marker} ${parentMarker}`);
    const index = parseGenericCellIndex(el);
    const rootRect = root.getBoundingClientRect();

    return {
      element: el,
      value,
      role: role || null,
      rowIndex: index.rowIndex,
      colIndex: index.colIndex,
      visualRowIndex: null,
      visualColIndex: null,
      isColumnHeader,
      isRowHeader,
      rect: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      relativeRect: {
        left: Math.round(rect.left - rootRect.left),
        top: Math.round(rect.top - rootRect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function assignGenericGridVisualIndexes(cells) {
    const assign = (key, outputKey) => {
      const groups = [];
      for (const cell of [...cells].sort((a, b) => a.rect[key] - b.rect[key])) {
        let groupIndex = groups.findIndex((group) => Math.abs(group.position - cell.rect[key]) <= 4);
        if (groupIndex < 0) {
          groups.push({ position: cell.rect[key] });
          groupIndex = groups.length - 1;
        }
        cell[outputKey] = groupIndex;
      }
    };

    assign("top", "visualRowIndex");
    assign("left", "visualColIndex");
  }

  function collectGenericGridCells(root) {
    if (!(root instanceof Element)) return [];
    const seen = new Set();
    const cells = [];

    for (const candidate of root.querySelectorAll(genericCellSelector())) {
      const info = genericCellInfo(candidate, root);
      if (!info) continue;

      const key = [
        Math.round(info.rect.left),
        Math.round(info.rect.top),
        Math.round(info.rect.width),
        Math.round(info.rect.height),
        info.value
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(info);
    }

    assignGenericGridVisualIndexes(cells);
    return cells;
  }

  function scoreGenericGridRoot(root, cells) {
    const rowCount = new Set(cells.map((cell) => cell.visualRowIndex)).size;
    const colCount = new Set(cells.map((cell) => cell.visualColIndex)).size;
    const indexedCount = cells.filter((cell) => cell.rowIndex != null || cell.colIndex != null).length;
    const roleCount = cells.filter((cell) => cell.role).length;
    const headerCount = cells.filter((cell) => cell.isColumnHeader || cell.isRowHeader).length;
    const reasons = [];
    let confidence = 0;

    if (hasGenericGridMarker(root)) {
      confidence += 0.2;
      reasons.push("root_marker");
    }
    if (cells.length >= 4 && rowCount >= 2 && colCount >= 2) {
      confidence += 0.28;
      reasons.push("grid_geometry");
    }
    if (indexedCount >= Math.min(4, cells.length)) {
      confidence += 0.22;
      reasons.push("cell_indexes");
    }
    if (roleCount >= Math.min(4, cells.length)) {
      confidence += 0.18;
      reasons.push("aria_roles");
    }
    if (headerCount > 0) {
      confidence += 0.12;
      reasons.push("header_hints");
    }
    if (cells.length >= 12) {
      confidence += 0.08;
      reasons.push("repeated_cells");
    }

    return {
      confidence: Math.min(Number(confidence.toFixed(2)), 0.95),
      reasons,
      rowCount,
      colCount
    };
  }

  function buildGenericGridModel(root) {
    if (!(root instanceof Element) || root.closest("table") || findNexacroPivotRoot(root)) return null;
    const cells = collectGenericGridCells(root);
    if (cells.length < 4) return null;

    const score = scoreGenericGridRoot(root, cells);
    if (score.confidence < GENERIC_GRID_MIN_CONFIDENCE) return null;

    const columnPaths = [];
    const bodyCandidates = cells.filter((cell) => !cell.isColumnHeader);
    if (bodyCandidates.length === 0) return null;

    const firstBodyCell = [...bodyCandidates].sort((a, b) =>
      (a.rowIndex ?? a.visualRowIndex) - (b.rowIndex ?? b.visualRowIndex) ||
      (a.colIndex ?? a.visualColIndex) - (b.colIndex ?? b.visualColIndex)
    )[0];
    const firstBodyCells = cells
      .filter((cell) => sameGenericGridRow(cell, firstBodyCell) && !cell.isColumnHeader && !cell.isRowHeader)
      .sort((a, b) => a.rect.left - b.rect.left);

    for (const cell of firstBodyCells) {
      const colPath = genericGridColumnPathForCell({ cells }, cell);
      columnPaths.push({
        col_index: cell.colIndex ?? cell.visualColIndex,
        label: colPath.join(" > ") || `col_${(cell.colIndex ?? cell.visualColIndex) + 1}`,
        col_path: colPath
      });
    }

    return {
      kind: "generic_grid",
      id: root.id || null,
      selector: cssPath(root),
      parser: "generic_dom_grid",
      confidence: score.confidence,
      confidence_reasons: score.reasons,
      row_count: score.rowCount,
      col_count: score.colCount,
      cells,
      column_paths: columnPaths,
      rows: buildGenericGridRows({ cells, confidence: score.confidence })
    };
  }

  function getGenericGridModel(root) {
    return readCachedStructureModel(genericGridModelCache, root, buildGenericGridModel);
  }

  function horizontalOverlapRatio(a, b) {
    const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    return overlap / Math.max(1, Math.min(a.width, b.width));
  }

  function genericGridRowGroup(cell) {
    if (!cell) return null;
    if (cell.rowIndex != null) return `row:${cell.rowIndex}`;
    return cell.element?.closest?.("[role='row']") || `visual:${cell.visualRowIndex}`;
  }

  function sameGenericGridRow(left, right) {
    if (!left || !right) return false;
    return genericGridRowGroup(left) === genericGridRowGroup(right);
  }

  function genericGridColumnOrder(cell) {
    return cell?.colIndex ?? cell?.visualColIndex ?? null;
  }

  function genericGridCellIsBefore(candidate, cell) {
    const candidateIndex = genericGridColumnOrder(candidate);
    const cellIndex = genericGridColumnOrder(cell);
    if (candidateIndex != null && cellIndex != null) return candidateIndex < cellIndex;
    return candidate.rect.right <= cell.rect.left + 1;
  }

  function genericGridColumnPathForCell(model, cell) {
    const headerGroups = new Map();
    for (const header of model.cells.filter((candidate) => candidate !== cell && candidate.isColumnHeader)) {
      const groupKey = header.element?.closest?.("[role='row']") || header.element?.parentElement || `visual:${header.visualRowIndex}`;
      const group = headerGroups.get(groupKey) || [];
      group.push(header);
      headerGroups.set(groupKey, group);
    }

    const cellColIndex = genericGridColumnOrder(cell);
    const headerParts = [...headerGroups.values()]
      .map((headers) => headers
        .map((header) => {
          const headerColIndex = genericGridColumnOrder(header);
          const exactIndex = cellColIndex != null && headerColIndex != null && Number(cellColIndex) === Number(headerColIndex);
          const sameVisualColumn = header.visualColIndex === cell.visualColIndex;
          const overlap = horizontalOverlapRatio(header.rect, cell.rect);
          const score = exactIndex ? 100 : sameVisualColumn ? 60 : Math.round(overlap * 40);
          return { header, score, overlap };
        })
        .filter((candidate) => candidate.score >= 14)
        .sort((a, b) => b.score - a.score || b.overlap - a.overlap)[0] || null)
      .filter(Boolean)
      .sort((a, b) => a.header.rect.top - b.header.rect.top)
      .map((candidate) => candidate.header.value);

    if (headerParts.length > 0) return dedupeOrderedParts(headerParts);

    const topRowIndex = Math.min(...model.cells.map((candidate) => candidate.visualRowIndex));
    return dedupeOrderedParts(model.cells
      .filter((candidate) =>
        candidate.visualRowIndex === topRowIndex &&
        candidate !== cell &&
        candidate.rect.bottom <= cell.rect.top + 1 &&
        horizontalOverlapRatio(candidate.rect, cell.rect) >= 0.35
      )
      .sort((a, b) => a.rect.left - b.rect.left)
      .map((candidate) => candidate.value));
  }

  function genericGridRowPathForCell(model, cell) {
    const semanticCandidates = model.cells
      .filter((candidate) =>
        candidate !== cell &&
        sameGenericGridRow(candidate, cell) &&
        genericGridCellIsBefore(candidate, cell) &&
        (!candidate.isColumnHeader || candidate.isRowHeader) &&
        (candidate.isRowHeader || !looksNumericLikeText(candidate.value))
      )
      .sort((a, b) => a.rect.left - b.rect.left)
      .map((candidate) => candidate.value);

    if (semanticCandidates.length > 0) {
      return dedupeOrderedParts(semanticCandidates);
    }

    return dedupeOrderedParts(model.cells
      .filter((candidate) =>
        candidate !== cell &&
        sameGenericGridRow(candidate, cell) &&
        genericGridCellIsBefore(candidate, cell) &&
        (!candidate.isColumnHeader || candidate.isRowHeader)
      )
      .sort((a, b) => a.rect.left - b.rect.left)
      .slice(0, 2)
      .map((candidate) => candidate.value));
  }

  function buildGenericGridRows(model) {
    const rowMap = new Map();

    for (const cell of model.cells) {
      if (cell.isColumnHeader || cell.isRowHeader) continue;

      const rowKey = genericGridRowGroup(cell);
      const row = rowMap.get(rowKey) || {
        row_index: cell.rowIndex ?? cell.visualRowIndex,
        row_path: genericGridRowPathForCell(model, cell),
        cells: []
      };
      const colPath = genericGridColumnPathForCell(model, cell);
      row.cells.push({
        label: colPath.join(" > ") || `col_${(cell.colIndex ?? cell.visualColIndex) + 1}`,
        value: cell.value,
        selector: cssPath(cell.element),
        row_index: cell.rowIndex ?? cell.visualRowIndex,
        col_index: cell.colIndex ?? cell.visualColIndex,
        col_path: colPath
      });
      rowMap.set(rowKey, row);
    }

    return [...rowMap.values()]
      .sort((a, b) => a.row_index - b.row_index)
      .slice(0, 10)
      .map((row) => ({
        ...row,
        row_label: row.row_path.join(" > ") || null,
        cells: row.cells.sort((a, b) => a.col_index - b.col_index)
      }))
      .filter((row) => row.cells.length > 0);
  }

  function genericGridCandidateRoots() {
    const selector = [
      '[role="grid"]',
      '[role="treegrid"]',
      '[role="table"]',
      '[id*="grid"]',
      '[id*="Grid"]',
      '[id*="pivot"]',
      '[id*="Pivot"]',
      '[class*="grid"]',
      '[class*="Grid"]',
      '[class*="pivot"]',
      '[class*="Pivot"]'
    ].join(",");
    return [...new Set([...document.querySelectorAll(selector)].filter((root) =>
      root instanceof Element &&
      !root.closest("table") &&
      !findNexacroPivotRoot(root) &&
      hasGenericGridMarker(root)
    ))];
  }

  function structuredGenericGrids() {
    return genericGridCandidateRoots()
      .map((root) => getGenericGridModel(root))
      .filter(Boolean)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 4)
      .map((grid, gridIndex) => ({
        kind: grid.kind,
        grid_index: gridIndex,
        id: grid.id,
        selector: grid.selector,
        parser: grid.parser,
        confidence: grid.confidence,
        confidence_reasons: grid.confidence_reasons,
        row_count: grid.row_count,
        col_count: grid.col_count,
        column_paths: grid.column_paths,
        rows: grid.rows.map((row) => sanitizeStructuredGridRow(row))
      }));
  }

  function resolveGenericGridCellContext(target, event = null) {
    if (!(target instanceof Element)) return null;
    const candidateTargets = [];
    const addCandidate = (candidate) => {
      if (candidate instanceof Element && !candidateTargets.includes(candidate)) {
        candidateTargets.push(candidate);
      }
    };
    addCandidate(target);
    if (typeof event?.composedPath === "function") {
      for (const candidate of event.composedPath()) addCandidate(candidate);
    }
    if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
      for (const candidate of document.elementsFromPoint(event.clientX, event.clientY)) {
        addCandidate(candidate);
      }
    }

    for (const candidateTarget of candidateTargets) {
      if (candidateTarget.closest("table") || findNexacroPivotRoot(candidateTarget)) continue;
      const clickedCell = candidateTarget.closest(genericCellSelector());
      if (!(clickedCell instanceof Element)) continue;

      const roots = [];
      let current = clickedCell;
      while (current && current !== document.documentElement && roots.length < 8) {
        if (hasGenericGridMarker(current) && !current.closest("table") && !findNexacroPivotRoot(current)) {
          roots.push(current);
        }
        current = current.parentElement;
      }
      if (roots.length === 0) {
        current = clickedCell.parentElement;
        while (current && current !== document.documentElement && roots.length < 4) {
          if (current.closest("table") || findNexacroPivotRoot(current)) {
            current = current.parentElement;
            continue;
          }
          const cellCount = current.querySelectorAll(genericCellSelector()).length;
          if (cellCount >= 4 && cellCount <= 120) {
            roots.push(current);
          }
          current = current.parentElement;
        }
      }

      let best = null;
      for (const root of roots) {
        const model = getGenericGridModel(root);
        if (!model) continue;
        const cell = model.cells.find((info) => info.element === clickedCell || info.element.contains(candidateTarget));
        if (!cell) continue;
        if (!best || model.confidence > best.model.confidence) best = { model, cell };
      }

      if (!best) continue;

      const colPath = genericGridColumnPathForCell(best.model, best.cell);
      const rowPath = genericGridRowPathForCell(best.model, best.cell);
      const rowContextMap = buildRowContextMap(rowPath, null, { clickedColIndex: best.cell.colIndex ?? best.cell.visualColIndex ?? 999, minScore: 0 });
      const rowCells = best.model.cells
        .filter((candidate) =>
          candidate !== best.cell &&
          sameGenericGridRow(candidate, best.cell) &&
          genericGridCellIsBefore(candidate, best.cell) &&
          (!candidate.isColumnHeader || candidate.isRowHeader)
        )
        .sort((a, b) => a.rect.left - b.rect.left);
      const rowCandidatePairs = rowCells.map((candidate, index) => {
        const keyPath = genericGridColumnPathForCell(best.model, candidate);
        return {
          key: keyPath[keyPath.length - 1] || `row_dim_${index + 1}`,
          value: candidate.value,
          colIndex: candidate.colIndex ?? candidate.visualColIndex ?? index,
          source: candidate.isRowHeader ? "row_header" : "left_cell"
        };
      });
      return {
        root: best.model,
        cell: best.cell.element,
        model: best.model,
        modelCell: best.cell,
        parser: best.model.parser,
        confidence: best.model.confidence,
        confidenceReasons: best.model.confidence_reasons,
        captureStatus: best.model.confidence >= 0.82 ? "complete" : "partial",
        clickedValue: best.cell.value,
        rowIndex: best.cell.rowIndex ?? best.cell.visualRowIndex,
        colIndex: best.cell.colIndex ?? best.cell.visualColIndex,
        rowPath,
        rowLabel: rowPath.join(" > ") || null,
        rowContextMap,
        rowCandidatePairs,
        colPath,
        colLabel: colPath.join(" > ") || null
      };
    }
    return null;
  }

  function buildTableHeaderPaths(table) {
    const headRows = [...table.querySelectorAll("thead tr")];
    if (headRows.length === 0) return [];

    const matrix = [];
    let maxCols = 0;

    for (let rowIndex = 0; rowIndex < headRows.length; rowIndex += 1) {
      const row = headRows[rowIndex];
      matrix[rowIndex] ||= [];
      let colCursor = 0;

      for (const cell of row.children) {
        while (matrix[rowIndex][colCursor]) colCursor += 1;

        const label = visibleTextOf(cell) || textOf(cell);
        const colSpan = Number(cell.getAttribute("colspan") || 1);
        const rowSpan = Number(cell.getAttribute("rowspan") || 1);

        for (let r = 0; r < rowSpan; r += 1) {
          matrix[rowIndex + r] ||= [];
          for (let c = 0; c < colSpan; c += 1) {
            matrix[rowIndex + r][colCursor + c] = label || null;
          }
        }

        colCursor += colSpan;
      }

      maxCols = Math.max(maxCols, matrix[rowIndex].length);
    }

    return Array.from({ length: maxCols }, (_, col) => {
      const parts = [];
      for (let row = 0; row < matrix.length; row += 1) {
        const label = matrix[row]?.[col] || null;
        if (label && parts[parts.length - 1] !== label) {
          parts.push(label);
        }
      }
      return parts;
    });
  }

  function buildGenericTableRows(table, headerPaths) {
    return [...table.querySelectorAll("tbody tr")].slice(0, 10).map((row, rowIndex) => {
      let colCursor = 0;

      return [...row.querySelectorAll("td, th")].map((cell) => {
        const colSpan = Number(cell.getAttribute("colspan") || 1);
        const colPath = headerPaths[colCursor] || [];
        const columnLabel = colPath.join(" > ") || `col_${colCursor + 1}`;
        const value = sanitizeGridValue(visibleTextOf(cell) || textOf(cell), columnLabel, cell);
        const entry = value ? {
          label: columnLabel,
          value,
          selector: cssPath(cell),
          row_index: rowIndex,
          col_index: colCursor,
          col_path: colPath
        } : null;

        colCursor += Math.max(colSpan, 1);
        return entry;
      }).filter(Boolean);
    }).filter((row) => row.length > 0);
  }

  function tableColumnPathCandidates(table, cell, colIndex, headerPaths) {
    const candidates = [];
    const headerPath = normalizePathParts(headerPaths[colIndex] || []);
    if (headerPath.length > 0) {
      candidates.push({ path: headerPath, source: "html_thead", score: 5 });
    }

    const headersAttr = String(cell.getAttribute("headers") || "").trim();
    if (headersAttr) {
      const headerParts = headersAttr
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((header) => header instanceof Element)
        .map((header) => cleanMenuLabel(visibleTextOf(header) || textOf(header) || ""))
        .filter(Boolean);
      if (headerParts.length > 0) {
        candidates.push({ path: headerParts, source: "headers_attr", score: 4 });
      }
    }

    const rows = [...table.querySelectorAll("tr")];
    const sameColumnHeaders = rows
      .map((row) => [...row.children][colIndex] || null)
      .filter((candidate) => candidate instanceof Element && candidate.tagName === "TH")
      .map((candidate) => cleanMenuLabel(visibleTextOf(candidate) || textOf(candidate) || ""))
      .filter(Boolean);
    if (sameColumnHeaders.length > 0) {
      candidates.push({
        path: dedupeOrderedParts([sameColumnHeaders[0]]),
        source: "same_column_th",
        score: 3
      });
    }

    const firstRow = rows[0] || null;
    const firstRowCell = firstRow ? [...firstRow.children][colIndex] || null : null;
    const firstRowLabel = cleanMenuLabel(firstRowCell ? (visibleTextOf(firstRowCell) || textOf(firstRowCell) || "") : "");
    if (firstRowLabel) {
      candidates.push({
        path: [firstRowLabel],
        source: "top_row_fallback",
        score: 2
      });
    }

    const attrLabel = cleanMenuLabel(cell.getAttribute("aria-label") || cell.getAttribute("data-label") || cell.getAttribute("title") || "");
    if (attrLabel) {
      candidates.push({
        path: [attrLabel],
        source: "cell_attr_fallback",
        score: 1
      });
    }

    candidates.push({
      path: [`col_${colIndex + 1}`],
      source: "indexed_column",
      score: 1
    });

    return candidates
      .map((candidate) => ({
        ...candidate,
        path: normalizePathParts(candidate.path),
        score: scoreColumnPathCandidate(candidate)
      }))
      .filter((candidate) => candidate.path.length > 0 && candidate.score > -999)
      .sort((a, b) => b.score - a.score || b.path.length - a.path.length)
      .slice(0, 6);
  }

  function resolveTableCellContext(target) {
    const cell = target.closest("td, th");
    const table = cell?.closest("table");
    if (!cell || !table) return null;

    const headerPaths = buildTableHeaderPaths(table);
    const row = cell.parentElement;
    if (!row) return null;
    const tableDisposition = classifyTableGridRole(table, cell);
    const siblingRows = row.parentElement
      ? [...row.parentElement.children].filter((node) => node.tagName === "TR")
      : [];
    const rowIndex = siblingRows.indexOf(row);
    const rowParts = [];
    const rowContextMap = {};
    const rowCandidatePairs = [];
    let rowContextCursor = 0;
    const scopedRowHeader = row.querySelector("th[scope='row']");
    if (scopedRowHeader instanceof Element) {
      const scopedLabel = visibleTextOf(scopedRowHeader) || textOf(scopedRowHeader);
      if (scopedLabel) {
        rowParts.push(scopedLabel);
        rowContextMap.row_header = scopedLabel;
        rowCandidatePairs.push({
          key: "row_header",
          value: scopedLabel,
          colIndex: 0,
          source: "row_scope_header"
        });
      }
    }
    for (const sibling of row.children) {
      if (sibling === cell) break;
      const value = visibleTextOf(sibling) || textOf(sibling);
      if (!value) {
        rowContextCursor += Math.max(Number(sibling.getAttribute("colspan") || 1), 1);
        continue;
      }
      const headerKey = headerPaths[rowContextCursor]?.slice(-1)?.[0] || `row_dim_${Object.keys(rowContextMap).length + 1}`;
      const dimScore = scoreRowDimensionCandidate(headerKey, value, rowContextCursor, 999);
      rowCandidatePairs.push({
        key: headerKey,
        value,
        colIndex: rowContextCursor,
        source: sibling.tagName === "TH" ? "row_header" : "left_cell"
      });
      if (sibling.tagName === "TH" || dimScore >= 2 || (!looksNumericLikeText(value) && rowContextCursor <= 2)) {
        rowParts.push(value);
        rowContextMap[headerKey] = value;
      }
      rowContextCursor += Math.max(Number(sibling.getAttribute("colspan") || 1), 1);
    }
    if (rowCandidatePairs.length === 0) {
      [...row.children].slice(0, 2).forEach((sibling, index) => {
        const value = visibleTextOf(sibling) || textOf(sibling);
        if (!value || looksNumericLikeText(value)) return;
        rowCandidatePairs.push({
          key: `row_dim_${index + 1}`,
          value,
          colIndex: index,
          source: "first_columns_fallback"
        });
        rowParts.push(value);
        rowContextMap[`row_dim_${index + 1}`] = value;
      });
    }
    const rowPath = dedupeOrderedParts(rowParts);

    let colCursor = 0;
    for (const sibling of row.children) {
      if (sibling === cell) break;
      colCursor += Math.max(Number(sibling.getAttribute("colspan") || 1), 1);
    }

    const columnPathCandidates = tableColumnPathCandidates(table, cell, colCursor, headerPaths);
    const bestColumnCandidate = columnPathCandidates[0] || null;
    const colPath = bestColumnCandidate?.path || headerPaths[colCursor] || [`col_${colCursor + 1}`];
    const value = visibleTextOf(cell) || textOf(cell);
    const warnings = [];
    if (bestColumnCandidate?.source && !["html_thead", "headers_attr", "same_column_th"].includes(bestColumnCandidate.source)) {
      warnings.push("column_path_fallback");
    }
    warnings.push(...(tableDisposition.warnings || []));

    return {
      root: table,
      cell,
      clickedValue: value,
      rowIndex: rowIndex >= 0 ? rowIndex : null,
      rowPath,
      rowLabel: rowPath.join(" > ") || null,
      rowContextMap: Object.keys(rowContextMap).length > 0 ? rowContextMap : null,
      rowCandidatePairs,
      colIndex: colCursor,
      colPath,
      colLabel: colPath.join(" > ") || null,
      columnPathSource: bestColumnCandidate?.source || "indexed_column",
      columnPathCandidates,
      headerPaths,
      dataGridScore: tableDisposition.score,
      promoted: tableDisposition.promoted,
      candidate_only: tableDisposition.candidate_only,
      grid_role: tableDisposition.grid_role,
      captureStatus: tableDisposition.capture_status,
      tableConfidence: tableDisposition.confidence,
      warnings
    };
  }

  function treeItemLabel(treeItem) {
    if (!(treeItem instanceof Element)) return null;
    return extractMenuItemLabel(treeItem);
  }

  function resolveAriaTreePath(item) {
    const path = [];
    let current = item;

    while (current) {
      const label = treeItemLabel(current);
      if (label) path.unshift(label);

      let parent = current.parentElement;
      let next = null;
      while (parent) {
        if (parent.getAttribute?.("role") === "treeitem") {
          next = parent;
          break;
        }
        parent = parent.parentElement;
      }
      current = next;
    }

    return {
      item,
      source: "tree",
      label: path[path.length - 1] || null,
      path,
      pathText: path.join(" > ") || null,
      parser: "aria_tree",
      score: 10,
      confidence: 0.95,
      captureStatus: "complete"
    };
  }

  function genericTreeMarkerText(el) {
    if (!(el instanceof Element)) return "";
    return `${el.id || ""} ${classTextOf(el)} ${el.getAttribute("role") || ""}`;
  }

  function hasGenericTreeMarker(el) {
    if (!(el instanceof Element)) return false;
    const role = el.getAttribute("role");
    if (role === "tree" || role === "treeitem") return true;
    return /(?:^|[\s_.:-])(tree|folder|program|sitemap|explorer)(?:$|[\s_.:-])/i.test(genericTreeMarkerText(el));
  }

  function hasTreeSelectedHint(el) {
    if (!(el instanceof Element)) return false;
    if (el.getAttribute("aria-selected") === "true") return true;
    return /(?:^|[\s_.:-])(selected|active|current|checked)(?:$|[\s_.:-])/i.test(`${el.id || ""} ${classTextOf(el)}`);
  }

  function genericTreeItemSelector() {
    return [
      '[role="treeitem"]',
      'li',
      '.tree-node',
      '.tree-item',
      '.folder-node',
      '.folder-item',
      '.menu-item',
      '.menu-node',
      '[data-level]',
      '[data-tree-level]',
      '[data-depth]',
      '[aria-level]'
    ].join(",");
  }

  function looksLikeGenericTreeItemElement(el) {
    if (!(el instanceof Element)) return false;
    if (el.matches?.(".tree-row, .row, .tree-item-row, .label, .tree-label, .tree-text, .node-label, .item-label, .cl-text, .cl-control, svg, path, icon, i, .icon, .expander, .toggle")) {
      return false;
    }
    const role = el.getAttribute("role");
    if (role === "treeitem") return true;
    if (el.tagName === "LI") return true;
    if (readNumericAttr(el, ["aria-level", "data-level", "data-tree-level", "data-depth"]) != null) return true;
    return /(?:^|[\s_.:-])(tree-item|tree-node|folder-item|folder-node|menu-item|menu-node)(?:$|[\s_.:-])/i.test(genericTreeMarkerText(el));
  }

  function isGenericTreeItemCandidate(el, root) {
    if (!(el instanceof Element) || el === root) return false;
    return looksLikeGenericTreeItemElement(el);
  }

  function findGenericTreeParentItem(item, root) {
    let parent = item.parentElement;
    while (parent && parent !== root) {
      if (isGenericTreeItemCandidate(parent, root)) return parent;
      parent = parent.parentElement;
    }
    return null;
  }

  function genericTreeItemInfo(item, root) {
    if (!isGenericTreeItemCandidate(item, root)) return null;
    const label = treeItemLabel(item);
    if (!label) return null;

    const rect = item.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;

    const style = window.getComputedStyle(item);
    const rootRect = root.getBoundingClientRect();
    const levelHint = readNumericAttr(item, ["aria-level", "data-level", "data-tree-level", "data-depth"]);
    const parentItem = findGenericTreeParentItem(item, root);
    const labelNode = item.querySelector(":scope > .tree-row, :scope > .row, :scope > .tree-item-row, :scope > .label, :scope > .cl-text, :scope > .cl-control .cl-text, :scope > .tree-label, :scope > .tree-text, :scope > .node-label, :scope > .item-label, :scope > .tree-row > .label, :scope > .tree-row > .cl-text, :scope > .tree-row > .tree-label, :scope > .tree-row > .tree-text, :scope > .tree-row > .node-label, :scope > .tree-row > .item-label");

    return {
      element: item,
      label,
      role: item.getAttribute("role") || null,
      selected: hasTreeSelectedHint(item),
      levelHint,
      parentItem,
      hasLabelNode: Boolean(labelNode || item.getAttribute("data-label")),
      indent: Math.round((rect.left - rootRect.left) + parsePixel(style.marginLeft) + parsePixel(style.paddingLeft)),
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      level: null,
      path: null
    };
  }

  function buildGenericTreeRootPrefix(root) {
    if (!(root instanceof Element)) return [];
    const parts = [];
    let current = root;
    while (current && current !== document.documentElement) {
      if (looksLikeGenericTreeItemElement(current)) {
        const label = treeItemLabel(current);
        if (label) parts.unshift(label);
      }
      current = current.parentElement?.closest?.(genericTreeItemSelector()) || null;
    }
    return dedupeOrderedParts(parts);
  }

  function scoreTreeRootCandidate(root, target) {
    if (!(root instanceof Element)) return { score: -999, reasons: ["invalid_root"] };
    let score = 0;
    const reasons = [];
    if (root.getAttribute("role") === "tree") {
      score += 5;
      reasons.push("role_tree");
    }
    if (hasGenericTreeMarker(root)) {
      score += 2;
      reasons.push("tree_marker");
    }
    const itemCount = root.querySelectorAll(genericTreeItemSelector()).length;
    if (itemCount >= 3) {
      score += 3;
      reasons.push("repeated_items");
    } else {
      score -= 3;
      reasons.push("few_items");
    }
    if (root.querySelector("[aria-expanded], .expanded, .open, [data-level], [aria-level]")) {
      score += 2;
      reasons.push("hierarchy_hints");
    }
    if (root.querySelector("[aria-selected='true'], .selected, .active, .current")) {
      score += 4;
      reasons.push("selected_hint");
    }
    let distance = 0;
    let current = target instanceof Element ? target : null;
    while (current && current !== root && current !== document.documentElement) {
      distance += 1;
      current = current.parentElement;
    }
    if (current === root) {
      if (distance <= 2) {
        score += 4;
        reasons.push("near_target");
      } else if (distance <= 5) {
        score += 2;
        reasons.push("contains_target");
      } else {
        score -= 1;
        reasons.push("distant_target");
      }
    }
    if (root === document.body || root === document.documentElement) {
      score -= 5;
      reasons.push("too_broad_root");
    }
    const textLength = String(root.textContent || "").replace(/\s+/g, " ").trim().length;
    if (textLength > 800) {
      score -= 4;
      reasons.push("excessive_text");
    }
    return { score, reasons, itemCount };
  }

  function chooseBestTreeRootCandidate(candidates, target) {
    return (Array.isArray(candidates) ? candidates : [])
      .map((root) => ({ root, ...scoreTreeRootCandidate(root, target) }))
      .filter((candidate) => candidate.score > -999)
      .sort((a, b) =>
        (Number(b.score || 0) - Number(a.score || 0)) ||
        (Number(b.itemCount || 0) - Number(a.itemCount || 0))
      );
  }

  function assignGenericTreeLevels(items) {
    const indentGroups = [];
    for (const item of [...items].sort((a, b) => a.indent - b.indent)) {
      let groupIndex = indentGroups.findIndex((group) => Math.abs(group - item.indent) <= 8);
      if (groupIndex < 0) {
        indentGroups.push(item.indent);
        groupIndex = indentGroups.length - 1;
      }
      item.indentLevel = groupIndex + 1;
    }

    const itemMap = new Map(items.map((item) => [item.element, item]));
    for (const item of items) {
      let domDepth = 1;
      let current = itemMap.get(item.parentItem) || null;
      while (current) {
        domDepth += 1;
        current = itemMap.get(current.parentItem) || null;
      }
      item.domDepth = domDepth;
      item.level = Math.max(
        item.levelHint || 1,
        domDepth,
        indentGroups.length > 1 ? item.indentLevel : 1
      );
    }

    const stack = [];
    for (const item of [...items].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
      stack[item.level - 1] = item.label;
      stack.length = item.level;
      item.path = stack.filter(Boolean).slice();
    }

    return indentGroups.length;
  }

  function scoreGenericTreeRoot(root, items, indentGroupCount) {
    const nestedCount = items.filter((item) => item.parentItem).length;
    const explicitLevelCount = items.filter((item) => item.levelHint != null).length;
    const selectedCount = items.filter((item) => item.selected).length;
    const labelNodeCount = items.filter((item) => item.hasLabelNode).length;
    const reasons = [];
    let confidence = 0;

    if (hasGenericTreeMarker(root)) {
      confidence += 0.18;
      reasons.push("root_marker");
    }
    if (items.length >= 3) {
      confidence += 0.24;
      reasons.push("repeated_items");
    }
    if (nestedCount > 0 || items.some((item) => item.level > 1)) {
      confidence += 0.22;
      reasons.push("hierarchy");
    }
    if (explicitLevelCount > 0 || indentGroupCount > 1) {
      confidence += 0.18;
      reasons.push("level_hints");
    }
    if (selectedCount > 0) {
      confidence += 0.10;
      reasons.push("selected_hints");
    }
    if (labelNodeCount > 0 || items.some((item) => directTextOf(item.element))) {
      confidence += 0.08;
      reasons.push("label_hints");
    }

    return {
      confidence: Math.min(Number(confidence.toFixed(2)), 0.95),
      reasons
    };
  }

  function buildGenericTreeModel(root) {
    if (!(root instanceof Element) || root.getAttribute("role") === "tree") return null;
    const items = [...new Set([...root.querySelectorAll(genericTreeItemSelector())])]
      .map((item) => genericTreeItemInfo(item, root))
      .filter(Boolean);
    if (items.length < 2) return null;

    const indentGroupCount = assignGenericTreeLevels(items);
    const rootPathPrefix = buildGenericTreeRootPrefix(root);
    if (rootPathPrefix.length > 0) {
      for (const item of items) {
        item.path = dedupeOrderedParts([
          ...rootPathPrefix,
          ...(Array.isArray(item.path) ? item.path : [])
        ]);
      }
    }
    const score = scoreGenericTreeRoot(root, items, indentGroupCount);
    if (score.confidence < GENERIC_TREE_MIN_CONFIDENCE) return null;

    return {
      kind: "tree",
      id: root.id || null,
      selector: cssPath(root),
      parser: "generic_dom_tree",
      confidence: score.confidence,
      confidence_reasons: score.reasons,
      items,
      selected_items: items
        .filter((item) => item.selected)
        .slice(0, 10)
        .map((item) => ({
          selector: cssPath(item.element),
          selected_label: item.label,
          selected_path: item.path || [item.label],
          selected_path_text: (item.path || [item.label]).join(" > ") || null
      }))
    };
  }

  function getGenericTreeModel(root) {
    return readCachedStructureModel(genericTreeModelCache, root, buildGenericTreeModel);
  }

  function genericTreeCandidateRoots() {
    const selector = [
      '[id*="tree"]',
      '[id*="Tree"]',
      '[class*="tree"]',
      '[class*="Tree"]',
      '[id*="folder"]',
      '[id*="Folder"]',
      '[class*="folder"]',
      '[class*="Folder"]',
      '[id*="program"]',
      '[id*="Program"]',
      '[class*="program"]',
      '[class*="Program"]',
      '[id*="sitemap"]',
      '[class*="sitemap"]',
      '[id*="explorer"]',
      '[class*="explorer"]'
    ].join(",");
    return [...new Set([...document.querySelectorAll(selector)].filter((root) =>
      root instanceof Element &&
      root.getAttribute("role") !== "tree" &&
      hasGenericTreeMarker(root)
    ))];
  }

  function resolveGenericTreePath(target) {
    if (!(target instanceof Element)) return null;
    const clickedItem = target.closest(genericTreeItemSelector());
    if (!(clickedItem instanceof Element)) return null;

    const roots = [];
    let current = clickedItem;
    while (current && current !== document.documentElement && roots.length < 8) {
      if (hasGenericTreeMarker(current) && current.getAttribute("role") !== "tree") {
        roots.push(current);
      }
      current = current.parentElement;
    }
    if (roots.length === 0) {
      current = clickedItem.parentElement;
      while (current && current !== document.documentElement && roots.length < 3) {
        if (current.querySelectorAll(genericTreeItemSelector()).length >= 3) {
          roots.push(current);
        }
        current = current.parentElement;
      }
    }

    const rankedRoots = chooseBestTreeRootCandidate([...new Set(roots)], clickedItem);
    let best = null;
    for (const rootCandidate of rankedRoots) {
      const root = rootCandidate.root;
      const model = getGenericTreeModel(root);
      if (!model) continue;
      let item = model.items.find((candidate) => candidate.element === clickedItem);
      if (!item) {
        item = model.items
          .filter((candidate) => candidate.element.contains(target))
          .sort((a, b) => (b.path?.length || 1) - (a.path?.length || 1) || (b.level || 1) - (a.level || 1))[0] || null;
      }
      if (!item) continue;
      const itemPathLength = item.path?.length || 1;
      const bestPathLength = best?.item?.path?.length || 1;
      const shouldReplace =
        !best ||
        rootCandidate.score > (best.rootCandidate?.score ?? -999) ||
        (rootCandidate.score === (best.rootCandidate?.score ?? -999) && model.confidence > best.model.confidence) ||
        (rootCandidate.score === (best.rootCandidate?.score ?? -999) && model.confidence === best.model.confidence && itemPathLength > bestPathLength) ||
        (rootCandidate.score === (best.rootCandidate?.score ?? -999) && model.confidence === best.model.confidence && itemPathLength === bestPathLength && model.items.length > best.model.items.length);
      if (shouldReplace) best = { model, item, rootCandidate };
    }
    if (!best) return null;

    const path = best.item.path || [best.item.label];
    return {
      item: best.item.element,
      source: "tree",
      label: best.item.label,
      path,
      pathText: path.join(" > ") || null,
      parser: best.model.parser,
      score: Math.round((best.model.confidence || 0.7) * 10),
      confidence: best.model.confidence,
      confidenceReasons: best.model.confidence_reasons,
      captureStatus: best.model.confidence >= 0.78 ? "complete" : "partial"
    };
  }

  function resolveCprLevelMenuPath(target) {
    if (location.origin !== "http://211.109.22.33:8791" || !(target instanceof Element)) return null;
    const item = target.closest("[class*='cl-level-']");
    if (!(item instanceof Element)) return null;
    const levelMatch = classTextOf(item).match(/(?:^|\s)cl-level-(\d+)(?:\s|$)/i);
    if (!levelMatch) return null;
    const level = Number(levelMatch[1]);
    if (!Number.isInteger(level) || level < 1 || level > 12) return null;

    const labelNode = target.closest(".cl-text") ||
      item.querySelector(":scope > .cl-text, :scope > .cl-control > .cl-text, .cl-text");
    const label = cleanMenuLabel(visibleTextOf(labelNode) || extractMenuItemLabel(item));
    if (!shouldUseMenuLabel(label)) return null;

    const prefix = activeCprDomMenuPath.slice(0, level - 1);
    const parentComplete = level === 1 ||
      (prefix.length === level - 1 && prefix.every(Boolean));
    activeCprDomMenuPath = prefix;
    activeCprDomMenuPath[level - 1] = label;
    activeCprDomMenuPath.length = level;
    const path = [...activeCprTopMenuPath, ...activeCprDomMenuPath.filter(Boolean)];

    return {
      item,
      source: "tree",
      label,
      path,
      pathText: path.join(" > ") || null,
      parser: "cpr_level_dom",
      score: parentComplete ? 12 : 8,
      confidence: parentComplete ? 0.99 : 0.68,
      depth: path.length,
      captureStatus: parentComplete ? "complete" : "partial",
      confidenceReasons: ["cpr_level_class", "click_sequence"],
      warnings: parentComplete ? [] : ["cpr_parent_path_missing"]
    };
  }

  function resolveCprTopNavigationPath(target) {
    if (location.origin !== "http://211.109.22.33:8791" || !(target instanceof Element)) return null;
    const item = target.closest(".cl-navigationbar-item[role='menuitem']");
    if (!(item instanceof Element)) return null;
    const labelNode = target.closest(".cl-navigationbar-text,.cl-text") || item.querySelector(".cl-navigationbar-text,.cl-text");
    const label = cleanMenuLabel(visibleTextOf(labelNode) || extractMenuItemLabel(item));
    if (!shouldUseMenuLabel(label)) return null;
    activeCprTopMenuPath = [label];
    activeCprDomMenuPath = [];
    return {
      item,
      source: "tree",
      label,
      path: [...activeCprTopMenuPath],
      pathText: label,
      parser: "cpr_navigationbar_dom",
      score: 12,
      confidence: 0.99,
      depth: 1,
      captureStatus: "complete",
      confidenceReasons: ["cpr_navigationbar_item", "click_sequence"],
      warnings: []
    };
  }

  function resolveTreePath(target) {
    if (!(target instanceof Element)) return null;
    const cprTopItem = resolveCprTopNavigationPath(target);
    if (cprTopItem) return cprTopItem;
    const cprItem = resolveCprLevelMenuPath(target);
    if (cprItem) return cprItem;
    const ariaItem = target.closest('[role="treeitem"]');
    if (ariaItem) return resolveAriaTreePath(ariaItem);
    return resolveGenericTreePath(target);
  }

  function structuredAriaTrees() {
    return [...document.querySelectorAll('[role="tree"]')].slice(0, 4).map((tree, treeIndex) => {
      const selectedItems = [...tree.querySelectorAll('[role="treeitem"][aria-selected="true"]')].slice(0, 10)
        .map((item) => {
          const resolved = resolveAriaTreePath(item);
          return resolved ? {
            selector: cssPath(item),
            selected_label: resolved.label,
            selected_path: resolved.path,
            selected_path_text: resolved.pathText
          } : null;
        })
        .filter(Boolean);

      return {
        kind: "tree",
        tree_index: treeIndex,
        id: tree.id || null,
        selector: cssPath(tree),
        parser: "aria_tree",
        confidence: 0.95,
        selected_items: selectedItems
      };
    }).filter((item) => item.selected_items.length > 0);
  }

  function structuredGenericTrees() {
    return genericTreeCandidateRoots()
      .map((root) => getGenericTreeModel(root))
      .filter(Boolean)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 4)
      .map((tree, treeIndex) => ({
        kind: tree.kind,
        tree_index: treeIndex,
        id: tree.id,
        selector: tree.selector,
        parser: tree.parser,
        confidence: tree.confidence,
        confidence_reasons: tree.confidence_reasons,
        selected_items: tree.selected_items
      }))
      .filter((tree) => tree.selected_items.length > 0);
  }

  function structuredTrees() {
    return [...structuredAriaTrees(), ...structuredGenericTrees()].slice(0, 8);
  }

  function structuredTables() {
    return [...document.querySelectorAll("table")].slice(0, 4).map((table, tableIndex) => {
      const headerPaths = buildTableHeaderPaths(table);
      const headers = headerPaths.map((parts) => parts.join(" > ")).filter(Boolean);
      const isWebSquareTable =
        /_body_table$/.test(table.id || "") &&
        (table.id || "").includes("gridView");

      const webSquareRows = isWebSquareTable ? buildWebSquareRows(table, headers) : null;
      const rows = webSquareRows
        ? webSquareRows.slice(0, 10).map((row) => row.cells)
        : buildGenericTableRows(table, headerPaths);

      return {
        kind: "table",
        framework: webSquareRows ? "websquare_gridview" : null,
        table_index: tableIndex,
        id: table.id || null,
        selector: cssPath(table),
        headers,
        header_paths: headerPaths,
        rows
      };
    }).filter((item) => item.rows.length > 0);
  }

  function structuredAriaGrids() {
    return [...document.querySelectorAll('[role="grid"]')].slice(0, 4).map((grid, gridIndex) => {
      const headers = [...grid.querySelectorAll('[role="columnheader"]')].map((cell) => visibleTextOf(cell)).filter(Boolean);
      const rows = [...grid.querySelectorAll('[role="row"]')].slice(1, 10).map((row) => {
        return [...row.querySelectorAll('[role="gridcell"], [role="cell"]')].map((cell, index) => ({
          label: headers[index] || `col_${index + 1}`,
          value: sanitizeGridValue(visibleTextOf(cell) || textOf(cell), headers[index] || `col_${index + 1}`, cell),
          row_index: cell.getAttribute("data-row-index") || null,
          col_id: cell.getAttribute("data-col-id") || null,
          selector: cssPath(cell)
        })).filter((item) => item.value);
      }).filter((row) => row.length > 0);

      return {
        kind: "aria_grid",
        grid_index: gridIndex,
        id: grid.id || null,
        selector: cssPath(grid),
        headers,
        rows
      };
    }).filter((item) => item.rows.length > 0);
  }

  function resolveAriaGridCellContext(target, event = null) {
    if (!(target instanceof Element)) return null;
    const candidateTargets = [];
    const addCandidate = (candidate) => {
      if (candidate instanceof Element && !candidateTargets.includes(candidate)) {
        candidateTargets.push(candidate);
      }
    };
    addCandidate(target);
    if (typeof event?.composedPath === "function") {
      for (const candidate of event.composedPath()) addCandidate(candidate);
    }
    if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
      for (const candidate of document.elementsFromPoint(event.clientX, event.clientY)) {
        addCandidate(candidate);
      }
    }

    for (const candidateTarget of candidateTargets) {
      const cell = candidateTarget.closest('[role="gridcell"], [role="cell"], [role="columnheader"], [role="rowheader"]');
      const root = cell?.closest?.('[role="grid"]');
      if (!(cell instanceof Element) || !(root instanceof Element)) continue;

      const row = cell.closest('[role="row"]');
      const rows = [...root.querySelectorAll('[role="row"]')];
      const rowIndex = row ? Math.max(0, rows.indexOf(row) - 1) : null;
      const cellsInRow = row
        ? [...row.querySelectorAll('[role="rowheader"], [role="gridcell"], [role="cell"]')]
        : [];
      const clickedColIndex = cellsInRow.indexOf(cell);
      const headers = [...root.querySelectorAll('[role="columnheader"]')]
        .map((header) => cleanMenuLabel(visibleTextOf(header) || textOf(header) || ""))
        .filter(Boolean);
      const colPath = headers[clickedColIndex] ? [headers[clickedColIndex]] : [];
      const rowPairs = cellsInRow
        .slice(0, Math.max(0, clickedColIndex))
        .map((candidate, index) => ({
          key: headers[index] || `row_dim_${index + 1}`,
          value: visibleTextOf(candidate) || textOf(candidate),
          colIndex: index,
          source: candidate.getAttribute("role") === "rowheader" ? "row_header" : "left_cell"
        }))
        .filter((entry) => entry.value);
      const rowPath = rowPairs
        .filter((entry) => !looksNumericLikeText(entry.value))
        .map((entry) => entry.value);

      return {
        root,
        cell,
        parser: "aria_grid",
        confidence: 0.84,
        confidenceReasons: ["aria_roles", "column_headers"],
        captureStatus: headers.length > 0 ? "complete" : "partial",
        clickedValue: visibleTextOf(cell) || textOf(cell) || null,
        rowIndex,
        colIndex: clickedColIndex >= 0 ? clickedColIndex : null,
        rowPath,
        rowLabel: rowPath.join(" > ") || null,
        rowContextMap: buildRowContextMap(rowPath, rowPairs.map((entry) => entry.key), { clickedColIndex, minScore: 0 }),
        rowCandidatePairs: rowPairs,
        colPath,
        colLabel: colPath.join(" > ") || null
      };
    }
    return null;
  }

  function buildAdapterGridCandidate(adapter, context, options = {}) {
    if (!adapter || !context) return null;
    return {
      kind: "adapter",
      source: context.source || `${adapter.name}_adapter`,
      parser: context.parser || `${adapter.name}_adapter`,
      root: options.root || gridAdapterRootHint(options.target || null),
      context,
      aliases: {
        promoted: context.promoted ?? false,
        candidate_only: context.candidate_only ?? true,
        grid_role: context.grid_role || "unknown",
        capture_status: context.capture_status || context.captureStatus || "partial"
      },
      score: Number(options.score ?? adapter.priority ?? 0),
      confidence: context.confidence?.grid ?? context.confidence ?? Number(options.confidence ?? 0.35),
      warnings: normalizeWarningList([
        ...(context.warnings || []),
        ...(options.warnings || [])
      ]),
      adapter_name: adapter.name,
      cacheKey: options.cacheKey || null,
      request: options.request || null
    };
  }

  function resolveGridContextWithAdapters(target, event, baseContext = {}) {
    const adapterSelections = selectCandidateGridAdapters(target, event);
    const candidates = [];
    const pendingRequests = [];
    const adapterCandidates = [];

    for (const adapter of adapterSelections) {
      const outcome = tryResolveGridAdapterWithinBudget(adapter, target, event, baseContext);
      if (!outcome) continue;

      if (outcome.status === "cache_hit" && outcome.result) {
        const cachedContext = normalizeAdapterGridContext(adapter.name, outcome.result);
        if (cachedContext) {
          const candidate = buildAdapterGridCandidate(adapter, cachedContext, {
            target,
            cacheKey: outcome.cacheKey,
            score: Math.max(8, Number(adapter.priority || 0)),
            confidence: cachedContext.confidence?.grid ?? 0.95
          });
          if (candidate) {
            candidates.push(candidate);
            adapterCandidates.push(adapterDebugCandidate(adapter, {
              result: candidate.context,
              score: candidate.score
            }));
          }
          continue;
        }
      }

      if (outcome.status === "resolved" && outcome.result) {
        const immediateContext = outcome.result.gridContext
          ? outcome.result.gridContext
          : normalizeAdapterGridContext(adapter.name, outcome.result);
        if (immediateContext) {
          const candidate = buildAdapterGridCandidate(adapter, immediateContext, {
            target,
            cacheKey: outcome.cacheKey,
            score: immediateContext.capture_status === "complete" ? Math.max(9, Number(adapter.priority || 0)) : 4,
            confidence: immediateContext.confidence?.grid ?? 0.4,
            request: outcome.result.request || null
          });
          if (candidate) {
            candidates.push(candidate);
            adapterCandidates.push(adapterDebugCandidate(adapter, {
              gridContext: candidate.context,
              score: candidate.score
            }));
          }
        }
        if (outcome.result.request) {
          pendingRequests.push({
            ...outcome.result.request,
            adapterName: adapter.name,
            cacheKey: outcome.cacheKey,
            root: gridAdapterRootHint(target),
            targetHint: outcome.result.request.targetHint || buildAdapterTargetHint(target)
          });
        }
        continue;
      }

      adapterCandidates.push(adapterDebugCandidate(adapter, {
        status: outcome.status,
        warnings: outcome.warnings || [`${adapter.name}_adapter_${outcome.status}`],
        score: Math.max(0, Number(adapter.priority || 0) - 10)
      }));
    }

    return {
      candidates,
      adapterCandidates: limitCandidateList(adapterCandidates, MAX_CONTEXT_CANDIDATES),
      pendingRequests: pendingRequests.slice(0, MAX_CONTEXT_CANDIDATES)
    };
  }

  function attachAdapterCandidatesToGridContext(gridContext, adapterCandidates) {
    if (!gridContext || !Array.isArray(adapterCandidates) || adapterCandidates.length === 0) return gridContext;
    return {
      ...gridContext,
      adapter_candidates: limitCandidateList(adapterCandidates, MAX_CONTEXT_CANDIDATES)
    };
  }

  function dispatchPendingGridAdapterRequests(requests, row, element, correlationId) {
    for (const request of Array.isArray(requests) ? requests : []) {
      if (!request?.requestId || !request?.adapterName) continue;
      pendingGridAdapterRequests.set(request.requestId, {
        adapterName: request.adapterName,
        element: element || null,
        correlationId: correlationId || null,
        originalEventId: row?.event_id || null,
        originalInteractionId: row?.interaction_id || null,
        requestId: request.requestId,
        cacheKey: request.cacheKey || null,
        requestedAt: Date.now()
      });
      requestMainWorldState(request.kind || request.adapterName, request.requestId, {
        adapterName: request.adapterName,
        targetHint: request.targetHint || null,
        point: request.point || null,
        originalEventId: row?.event_id || null,
        originalInteractionId: row?.interaction_id || null
      });
    }
  }

  function emitGridContextEnrichmentRow(pending, normalizedContext) {
    if (!pending || !normalizedContext) return;
    if (pending.cacheKey) {
      writeGridAdapterCache(pending.cacheKey, normalizedContext);
    }
    const receivedAt = new Date().toISOString();
    const gridCellPayload = buildGridCellInteractionPayload(normalizedContext, {
      kind: "grid_cell_click",
      source: "grid_context_enrichment",
      relatedInteractionId: pending.originalInteractionId || null,
      relatedEventId: pending.originalEventId || null,
      originalInteractionId: pending.originalInteractionId || null,
      originalEventId: pending.originalEventId || null
    });
    const row = buildRow(pending.element || document.documentElement, "grid_context_enrichment", {
      eventTimeOverride: receivedAt,
      correlationId: pending.correlationId || null,
      relatedInteractionId: pending.originalInteractionId || null,
      gridContext: normalizedContext,
      payload: {
        kind: "grid_context_enrichment",
        related_interaction_id: pending.originalInteractionId || null,
        enrichment_context: {
          request_id: pending.requestId,
          adapter_name: pending.adapterName,
          original_event_id: pending.originalEventId || null,
          original_interaction_id: pending.originalInteractionId || null,
          requested_at: new Date(pending.requestedAt || Date.now()).toISOString(),
          received_at: receivedAt
        }
      },
      snapshot: captureSnapshot("click", {
        adapter_name: pending.adapterName,
        request_id: pending.requestId,
        original_interaction_id: pending.originalInteractionId || null
      })
    });
    const gridCellRow = gridCellPayload ? buildRow(pending.element || document.documentElement, "grid_cell_click", {
      eventTimeOverride: receivedAt,
      correlationId: pending.correlationId || null,
      relatedInteractionId: pending.originalInteractionId || null,
      gridContext: normalizedContext,
      elementText:
        gridCellPayload.cell_value != null
          ? String(gridCellPayload.cell_value)
          : gridCellPayload.column_label || gridCellPayload.column_key || gridCellPayload.grid_id || null,
      payload: gridCellPayload,
      snapshot: captureSnapshot("grid_cell_click", {
        grid_cell_click: gridCellPayload,
        grid_context: normalizedContext
      })
    }) : null;
    sendRows(gridCellRow ? [row, gridCellRow] : [row]);
  }

  function resolveGridContextCandidates(target, event = null, baseContext = {}) {
    const candidates = [];

    const nexacroContext = resolveNexacroPivotCellContext(target);
    if (nexacroContext) {
      candidates.push({
        kind: "nexacro",
        source: "nexacro_pivot",
        parser: nexacroContext.parser || "nexacro_pivot",
        root: nexacroContext.root,
        context: nexacroContext,
        rowPairs: nexacroContext.rowCandidatePairs,
        score: 10,
        confidence: nexacroContext.confidence ?? 0.95,
        warnings: []
      });
    }

    const ariaGridContext = resolveAriaGridCellContext(target, event);
    if (ariaGridContext) {
      candidates.push({
        kind: "aria",
        source: "aria_grid",
        parser: "aria_grid",
        root: ariaGridContext.root,
        context: ariaGridContext,
        rowPairs: ariaGridContext.rowCandidatePairs,
        score: 9,
        confidence: ariaGridContext.confidence ?? 0.84,
        warnings: []
      });
    }

    const tableContext = resolveTableCellContext(target);
    if (tableContext) {
      candidates.push({
        kind: "table",
        source: "html_table",
        parser: "html_table",
        root: tableContext.root,
        context: tableContext,
        rowPairs: tableContext.rowCandidatePairs,
        headerPaths: tableContext.headerPaths,
        aliases: {
          promoted: tableContext.promoted,
          candidate_only: tableContext.candidate_only,
          grid_role: tableContext.grid_role,
          capture_status: tableContext.captureStatus
        },
        score: Math.max(1, Number(tableContext.dataGridScore ?? 0) + (tableContext.promoted ? 2 : 0)),
        confidence: tableContext.tableConfidence ?? (tableContext.promoted ? 0.78 : 0.48),
        warnings: tableContext.warnings || []
      });
    }

    const genericContext = resolveGenericGridCellContext(target, event);
    if (genericContext) {
      candidates.push({
        kind: "generic",
        source: "generic_grid",
        parser: genericContext.parser || "generic_dom_grid",
        root: genericContext.root?.element || genericContext.root,
        model: genericContext.model || genericContext.root,
        modelCell: genericContext.modelCell || null,
        context: genericContext,
        rowPairs: genericContext.rowCandidatePairs,
        score: Math.round((genericContext.confidence || 0.7) * 10),
        confidence: genericContext.confidence ?? 0.72,
        warnings: []
      });
    }

    const adapterResolution = event ? resolveGridContextWithAdapters(target, event, baseContext) : {
      candidates: [],
      adapterCandidates: [],
      pendingRequests: []
    };
    candidates.push(...adapterResolution.candidates);

    const rankedCandidates = candidates
      .map((candidate) => ({
        ...candidate,
        normalized: normalizeGridCandidate(candidate)
      }))
      .filter((candidate) => candidate.normalized)
      .sort((a, b) =>
        (Number(b.score || 0) - Number(a.score || 0)) ||
        (Number((b.normalized?.confidence?.grid) || 0) - Number((a.normalized?.confidence?.grid) || 0))
      )
      .slice(0, 6);

    return {
      candidates: rankedCandidates,
      adapterCandidates: adapterResolution.adapterCandidates,
      pendingRequests: adapterResolution.pendingRequests
    };
  }

  function structuredCustomGrids() {
    const rowMap = new Map();
    for (const cell of document.querySelectorAll("[data-row-index][data-col-id]")) {
      const rowIndex = cell.getAttribute("data-row-index");
      const colId = cell.getAttribute("data-col-id");
      if (!rowIndex || !colId) continue;
      const row = rowMap.get(rowIndex) || [];
      const value = sanitizeGridValue(visibleTextOf(cell) || textOf(cell), colId, cell);
      if (value) {
        row.push({
          label: colId,
          value,
          selector: cssPath(cell)
        });
      }
      rowMap.set(rowIndex, row);
    }

    if (rowMap.size === 0) return [];

    return [{
      kind: "custom_grid",
      selector: cssPath(document.querySelector("#customOrderGrid") || document.body),
      rows: [...rowMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([rowIndex, cells]) => ({
        row_index: rowIndex,
        cells
      }))
    }];
  }

  function structuredCprDomGrids() {
    return [...document.querySelectorAll(".cl-grid[role='grid'], [role='grid'][class*='cl-grid']")]
      .filter(isVisibleCandidate)
      .slice(0, 20)
      .map((grid) => {
        const headers = [...grid.querySelectorAll("[role='columnheader']")]
          .slice(0, MAX_GRID_ROW_FIELDS)
          .map((header, index) => ({
            col_index: index,
            label: sanitizeStructuredValue(visibleTextOf(header) || textOf(header), { key: "column_label", element: header }),
            selector: cssPath(header)
          }));
        const rows = [...grid.querySelectorAll("[role='row']")]
          .filter((row) => row.querySelector("[role='gridcell'],[role='cell']"))
          .slice(0, 50)
          .map((row, rowIndex) => ({
            row_index: Number(row.getAttribute("aria-rowindex")) || rowIndex,
            selected: row.getAttribute("aria-selected") === "true" || row.classList.contains("cl-selected"),
            cells: [...row.querySelectorAll("[role='gridcell'],[role='cell']")]
              .slice(0, MAX_GRID_ROW_FIELDS)
              .map((cell, colIndex) => ({
                col_index: Number(cell.getAttribute("aria-colindex")) || colIndex,
                column_label: headers[colIndex]?.label || null,
                value: sanitizeGridValue(
                  visibleTextOf(cell) || textOf(cell),
                  headers[colIndex]?.label || `col_${colIndex + 1}`,
                  cell
                ),
                selector: cssPath(cell)
              }))
          }));
        return {
          kind: "cpr_dom_grid",
          framework: "exbuilder6",
          grid_id: grid.id || null,
          selector: cssPath(grid),
          headers,
          rows
        };
      });
  }

  function structuredPopups() {
    return visiblePopupRoots().map((root, index) => ({
      ...popupDescriptor(root, index + 1),
      controls: [...root.querySelectorAll("button,a,input,textarea,select,[role='button'],[role='textbox'],[role='combobox'],[role='grid']")]
        .filter(isVisibleCandidate)
        .slice(0, 80)
        .map((control) => ({
          tag: control.tagName?.toLowerCase() || null,
          role: control.getAttribute("role") || null,
          type: control.getAttribute("type") || null,
          label: sanitizeStructuredValue(
            control.getAttribute("aria-label") || visibleTextOf(control) || textOf(control),
            { key: "associated_label", element: control }
          ),
          checked: "checked" in control ? Boolean(control.checked) : null,
          selected: control.getAttribute("aria-selected") === "true",
          selector_css: cssPath(control),
          selector_xpath: xPath(control)
        }))
    }));
  }

  function structuredMessages() {
    return [...document.querySelectorAll('[role="status"], .toast, .alert')].slice(0, 8).map((node) => ({
      selector: cssPath(node),
      message: visibleTextOf(node) || textOf(node)
    })).filter((item) => item.message);
  }

  function buildStructuredSnapshot(trigger, extra) {
    return {
      kind: "structured_snapshot",
      version: 2,
      collector_build: COLLECTOR_BUILD,
      captured_at: new Date().toISOString(),
      page_url: location.href,
      page_title: document.title,
      trigger,
      snapshot: {
        tables: structuredTables(),
        nexacro_pivots: structuredNexacroPivots(),
        generic_grids: structuredGenericGrids(),
        aria_grids: structuredAriaGrids(),
        custom_grids: structuredCustomGrids(),
        cpr_dom_grids: structuredCprDomGrids(),
        trees: structuredTrees(),
        popups: structuredPopups(),
        messages: structuredMessages(),
        extra: extra || null
      }
    };
  }

  function buildCompactSnapshot(trigger, extra) {
    return {
      kind: "compact_snapshot",
      version: 1,
      collector_build: COLLECTOR_BUILD,
      captured_at: new Date().toISOString(),
      page_url: location.href,
      page_title: document.title,
      trigger,
      extra: extra || null
    };
  }

  function shouldCaptureFullSnapshot(trigger, extra) {
    if (extra?.force_full_snapshot) return true;
    if (FULL_SNAPSHOT_TRIGGERS.has(trigger)) return true;
    return false;
  }

  function captureSnapshot(trigger, extra) {
    if (!shouldCaptureFullSnapshot(trigger, extra)) {
      return LOW_COST_SNAPSHOT_TRIGGERS.has(trigger) ? buildCompactSnapshot(trigger, extra) : null;
    }

    const now = Date.now();
    if (structureCache && !structureCacheDirty && now - structureCacheUpdatedAt < STRUCTURE_CACHE_TTL_MS) {
      return {
        ...structureCache,
        captured_at: new Date().toISOString(),
        trigger,
        snapshot: {
          ...structureCache.snapshot,
          extra: extra || null
        }
      };
    }

    structureCache = buildStructuredSnapshot(trigger, extra);
    structureCacheDirty = false;
    structureCacheUpdatedAt = now;
    return structureCache;
  }

  function contentRowEventId(row) {
    if (!row || typeof row !== "object") return null;
    if (typeof row.event_id === "string" && row.event_id.trim()) return row.event_id.trim();
    return null;
  }

  function normalizeRowsForSend(rows) {
    const uniqueRows = [];
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row !== "object") continue;
      const eventId = contentRowEventId(row);
      const dedupeKey = eventId || `row:${uniqueRows.length}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      uniqueRows.push(row);
    }
    return uniqueRows;
  }

  function noteDroppedContentRows(count, reason) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    contentSendDroppedCount += numeric;
    contentSendLastDroppedAt = new Date().toISOString();
    console.warn("[Rainbow Collector] 페이지 이벤트 임시 큐 하드 한도 초과로 일부 row 제거", {
      "제거 row 수": numeric,
      "누적 제거 row 수": contentSendDroppedCount,
      "제거 이유": reason,
      "마지막 제거 시각": contentSendLastDroppedAt,
      "즉시 재전달 기준 row 수": CONTENT_SEND_URGENT_RETRY_ROWS,
      "소프트 최대 row 수": CONTENT_SEND_BUFFER_LIMIT,
      "하드 최대 row 수": CONTENT_SEND_HARD_BUFFER_LIMIT,
      "영향": "background로 넘기지 못한 오래된 이벤트 일부가 누락될 수 있음",
      "정상 기준": "이 로그는 자주 나오면 안 되며, 보통은 하드 한도 도달 전에 즉시 background로 다시 전달됩니다"
    });
  }

  function trimPendingContentRowsToLimit() {
    if (pendingContentRows.length <= CONTENT_SEND_HARD_BUFFER_LIMIT) return;
    const overflow = pendingContentRows.length - CONTENT_SEND_HARD_BUFFER_LIMIT;
    const droppedEntries = pendingContentRows.splice(0, overflow);
    for (const entry of droppedEntries) {
      const eventId = contentRowEventId(entry?.row);
      if (eventId) pendingContentRowIds.delete(eventId);
    }
    noteDroppedContentRows(droppedEntries.length, "content_send_buffer_overflow");
  }

  function enqueueContentRowsForRetry(rows, reason = "send_failed", retryCount = 0) {
    const queued = [];
    for (const row of normalizeRowsForSend(rows)) {
      const eventId = contentRowEventId(row);
      if (eventId && pendingContentRowIds.has(eventId)) continue;
      pendingContentRows.push({
        row,
        retryCount,
        reason,
        queuedAt: Date.now()
      });
      if (eventId) pendingContentRowIds.add(eventId);
      queued.push(row);
    }
    trimPendingContentRowsToLimit();
    if (pendingContentRows.length >= CONTENT_SEND_URGENT_RETRY_ROWS) {
      console.info("[Rainbow Collector] 페이지 이벤트 임시 큐가 많아져 즉시 background 재전달을 시작합니다", {
        "현재 대기 row 수": pendingContentRows.length,
        "즉시 재전달 기준 row 수": CONTENT_SEND_URGENT_RETRY_ROWS,
        "소프트 최대 row 수": CONTENT_SEND_BUFFER_LIMIT,
        "이유": "페이지 이벤트 임시 큐가 최대치에 가까워져 누락 위험을 줄이기 위해 바로 background로 다시 전달함"
      });
      scheduleContentRowsRetry(0);
    }
    return queued;
  }

  function scheduleContentRowsRetry(delayMs = CONTENT_SEND_RETRY_DELAY_MS) {
    if (contentSendRetryTimer) return;
    contentSendRetryTimer = setTimeout(() => {
      contentSendRetryTimer = null;
      void flushContentRowsRetry();
    }, Math.max(0, delayMs));
  }

  function takePendingContentRowsBatch(limit = CONTENT_SEND_MAX_BATCH_ROWS) {
    if (pendingContentRows.length === 0) return [];
    const batch = pendingContentRows.splice(0, Math.max(1, limit));
    for (const entry of batch) {
      const eventId = contentRowEventId(entry?.row);
      if (eventId) pendingContentRowIds.delete(eventId);
    }
    return batch;
  }

  function actionLabelForConsole(action) {
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

  function summarizeContentRowsForConsole(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const actionCounts = {};
    for (const row of list) {
      const action = row?.action || "unknown";
      const label = actionLabelForConsole(action);
      actionCounts[label] = (actionCounts[label] || 0) + 1;
    }

    const actions = new Set(list.map((row) => row?.action).filter(Boolean));
    let reason = "페이지에서 수집된 이벤트가 background 전송 큐로 넘어감";
    if (actions.has("api_transaction_timeout")) {
      reason = "Request 발생 후 제한 시간 안에 Response가 없어 timeout 이벤트가 생성됨";
    } else if (actions.has("api_transaction_error")) {
      reason = "Request/Response 처리 실패가 감지되어 실패 이벤트가 생성됨";
    } else if (actions.has("api_transaction")) {
      reason = "Request와 Response가 매칭되어 API transaction row가 생성됨";
    } else if (actions.has("submit")) {
      reason = "폼 제출이 발생해 API/화면 변화와 연결할 이벤트가 생성됨";
    } else if (actions.has("grid_cell_click") || actions.has("grid_row_select")) {
      reason = "그리드 행/셀 선택이 발생해 선택 행 구조와 후속 API 연결 이벤트가 생성됨";
    } else if (actions.has("popup_open") || actions.has("popup_close")) {
      reason = "팝업 열림/닫힘 lifecycle 이벤트가 생성됨";
    } else if (actions.has("click") || actions.has("canvas_click")) {
      reason = "사용자 클릭이 발생해 업무 흐름 시작점 이벤트가 생성됨";
    } else if (actions.has("change") || actions.has("input") || actions.has("keydown")) {
      reason = "입력값 변경 또는 키 입력이 발생해 입력 이벤트가 생성됨";
    } else if (actions.has("route_change")) {
      reason = "화면 경로 변경이 감지되어 route_change 이벤트가 생성됨";
    } else if (actions.has("page_view") || actions.has("collector_boot")) {
      reason = "페이지 진입 또는 수집기 시작 상태 기록 이벤트가 생성됨";
    }

    return {
      rowCount: list.length,
      reason,
      actionCounts,
      preview: list.slice(0, 5).map((row) => ({
        action: row?.action || null,
        label: actionLabelForConsole(row?.action),
        event_id: row?.event_id || null,
        page_url: row?.page_url || null,
        selector: row?.selector_css || row?.selector_xpath || null,
        api_url: row?.payload?.api_context?.url || null,
        status: row?.payload?.api_context?.status ?? null
      }))
    };
  }

  function debugLogCollectedRows(stage, rows) {
    if (!DEBUG_LOG_ALL_COLLECTED_ROWS) return;
    try {
      const rowCount = Array.isArray(rows) ? rows.length : 0;
      const summary = summarizeContentRowsForConsole(rows);
      console.groupCollapsed(`[Rainbow Collector] 페이지→백그라운드 rows=${rowCount} · ${summary.reason}`);
      console.log("요약", {
        "전송 단계": stage,
        "왜 넘어가나": summary.reason,
        "이벤트 종류별 개수": summary.actionCounts,
        "대표 이벤트": summary.preview,
        "retry 버퍼 상태": {
          "대기 row 수": pendingContentRows.length,
          "최대 대기 row 수": CONTENT_SEND_BUFFER_LIMIT,
          "전송 중 여부": contentSendInFlight
        }
      });
      console.log("원본 rows", rows);
      console.groupEnd();
    } catch (error) {
      console.log("[Rainbow Collector] 페이지 수집 rows", rows);
    }
  }

  function deliverRowsToBackground(rows) {
    const normalizedRows = normalizeRowsForSend(rows);
    if (normalizedRows.length === 0) return Promise.resolve({ ok: true, count: 0 });
    debugLogCollectedRows("content->background", normalizedRows);
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: "BATCH_ROWS", rows: normalizedRows }, (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || "runtime_last_error"));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "background_response_not_ok"));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function flushContentRowsRetry() {
    if (contentSendInFlight || pendingContentRows.length === 0) return;
    const entries = takePendingContentRowsBatch();
    if (entries.length === 0) return;

    contentSendInFlight = true;
    try {
      await deliverRowsToBackground(entries.map((entry) => entry.row));
    } catch (error) {
      const retryReason = error?.message || "background_retry_failed";
      const retryEntries = [];
      for (const entry of entries) {
        const nextRetryCount = Number(entry?.retryCount || 0) + 1;
        if (nextRetryCount >= CONTENT_SEND_MAX_RETRIES) {
          noteDroppedContentRows(1, retryReason);
          continue;
        }
        retryEntries.push({
          ...entry,
          retryCount: nextRetryCount,
          reason: retryReason,
          queuedAt: Date.now()
        });
      }
      if (retryEntries.length > 0) {
        for (let index = retryEntries.length - 1; index >= 0; index -= 1) {
          const entry = retryEntries[index];
          const eventId = contentRowEventId(entry.row);
          if (eventId && pendingContentRowIds.has(eventId)) continue;
          pendingContentRows.unshift(entry);
          if (eventId) pendingContentRowIds.add(eventId);
        }
        trimPendingContentRowsToLimit();
      }
      scheduleContentRowsRetry();
      return;
    } finally {
      contentSendInFlight = false;
    }

    if (pendingContentRows.length > 0) {
      scheduleContentRowsRetry(0);
    }
  }

  function sendRows(rows) {
    const normalizedRows = normalizeRowsForSend(rows).map(attachRuntimeContext);
    if (normalizedRows.length === 0) return;

    if (contentSendInFlight || pendingContentRows.length > 0) {
      const queued = enqueueContentRowsForRetry(normalizedRows, "buffered_while_retry_inflight");
      if (DEBUG_LOG_ALL_COLLECTED_ROWS && queued.length > 0) {
        console.info("[Rainbow Collector] background 전송 중이라 페이지 이벤트를 임시 큐에 보관", {
          "보관 이유": "이전 전송 또는 재시도 처리 중",
          "추가 보관 row 수": queued.length,
          "현재 대기 row 수": pendingContentRows.length
        });
      }
      scheduleContentRowsRetry(0);
      return;
    }

    void deliverRowsToBackground(normalizedRows).catch((error) => {
      const reason = error?.message || "background_send_failed";
      const queued = enqueueContentRowsForRetry(normalizedRows, reason);
      console.warn("[Rainbow Collector] background 전달 실패 · 페이지 이벤트를 임시 큐에 보관", {
        "실패 이유": reason,
        "보관 row 수": queued.length,
        "현재 대기 row 수": pendingContentRows.length,
        "다음 재시도 대기 ms": CONTENT_SEND_RETRY_DELAY_MS
      });
      scheduleContentRowsRetry();
    });
  }

  function isSensitiveReflectionTarget(el) {
    if (!(el instanceof Element)) return true;
    if (el instanceof HTMLInputElement) {
      const type = String(el.type || "").toLowerCase();
      if (["password", "hidden", "file"].includes(type)) return true;
    }
    const hint = fieldHintText(el);
    return /(password|passwd|pwd|secret|token|authorization|cookie|session|api[_-]?key|card|account|acct|ssn|주민|계좌|카드|비밀번호|암호)/i.test(hint);
  }

  function isValueReflectionTarget(el) {
    if (!isInputLikeElement(el)) return false;
    if (isSensitiveReflectionTarget(el)) return false;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      if (el.disabled || el.readOnly) return false;
    }
    return isVisibleCandidate(el);
  }

  function reflectionFingerprint(el) {
    if (!isValueReflectionTarget(el)) return null;
    const rawValue = controlValueOf(el);
    const text = rawValue === null || rawValue === undefined ? "" : String(rawValue);
    return {
      length: text.length,
      empty: text.length === 0,
      hash: simpleHashText(`${pageSessionId}:${text}`)
    };
  }

  function reflectionTargetLabel(el) {
    if (!(el instanceof Element)) return null;
    const direct = readStringAttr(el, ["aria-label", "title", "placeholder", "name", "id"]);
    if (direct) return sanitizeStructuredValue(direct, { key: "target_associated_label", element: el });
    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const labelText = visibleTextOf(label) || textOf(label);
        if (labelText) return sanitizeStructuredValue(labelText.slice(0, 160), { key: "target_associated_label", element: el });
      } catch {}
    }
    const parentLabel = el.closest?.("label");
    const parentText = visibleTextOf(parentLabel) || textOf(parentLabel);
    return parentText ? sanitizeStructuredValue(parentText.slice(0, 160), { key: "target_associated_label", element: el }) : null;
  }

  function queryValueReflectionTargets(sourceEl = null) {
    const roots = [];
    if (sourceEl instanceof Element) {
      const sourcePopup = closestPopupRoot(sourceEl);
      if (sourcePopup) roots.push(sourcePopup);
      const parentPopup = sourcePopup?.parentElement?.closest?.(POPUP_ROOT_SELECTOR) || null;
      if (parentPopup) roots.push(parentPopup);
    }
    roots.push(...visiblePopupRoots().slice().reverse(), document);

    const seen = new Set();
    const candidates = [];
    for (const root of roots) {
      const nodes = root?.querySelectorAll?.("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox'], [role='combobox']") || [];
      for (const node of nodes) {
        if (!(node instanceof Element) || seen.has(node) || !isValueReflectionTarget(node)) continue;
        seen.add(node);
        candidates.push(node);
        if (candidates.length >= VALUE_REFLECTION_MAX_CANDIDATES) return candidates;
      }
    }
    return candidates;
  }

  function snapshotValueReflectionTargets(sourceEl = null) {
    return queryValueReflectionTargets(sourceEl)
      .map((element) => ({
        element,
        selectorCss: cssPath(element),
        selectorXpath: xPath(element),
        fingerprint: reflectionFingerprint(element),
        popupContext: buildPopupContext(element)
      }))
      .filter((item) => item.fingerprint && item.selectorCss);
  }

  function pruneRecentValueReflectionKeys(now = Date.now()) {
    for (const [key, emittedAt] of recentValueReflectionKeys.entries()) {
      if (now - emittedAt > 6000) recentValueReflectionKeys.delete(key);
    }
  }

  function rememberRecentValueEvent(target, action) {
    if (!(target instanceof Element)) return;
    recentValueEventByElement.set(target, {
      action,
      timeMs: Date.now()
    });
  }

  function recentlyHadNativeValueEvent(target, sinceMs) {
    const recent = recentValueEventByElement.get(target);
    return Boolean(recent?.timeMs && recent.timeMs >= sinceMs - 10 && Date.now() - recent.timeMs <= RECENT_VALUE_EVENT_WINDOW_MS);
  }

  function isValueReflectionSourceRow(row) {
    if (!row || (row.action !== "click" && row.action !== "canvas_click")) return false;
    const payload = row.payload || {};
    const kind = payload.kind || "";
    if (/grid|table|cell|row|canvas|tree|selection|adapter|pivot/i.test(kind)) return true;
    return Boolean(payload.grid_context || row.action === "canvas_click");
  }

  function scoreValueReflection({ sourceRow, before, after, targetPopupContext, elapsedMs }) {
    let score = 0.35;
    if (elapsedMs >= 0 && elapsedMs <= VALUE_REFLECTION_WINDOW_MS) score += 0.15;
    if (before.length !== after.length) score += 0.1;
    if (before.hash !== after.hash) score += 0.1;
    if (before.empty && !after.empty) score += 0.1;
    if (sourceRow?.payload?.popup_context || targetPopupContext) score += 0.1;
    if (isValueReflectionSourceRow(sourceRow)) score += 0.1;
    return Math.min(0.95, Number(score.toFixed(2)));
  }

  function emitValueReflectionRow(sourceRow, sourceEl, beforeState, afterFingerprint, elapsedMs) {
    if (!sourceRow || !beforeState?.element || !afterFingerprint) return;
    const target = beforeState.element;
    const sourcePopupContext = sourceRow.payload?.popup_context || buildPopupContext(sourceEl) || null;
    const targetPopupContext = buildPopupContext(target);
    const confidence = scoreValueReflection({
      sourceRow,
      before: beforeState.fingerprint,
      after: afterFingerprint,
      targetPopupContext,
      elapsedMs
    });
    const context = {
      source_event_id: sourceRow.event_id || null,
      source_interaction_id: sourceRow.interaction_id || null,
      source_action: sourceRow.action || null,
      source_popup_id: sourcePopupContext?.active_popup_id || null,
      source_popup_depth: sourcePopupContext?.active_popup_depth ?? null,
      target_popup_id: targetPopupContext?.active_popup_id || null,
      target_popup_depth: targetPopupContext?.active_popup_depth ?? null,
      target_selector_css: beforeState.selectorCss,
      target_selector_xpath: beforeState.selectorXpath,
      target_element_tag: target.tagName?.toLowerCase() || null,
      target_associated_label: reflectionTargetLabel(target),
      value_captured: false,
      value_before_captured: false,
      value_after_captured: false,
      value_length_changed: beforeState.fingerprint.length !== afterFingerprint.length,
      value_hash_changed: beforeState.fingerprint.hash !== afterFingerprint.hash,
      empty_to_filled: Boolean(beforeState.fingerprint.empty && !afterFingerprint.empty),
      reason: "programmatic_input_value_reflection",
      confidence,
      candidate_only: confidence < 0.7
    };
    const dedupeKey = `${sourceRow.event_id || sourceRow.interaction_id || "source"}:${beforeState.selectorCss}`;
    pruneRecentValueReflectionKeys();
    if (recentValueReflectionKeys.has(dedupeKey)) return;
    recentValueReflectionKeys.set(dedupeKey, Date.now());

    const row = buildRow(target, "value_reflection", {
      eventTimeOverride: new Date().toISOString(),
      elementText: reflectionTargetLabel(target) || "value_reflection",
      relatedInteractionId: sourceRow.interaction_id || null,
      payload: {
        kind: "value_reflection",
        value_reflection_context: context,
        relation_context: {
          related_interaction_id: sourceRow.interaction_id || null,
          related_event_id: sourceRow.event_id || null,
          related_action: sourceRow.action || null,
          related_strategy: "programmatic_value_reflection"
        }
      },
      popupContext: targetPopupContext,
      snapshot: null
    });
    sendRows([row]);
  }

  function checkValueReflectionTargets(sourceRow, sourceEl, observedAtMs, beforeStates, emittedTargets) {
    for (const beforeState of beforeStates) {
      const target = beforeState.element;
      if (!(target instanceof Element) || !target.isConnected) continue;
      if (emittedTargets.has(target)) continue;
      if (recentlyHadNativeValueEvent(target, observedAtMs)) continue;
      const after = reflectionFingerprint(target);
      if (!after) continue;
      const changed =
        beforeState.fingerprint.length !== after.length ||
        beforeState.fingerprint.hash !== after.hash ||
        beforeState.fingerprint.empty !== after.empty;
      if (!changed) continue;
      emittedTargets.add(target);
      emitValueReflectionRow(sourceRow, sourceEl, beforeState, after, Date.now() - observedAtMs);
    }
  }

  function scheduleValueReflectionCheck(sourceRow, sourceEl = null) {
    if (!isValueReflectionSourceRow(sourceRow)) return;
    const observedAtMs = Date.now();
    const beforeStates = snapshotValueReflectionTargets(sourceEl);
    if (beforeStates.length === 0) return;
    const emittedTargets = new WeakSet();
    for (const delayMs of VALUE_REFLECTION_CHECK_DELAYS_MS) {
      setTimeout(() => {
        checkValueReflectionTargets(sourceRow, sourceEl, observedAtMs, beforeStates, emittedTargets);
      }, delayMs);
    }
  }

  function sendInteractionRows(rows, sourceEl = null) {
    const firstRow = Array.isArray(rows) ? rows[0] : null;
    scheduleValueReflectionCheck(firstRow, sourceEl);
    sendRows(rows);
  }

  function buildDiagnosticPayload() {
    let isTopFrame = false;
    try {
      isTopFrame = window.top === window;
    } catch {
      isTopFrame = false;
    }

    return {
      kind: "collector_boot",
      collector_build: COLLECTOR_BUILD,
      origin: location.origin,
      href: location.href,
      referrer: document.referrer || null,
      title: document.title || null,
      isTopFrame,
      iframeCount: document.querySelectorAll("iframe,frame").length,
      readyState: document.readyState,
      hasWebSquareGlobal: typeof window.WebSquare !== "undefined",
      hasDollarP: typeof window.$p !== "undefined",
      hasNexacroGlobal: typeof window.nexacro !== "undefined",
      runtime_config_version: runtimeConfig.version || "local-default",
      runtime_config_source: runtimeConfig.source || "extension-default",
      runtime_config_schema_version: runtimeConfig.schema_version || 1
    };
  }

  function buildFrameContext() {
    let isTopFrame = true;
    let crossOriginLimited = false;
    let topUrl = null;
    let topOrigin = null;
    let frameDepth = 0;
    let frameIndex = null;

    try {
      isTopFrame = window.top === window;
    } catch {
      isTopFrame = false;
      crossOriginLimited = true;
    }

    try {
      topUrl = window.top?.location?.href || null;
      topOrigin = window.top?.location?.origin || null;
    } catch {
      crossOriginLimited = true;
    }

    try {
      let current = window;
      while (current && current.parent && current.parent !== current && frameDepth < 20) {
        const parent = current.parent;
        try {
          frameIndex = Array.prototype.indexOf.call(parent.frames || [], current);
        } catch {
          crossOriginLimited = true;
        }
        frameDepth += 1;
        current = parent;
      }
    } catch {
      crossOriginLimited = true;
    }

    return {
      is_top_frame: Boolean(isTopFrame),
      frame_depth: frameDepth,
      frame_index: Number.isFinite(Number(frameIndex)) ? Number(frameIndex) : null,
      frame_url: location.href,
      frame_origin: location.origin,
      top_url: topUrl,
      top_origin: topOrigin,
      referrer: document.referrer || null,
      cross_origin_limited: Boolean(crossOriginLimited)
    };
  }

  function buildRow(el, action, extra = {}) {
    const eventId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const eventTime = eventTimeToIso(extra?.eventTimeOverride || extra?.observedAt || null);
    const sequence = nextEventSequence();
    const selectorCss = el ? cssPath(el) : "PAGE";
    const selectorXpath = el ? xPath(el) : "/html[1]";
    const elementTag = el?.tagName?.toLowerCase() || "html";
    const hasElementTextOverride = Object.prototype.hasOwnProperty.call(extra || {}, "elementText");
    const rawElementText = hasElementTextOverride
      ? extra.elementText
      : (el && !isDocumentLevelElement(el) ? visibleTextOf(el) : null);
    const textContext = semanticTextContextOf(el, action, rawElementText);
    const associatedLabelContext = associatedLabelOf(el);
    const associatedLabel = compactSemanticText(
      extra?.gridContext?.column_label ||
      extra?.gridContext?.column_key ||
      associatedLabelContext?.text
    );
    const elementText = sanitizeStructuredValue(textContext.semantic_text, {
      key: extra?.gridContext?.column_key || extra?.gridContext?.column_label || "element_text",
      element: el || null
    });
    const sanitizedTextContext = {
      ...textContext,
      semantic_text: elementText
    };
    const bounds = el ? boundsOf(el) : null;
    const correlationId = extra?.correlationId || null;
    const payloadSource =
      extra?.payload && typeof extra.payload === "object" && !Array.isArray(extra.payload)
        ? { ...extra.payload }
        : {};
    const gridFieldKey = extra?.gridContext?.column_key || extra?.gridContext?.column_label || extra?.gridContext?.column_id || null;
    if (gridFieldKey && Object.prototype.hasOwnProperty.call(payloadSource, "clicked_value")) {
      payloadSource.clicked_value = sanitizeGridValue(payloadSource.clicked_value, gridFieldKey, el || null);
    }
    if (gridFieldKey && Array.isArray(payloadSource.clicked_row_path)) {
      payloadSource.clicked_row_path = sanitizeGridRowPath(payloadSource.clicked_row_path, extra?.gridContext || null);
      if (Object.prototype.hasOwnProperty.call(payloadSource, "clicked_row_label")) {
        payloadSource.clicked_row_label = payloadSource.clicked_row_path.join(" > ") || null;
      }
    }
    if (extra?.relatedInteractionId) {
      payloadSource.related_interaction_id = extra.relatedInteractionId;
    }
    if (extra?.relatedEventId) {
      payloadSource.related_event_id = extra.relatedEventId;
    }
    const scopedPayloadSource = sanitizeInputPayloadForElement(payloadSource, el);
    const payloadFields = sanitizeStructuredValue(scopedPayloadSource, {
      key: "payload"
    });
    const legacyPayload = clonePayloadValue(payloadFields);
    const shouldAttachMenuContext =
      action === "click" ||
      action === "change" ||
      action === "beforeinput" ||
      action === "input" ||
      action === "focus" ||
      action === "blur" ||
      action === "keydown" ||
      action === "paste" ||
      action === "submit" ||
      action === "compositionstart" ||
      action === "compositionend" ||
      action === "route_change" ||
      action === "screen_change" ||
      action === "api_transaction" ||
      action === "api_transaction_error" ||
      action === "api_transaction_timeout" ||
      /_click$/.test(action);
    const resolvedMenuContext = extra?.menuContext ?? resolveEffectiveMenuContext(el);
    const menuContext = shouldAttachMenuContext
      ? enrichMenuContext(sanitizeStructuredValue(clonePayloadValue(resolvedMenuContext), {
          key: "menu_context"
        }))
      : undefined;
    const gridContext = extra?.gridContext
      ? enrichGridContext(sanitizeStructuredValue(clonePayloadValue(extra.gridContext), {
          key: "grid_context"
        }))
      : undefined;
    const gridInteractionPayload = gridContext
      ? sanitizeStructuredValue(buildGridCellInteractionPayload(gridContext, {
          kind: "grid_cell_click",
          source: action
        }), { key: "grid_cell_click" })
      : null;
    const inputContext = buildInputContextFromPayload(payloadFields, el, action);
    const apiContext = buildApiContextFromPayload(payloadFields);
    const uiOutcomeContext = buildUiOutcomeContextFromPayload(payloadFields);
    const hasPopupContextOverride = Object.prototype.hasOwnProperty.call(extra || {}, "popupContext");
    const popupContext = mergePopupContext(
      payloadFields?.popup_context,
      hasPopupContextOverride ? extra.popupContext : buildPopupContext(el)
    );
    const sanitizedPopupContext = popupContext
      ? sanitizeStructuredValue(clonePayloadValue(popupContext), { key: "popup_context" })
      : null;
    const frameContext = sanitizeStructuredValue(buildFrameContext(), { key: "frame_context" });
    const baseEventContext =
      payloadFields?.event_context && typeof payloadFields.event_context === "object" && !Array.isArray(payloadFields.event_context)
        ? { ...payloadFields.event_context }
        : {};
    const interactionId = extra?.interactionId || correlationId || `${pageSessionId}:${action}:${sequence}`;

    const row = {
      event_id: eventId,
      event_sequence: sequence,
      interaction_id: interactionId,
      event_time: eventTime,
      page_session_id: pageSessionId,
      action,
      collector_build: COLLECTOR_BUILD,
      extension_version: EXTENSION_VERSION,
      extension_build: EXTENSION_BUILD,
      sdk_version: payloadFields.sdk_version || null,
      sdk_build: payloadFields.sdk_build || null,
      page_url: location.href,
      page_title: document.title,
      selector_css: selectorCss,
      selector_xpath: selectorXpath,
      element_tag: elementTag,
      element_text: elementText,
      bounds,
      correlation_id: correlationId,
      snapshot: gridFieldKey
        ? sanitizeGridSnapshotValues(extra?.snapshot || null, gridFieldKey, el || null, extra?.gridContext || null)
        : extra?.snapshot || null,
      payload: {
        ...payloadFields,
        context_schema_version: CONTEXT_SCHEMA_VERSION,
        ...(shouldAttachMenuContext ? { menu_context: menuContext ?? null } : {}),
        ...(gridContext ? { grid_context: gridContext } : {}),
        ...(gridInteractionPayload ? {
          grid_cell_click: gridInteractionPayload,
          grid_id: gridInteractionPayload.grid_id || null,
          row_index: gridInteractionPayload.row_index ?? null,
          col_index: gridInteractionPayload.col_index ?? null,
          column_key: gridInteractionPayload.column_key || null,
          cell_value: gridInteractionPayload.cell_value ?? null,
          row_data: gridInteractionPayload.row_data || null,
          selected_row: gridInteractionPayload.selected_row || null,
          headers: gridInteractionPayload.headers || null
        } : {}),
        ...(inputContext ? { input_context: inputContext } : {}),
        ...(apiContext ? { api_context: apiContext } : {}),
        ...(uiOutcomeContext ? { ui_outcome: uiOutcomeContext } : {}),
        text_context: sanitizedTextContext,
        ...(sanitizedPopupContext || hasPopupContextOverride || Object.prototype.hasOwnProperty.call(payloadFields || {}, "popup_context")
          ? { popup_context: sanitizedPopupContext }
          : {}),
        frame_context: frameContext,
        event_context: {
          ...baseEventContext,
          event_id: eventId,
          event_sequence: sequence,
          interaction_id: interactionId,
          related_interaction_id: extra?.relatedInteractionId || baseEventContext.related_interaction_id || null,
          related_event_id: extra?.relatedEventId || baseEventContext.related_event_id || null,
          action,
          event_time: eventTime,
          correlation_id: correlationId,
          active_popup_id: sanitizedPopupContext?.active_popup_id || null,
          active_popup_depth: sanitizedPopupContext?.active_popup_depth ?? null,
          active_parent_popup_id: sanitizedPopupContext?.active_parent_popup_id || null,
          extension_version: EXTENSION_VERSION,
          extension_build: EXTENSION_BUILD,
          sdk_version: payloadFields.sdk_version || null,
          sdk_build: payloadFields.sdk_build || null,
          collector_build: COLLECTOR_BUILD,
          context_schema_version: CONTEXT_SCHEMA_VERSION
        },
        page_context: {
          page_session_id: pageSessionId,
          page_url: location.href,
          page_title: document.title,
          origin: location.origin,
          path: location.pathname,
          search: location.search || "",
          hash: location.hash || ""
        },
        environment_context: {
          ua: navigator.userAgent || null,
          vw: Number.isFinite(window.innerWidth) ? window.innerWidth : null,
          vh: Number.isFinite(window.innerHeight) ? window.innerHeight : null
        },
        element_context: {
          selector_css: selectorCss,
          selector_xpath: selectorXpath,
          element_tag: elementTag,
          element_text: elementText,
          associated_label: associatedLabel,
          bounds,
          popup_context: sanitizedPopupContext
        },
        legacy: legacyPayload
      }
    };

    if (isTrackedUserAction(action)) {
      lastUserAction = {
        eventId,
        interactionId,
        action,
        eventTime,
        popupContext: sanitizedPopupContext ? clonePayloadValue(sanitizedPopupContext) : null,
        pageUrl: location.href,
        pageSessionId
      };
      rememberUserAction(row);
    }

    if (action === "click") {
      rememberGridEditContext(row);
    }

    return row;
  }

  function requestMainWorldState(kind, requestId, detail = null) {
    window.dispatchEvent(new CustomEvent("AZ_TEST_REQUEST_STATE", {
      detail: {
        kind,
        requestId,
        ...(detail && typeof detail === "object" ? detail : {})
      }
    }));
  }

  function embeddedGridModelsState() {
    const holder = document.getElementById("azGridModelsState");
    if (!holder?.textContent) return null;
    try {
      return JSON.parse(holder.textContent);
    } catch (error) {
      console.warn("[Rainbow Collector] 내장 grid 모델 파싱 실패", {
        "실패 이유": error?.message || String(error),
        "영향": "해당 화면의 grid row/column 보강 정보가 일부 비어 있을 수 있음"
      });
      return null;
    }
  }

  function modelAssistedGridTarget(target) {
    if (!(target instanceof Element)) return null;

    const nexacroRoot = target.closest("#mainframe\\.WorkFrame\\.form\\.divWork\\.form\\.WorkBg\\.form\\.divContents\\.form\\.divMain\\.form\\.grd_chartGrid");
    if (nexacroRoot) {
      return {
        kind: "grid_models",
        element: target.closest("[id*='gridrow_'][id*='cell_']") || target.closest("[id*='gridrow_']") || nexacroRoot
      };
    }

    const webSquareRoot = target.closest("#mf_wfm_layout_wfm_contents_tabFrame1_body_wq_uuid_1_gridView1_body_table");
    if (webSquareRoot) {
      return {
        kind: "grid_models",
        element: target.closest("td, th") || webSquareRoot
      };
    }

    return null;
  }

  function canvasStateFromEvent(canvas, event) {
    if (!(canvas instanceof Element)) return null;
    const rect = canvas.getBoundingClientRect();
    const rawPoint = {
      x: Math.round((event?.clientX ?? rect.left) - rect.left),
      y: Math.round((event?.clientY ?? rect.top) - rect.top)
    };
    const scaleX = canvas instanceof HTMLCanvasElement && rect.width > 0
      ? canvas.width / rect.width
      : 1;
    const scaleY = canvas instanceof HTMLCanvasElement && rect.height > 0
      ? canvas.height / rect.height
      : 1;
    const point = {
      x: Math.round(rawPoint.x * scaleX),
      y: Math.round(rawPoint.y * scaleY)
    };

    const bundle = embeddedGridModelsState();
    const baseCanvasModel = bundle?.canvas || null;

    return {
      rawPoint,
      point,
      model: baseCanvasModel ? {
        ...baseCanvasModel,
        lastPoint: point
      } : {
        kind: "canvas_grid",
        lastPoint: point
      }
    };
  }

  function canvasHitTest(canvasState) {
    const point = canvasState?.point || null;
    const model = canvasState?.model || null;
    if (!point || !model || !Array.isArray(model.columns) || !Array.isArray(model.rows)) return null;

    const originX = Number(model.originX ?? 0);
    const originY = Number(model.originY ?? 0);
    const headerHeight = Number(model.headerHeight ?? 0);
    const rowHeight = Number(model.rowHeight ?? 0);
    const localX = point.x - originX;
    const localY = point.y - originY;

    if (localX < 0 || localY < 0) {
      return {
        region: "outside",
        point
      };
    }

    let colIndex = -1;
    let widthCursor = 0;
    for (let index = 0; index < model.columns.length; index += 1) {
      const width = Number(model.columns[index]?.width ?? 0);
      if (localX >= widthCursor && localX < widthCursor + width) {
        colIndex = index;
        break;
      }
      widthCursor += width;
    }

    if (colIndex < 0) {
      return {
        region: "outside",
        point
      };
    }

    const column = model.columns[colIndex] || null;
    const colId = column?.id || null;
    const colLabel = column?.label || colId || null;

    if (localY < headerHeight) {
      return {
        region: "header",
        point,
        colIndex,
        colId,
        colLabel,
        clickedValue: colLabel
      };
    }

    if (rowHeight <= 0) {
      return {
        region: "outside",
        point,
        colIndex,
        colId,
        colLabel
      };
    }

    const bodyY = localY - headerHeight;
    const rowIndex = Math.floor(bodyY / rowHeight);
    const row = model.rows[rowIndex] || null;

    if (!row) {
      return {
        region: "outside",
        point,
        colIndex,
        colId,
        colLabel
      };
    }

    const clickedValue = colId ? row[colId] ?? null : null;

    return {
      region: "cell",
      point,
      rowIndex,
      rowData: row,
      colIndex,
      colId,
      colLabel,
      clickedValue
    };
  }

  function classifyUiOutcomeKind(el) {
    if (!(el instanceof Element)) return "message";
    const role = el.getAttribute("role") || "";
    const text = `${el.tagName.toLowerCase()} ${role} ${classTextOf(el)} ${el.id || ""}`;
    if (el.matches("dialog, [aria-modal='true'], .modal")) return "modal";
    if (role === "alert" || /\balert\b/i.test(text)) return "alert";
    if (/toast|snackbar/i.test(text) || role === "status") return "toast";
    if (el.getAttribute("aria-invalid") === "true" || /invalid|validation|error/i.test(text)) return "validation";
    return "message";
  }

  function uiOutcomeCandidates() {
    return [
      ...document.querySelectorAll(UI_OUTCOME_SELECTOR),
      ...visiblePopupRoots()
    ];
  }

  function extractUiOutcomeText(el) {
    if (!(el instanceof Element)) return null;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      if (el.validationMessage) return compactSemanticText(el.validationMessage);
      const describedBy = `${el.getAttribute("aria-describedby") || ""} ${el.getAttribute("aria-errormessage") || ""}`
        .split(/\s+/)
        .filter(Boolean);
      for (const id of describedBy) {
        const node = document.getElementById(id);
        const message = visibleTextOf(node) || textOf(node);
        if (message) return compactSemanticText(message);
      }
    }

    return compactSemanticText(directTextOf(el) || visibleTextOf(el) || textOf(el));
  }

  function popupMessageText(el) {
    if (!(el instanceof Element)) return { message: null, source: null };
    const describedBy = `${el.getAttribute("aria-describedby") || ""}`
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => compactSemanticText(visibleTextOf(document.getElementById(id)) || textOf(document.getElementById(id))))
      .filter(Boolean);
    if (describedBy.length) {
      return { message: compactSemanticText(describedBy.join(" ")), source: "aria-describedby" };
    }

    const clone = el.cloneNode(true);
    clone.querySelectorAll?.([
      "button", "input", "select", "textarea", "option", "[contenteditable='true']",
      "h1", "h2", "h3", "h4", "h5", "h6", "[role='heading']",
      "script", "style"
    ].join(",")).forEach((node) => node.remove());
    return { message: compactSemanticText(clone.textContent), source: "static-dialog-text" };
  }

  function popupMessageEvidence(el) {
    if (!(el instanceof Element) || !isPopupRoot(el)) return null;
    if (el.querySelector(UI_OUTCOME_SELECTOR)) {
      return { status: "explicit_descendant", message: null, source: "explicit-outcome-descendant", confidence: 1 };
    }

    const hasStructuredContent = Boolean(el.querySelector([
      "input", "select", "textarea", "[contenteditable='true']", "form", "table",
      "[role='grid']", "[role='treegrid']", "[role='tree']", "[role='listbox']"
    ].join(",")));
    if (hasStructuredContent) {
      return { status: "excluded_structured_popup", message: null, source: "popup-structure", confidence: 0 };
    }

    const { message, source } = popupMessageText(el);
    if (!message) return { status: "no_message", message: null, source, confidence: 0 };
    const role = String(el.getAttribute("role") || "").toLowerCase();
    const hasOutcomeSignal = /(?:success|succeed|complete|completed|saved|approved|rejected|failed|failure|error|invalid|cancelled|canceled|성공|완료|저장|승인|반려|실패|오류|유효하지|취소)/i.test(message);
    if (role === "alertdialog") {
      return { status: "resolved", message, source, confidence: 0.98, evidence: ["alertdialog-role"] };
    }
    if (hasOutcomeSignal) {
      return { status: "resolved", message, source, confidence: 0.9, evidence: ["static-popup", "outcome-language"] };
    }
    return { status: "ambiguous", message, source, confidence: 0.45, evidence: ["static-popup"] };
  }

  function resolveUiOutcomeCandidate(el) {
    if (!(el instanceof Element)) return null;
    if (el.matches?.(UI_OUTCOME_SELECTOR)) {
      const message = extractUiOutcomeText(el);
      if (!message) return null;
      return {
        kind: classifyUiOutcomeKind(el),
        message,
        confidence: 1,
        messageSource: "explicit-outcome-element",
        evidence: [el.getAttribute("role") || el.tagName.toLowerCase()]
      };
    }
    const popupEvidence = popupMessageEvidence(el);
    if (!popupEvidence || popupEvidence.status !== "resolved" || !popupEvidence.message) return null;
    return {
      kind: "modal_message",
      message: popupEvidence.message,
      confidence: popupEvidence.confidence,
      messageSource: popupEvidence.source,
      evidence: popupEvidence.evidence || []
    };
  }

  function isVisibleCandidate(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function isPopupRoot(el) {
    return el instanceof Element && el.matches?.(POPUP_ROOT_SELECTOR) && isVisibleCandidate(el);
  }

  function popupZIndex(el) {
    const value = Number(window.getComputedStyle(el).zIndex);
    return Number.isFinite(value) ? value : 0;
  }

  function documentOrder(a, b) {
    if (a === b) return 0;
    const position = a.compareDocumentPosition(b);
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 0;
  }

  function visiblePopupRoots() {
    if (!document.body) return [];
    return [...document.querySelectorAll(POPUP_ROOT_SELECTOR)]
      .filter(isPopupRoot)
      .slice(0, 20)
      .sort((a, b) => popupZIndex(a) - popupZIndex(b) || documentOrder(a, b));
  }

  function popupTitleOf(el) {
    if (!(el instanceof Element)) return null;
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim().slice(0, 160);

    const labelledBy = `${el.getAttribute("aria-labelledby") || ""}`.split(/\s+/).filter(Boolean);
    for (const id of labelledBy) {
      const labelNode = document.getElementById(id);
      const label = visibleTextOf(labelNode) || textOf(labelNode);
      if (label) return label.slice(0, 160);
    }

    const heading = el.querySelector?.("h1,h2,h3,[role='heading'],.modal-title,.dialog-title");
    const headingText = visibleTextOf(heading) || textOf(heading);
    if (headingText) return headingText.slice(0, 160);

    const fallback = compactSemanticText(
      el.getAttribute("data-title") ||
      el.getAttribute("name") ||
      el.id ||
      el.getAttribute("role")
    );
    return fallback ? fallback.slice(0, 160) : null;
  }

  function closestPopupRoot(el) {
    return el instanceof Element ? el.closest?.(POPUP_ROOT_SELECTOR) || null : null;
  }

  function topVisiblePopupExcluding(el) {
    const roots = visiblePopupRoots().filter((root) => root !== el && !root.contains(el));
    return roots[roots.length - 1] || null;
  }

  function topKnownVisiblePopupIdExcluding(popupId) {
    const knownRoots = visiblePopupRoots()
      .map((root) => popupStateByElement.get(root))
      .filter((state) => state?.popupId && state.popupId !== popupId && visiblePopupIds.has(state.popupId));
    return knownRoots[knownRoots.length - 1]?.popupId || null;
  }

  function ensurePopupState(el, options = {}) {
    if (!isPopupRoot(el)) return null;
    let state = popupStateByElement.get(el);
    const isNewState = !state;
    if (!state) {
      popupSequence += 1;
      state = {
        popupId: `popup:${pageSessionId}:${popupSequence}`,
        element: el,
        openedAt: new Date().toISOString(),
        openedByInteractionId: null,
        openedByEventId: null,
        sourceAction: null,
        parentPopupId: null,
        openEmitted: false,
        closeEmitted: false,
        lastDescriptor: null
      };
      popupStateByElement.set(el, state);
      popupStateById.set(state.popupId, state);
    }

    const parentRoot = el.parentElement?.closest?.(POPUP_ROOT_SELECTOR) || null;
    const parentState = parentRoot && parentRoot !== el ? ensurePopupState(parentRoot) : null;
    const nextParentPopupId = parentState?.popupId || (isNewState ? options.parentPopupId : state.parentPopupId) || null;
    state.parentPopupId = nextParentPopupId && nextParentPopupId !== state.popupId ? nextParentPopupId : null;
    if (!parentState && state.parentPopupId) {
      const existingParent = popupStateById.get(state.parentPopupId);
      if (!existingParent?.element?.isConnected) {
        state.parentPopupId = isNewState ? options.parentPopupId || null : null;
      }
    }

    if (options.openedByInteractionId && !state.openedByInteractionId) {
      state.openedByInteractionId = options.openedByInteractionId;
    }
    if (options.openedByEventId && !state.openedByEventId) {
      state.openedByEventId = options.openedByEventId;
    }
    if (options.sourceAction && !state.sourceAction) {
      state.sourceAction = options.sourceAction;
    }

    return state;
  }

  function popupDescriptor(el, depth = null) {
    const state = ensurePopupState(el);
    if (!state) return null;
    const resolvedDepth = depth ?? state.lastDescriptor?.depth ?? null;
    const descriptor = {
      popup_id: state.popupId,
      parent_popup_id: state.parentPopupId,
      depth: resolvedDepth,
      role: el.getAttribute("role") || (el.tagName?.toLowerCase() === "dialog" ? "dialog" : null),
      tag: el.tagName?.toLowerCase() || null,
      title: popupTitleOf(el),
      selector_css: cssPath(el),
      selector_xpath: xPath(el),
      text_hash: simpleHashText(visibleTextOf(el) || textOf(el) || ""),
      opened_at: state.openedAt,
      opened_by_interaction_id: state.openedByInteractionId,
      opened_by_event_id: state.openedByEventId,
      source_action: state.sourceAction
    };
    state.lastDescriptor = descriptor;
    return descriptor;
  }

  function popupDescriptorForState(state, depth = null) {
    if (!state) return null;
    const liveDescriptor = state.element instanceof Element ? popupDescriptor(state.element, depth) : null;
    if (liveDescriptor) return liveDescriptor;
    return state.lastDescriptor
      ? {
          ...state.lastDescriptor,
          depth
        }
      : null;
  }

  function popupChainDescriptors(state) {
    if (!state) return [];
    const chain = [];
    const seen = new Set();
    let current = state;
    while (current && !seen.has(current.popupId) && chain.length < 10) {
      seen.add(current.popupId);
      chain.unshift(current);
      current = current.parentPopupId ? popupStateById.get(current.parentPopupId) : null;
    }
    return chain
      .map((item, index) => popupDescriptorForState(item, index + 1))
      .filter(Boolean);
  }

  function buildPopupContext(el) {
    const roots = visiblePopupRoots();
    if (roots.length === 0) return null;

    const containing = el instanceof Element
      ? roots.filter((root) => root.contains(el))
      : [];
    const stackRoots = containing.length > 0 ? containing : roots;
    const activeRoot = el instanceof Element
      ? closestPopupRoot(el) || stackRoots[stackRoots.length - 1]
      : stackRoots[stackRoots.length - 1];
    const activeState = activeRoot ? ensurePopupState(activeRoot) : null;
    const stackFromParentChain = popupChainDescriptors(activeState);
    const stack = stackFromParentChain.length > 0
      ? stackFromParentChain
      : stackRoots.map((root, index) => popupDescriptor(root, index + 1)).filter(Boolean);
    const activeIndex = activeState
      ? stack.findIndex((item) => item.popup_id === activeState.popupId)
      : -1;
    const activeDescriptor = activeState
      ? popupDescriptorForState(activeState, activeIndex >= 0 ? activeIndex + 1 : stack.length)
      : null;

    return {
      stack_depth: stack.length,
      is_inside_popup: Boolean(el instanceof Element && closestPopupRoot(el)),
      active_popup_id: activeDescriptor?.popup_id || null,
      active_popup_depth: activeDescriptor?.depth ?? null,
      active_popup_title: activeDescriptor?.title || null,
      active_parent_popup_id: activeDescriptor?.parent_popup_id || null,
      stack
    };
  }

  function mergePopupContext(payloadContext, computedContext) {
    const payloadObject =
      payloadContext && typeof payloadContext === "object" && !Array.isArray(payloadContext)
        ? payloadContext
        : null;
    if (!payloadObject) return computedContext || null;
    if (!computedContext) return payloadObject;
    return {
      ...computedContext,
      ...payloadObject,
      stack: Array.isArray(payloadObject.stack) ? payloadObject.stack : computedContext.stack
    };
  }

  function emitPopupLifecycleRow(el, action, state, trigger) {
    if (!state) return null;
    markStructureCacheDirty();
    const isClose = action === "popup_close";
    const lastActionTimeMs = Date.parse(lastUserAction?.eventTime || "");
    const lastActionPopupId = lastUserAction?.popupContext?.active_popup_id || null;
    const closeAction = isClose &&
      lastUserAction?.action === "click" &&
      Number.isFinite(lastActionTimeMs) &&
      Date.now() - lastActionTimeMs <= 2000 &&
      lastActionPopupId === state.popupId
        ? lastUserAction
        : null;
    const relatedInteractionId = isClose
      ? closeAction?.interactionId || null
      : state.openedByInteractionId || null;
    const relatedEventId = isClose
      ? closeAction?.eventId || null
      : state.openedByEventId || null;
    const computedContext = el instanceof Element ? buildPopupContext(el) : null;
    const descriptor = el instanceof Element ? popupDescriptor(el) || state.lastDescriptor : state.lastDescriptor;
    if (!descriptor) return null;
    const stack = computedContext?.stack?.length ? computedContext.stack : [descriptor];
    const stackDescriptor = stack.find((item) => item?.popup_id === descriptor.popup_id) || null;
    const descriptorWithDepth = {
      ...descriptor,
      depth: stackDescriptor?.depth ?? descriptor.depth ?? computedContext?.stack_depth ?? null
    };
    const observedAt = new Date().toISOString();
    const popupContext = {
      stack_depth: stack.length,
      is_inside_popup: true,
      lifecycle_action: isClose ? "close" : "open",
      trigger,
      target_popup: descriptorWithDepth,
      active_popup_id: descriptorWithDepth.popup_id,
      active_popup_depth: descriptorWithDepth.depth,
      active_popup_title: descriptorWithDepth.title || null,
      active_parent_popup_id: descriptorWithDepth.parent_popup_id,
      opener_interaction_id: state.openedByInteractionId,
      opener_event_id: state.openedByEventId,
      closer_interaction_id: closeAction?.interactionId || null,
      closer_event_id: closeAction?.eventId || null,
      message_candidate: el instanceof Element ? popupMessageEvidence(el) : null,
      stack
    };
    const row = buildRow(el instanceof Element ? el : document.documentElement, action, {
      eventTimeOverride: observedAt,
      elementText: descriptor.title || action,
      relatedInteractionId,
      relatedEventId,
      payload: {
        kind: "popup_lifecycle",
        popup_context: popupContext,
        popup_action: popupContext.lifecycle_action,
        related_event_id: relatedEventId,
        relation_context: {
          related_interaction_id: relatedInteractionId,
          related_event_id: relatedEventId,
          related_action: closeAction?.action || state.sourceAction || null,
          related_strategy: isClose
            ? (closeAction ? "popup_closer_click" : "popup_close_unresolved")
            : "popup_opener_action"
        },
        observed_at: observedAt
      },
      snapshot: captureSnapshot(action, {
        popup_context: popupContext
      })
    });
    sendRows([row]);
    return row;
  }

  function refreshPopupLifecycle(trigger = "mutation", options = {}) {
    const currentIds = new Set();
    const roots = visiblePopupRoots();
    for (const root of roots) {
      const existingState = popupStateByElement.get(root);
      const state = ensurePopupState(root, {
        parentPopupId: existingState ? existingState.parentPopupId : topKnownVisiblePopupIdExcluding(existingState?.popupId),
        openedByInteractionId: options.openedByInteractionId || lastUserAction?.interactionId || null,
        openedByEventId: options.openedByEventId || lastUserAction?.eventId || null,
        sourceAction: options.sourceAction || lastUserAction?.action || null
      });
      if (!state) continue;
      currentIds.add(state.popupId);
      popupDescriptor(root);
      if (!visiblePopupIds.has(state.popupId) && !state.openEmitted) {
        state.openEmitted = true;
        emitPopupLifecycleRow(root, "popup_open", state, trigger);
      }
      state.closeEmitted = false;
    }

    for (const popupId of visiblePopupIds) {
      if (currentIds.has(popupId)) continue;
      const state = popupStateById.get(popupId);
      if (!state || state.closeEmitted) continue;
      state.closeEmitted = true;
      emitPopupLifecycleRow(state.element, "popup_close", state, trigger);
      popupStateByElement.delete(state.element);
      popupStateById.delete(popupId);
    }

    visiblePopupIds = currentIds;
  }

  function initializePopupLifecycleBaseline() {
    const currentIds = new Set();
    for (const root of visiblePopupRoots()) {
      const state = ensurePopupState(root);
      if (!state) continue;
      state.openEmitted = true;
      popupDescriptor(root);
      currentIds.add(state.popupId);
    }
    visiblePopupIds = currentIds;
  }

  function schedulePopupLifecycleCheck(trigger = "mutation", options = {}) {
    if (popupLifecycleTimer) clearTimeout(popupLifecycleTimer);
    popupLifecycleTimer = setTimeout(() => {
      popupLifecycleTimer = null;
      refreshPopupLifecycle(trigger, options);
    }, 80);
  }

  function stopUiOutcomeObservation() {
    if (activeOutcomeObserver?.observer) {
      activeOutcomeObserver.observer.disconnect();
    }
    if (activeOutcomeObserver?.timer) {
      clearTimeout(activeOutcomeObserver.timer);
    }
    if (activeOutcomeObserver?.scanTimer) {
      clearTimeout(activeOutcomeObserver.scanTimer);
    }
    activeOutcomeObserver = null;
  }

  function emitUiOutcomeRow(state, element, outcomeKind, message, options = {}) {
    if (!state || !element || !message) return;
    const signature = uiOutcomeSignature(element, outcomeKind, message);
    const now = Date.now();
    const globalPrev = globalUiOutcomeState.get(signature);
    const baselineHit = state.baselineSignatures?.has(signature);
    const isFreshAddedNode = Boolean(options.fromAddedNode);
    const recentlyEmittedGlobally = globalPrev && now - globalPrev.lastEmittedAt < 800;
    if (!isFreshAddedNode && baselineHit) return;
    if (recentlyEmittedGlobally && !isFreshAddedNode) return;
    if (state.signatures.has(signature) || state.count >= 8) return;
    state.signatures.add(signature);
    state.count += 1;
    globalUiOutcomeState.set(signature, { lastEmittedAt: now, message, outcomeKind });
    if (outcomeKind === "modal" || isPopupRoot(element)) {
      refreshPopupLifecycle("ui_outcome", {
        openedByInteractionId: state.interactionId,
        openedByEventId: state.sourceEventId,
        sourceAction: state.sourceAction
      });
    }

    const payload = {
      kind: "ui_outcome",
      outcome_kind: outcomeKind,
      outcome_message: message,
      outcome_confidence: options.resolved?.confidence ?? null,
      outcome_message_source: options.resolved?.messageSource || null,
      outcome_evidence: options.resolved?.evidence || [],
      source_action: state.sourceAction,
      source_interaction_id: state.interactionId,
      source_event_id: state.sourceEventId,
      observed_at: new Date().toISOString()
    };

    const row = buildRow(element, "ui_outcome", {
      eventTimeOverride: payload.observed_at,
      elementText: message,
      relatedInteractionId: state.interactionId,
      relatedEventId: state.sourceEventId,
      payload,
      popupContext: buildPopupContext(element),
      snapshot: captureSnapshot("ui_outcome", {
        ui_outcome: payload
      })
    });
    sendRows([row]);
  }

  function scanUiOutcomes(state) {
    if (!state || activeOutcomeObserver !== state) return;
    for (const candidate of uiOutcomeCandidates()) {
      if (!(candidate instanceof Element) || !isVisibleCandidate(candidate)) continue;
      const resolved = resolveUiOutcomeCandidate(candidate);
      if (!resolved) continue;
      emitUiOutcomeRow(state, candidate, resolved.kind, resolved.message, { resolved });
    }
  }

  function scanUiOutcomesFromRoot(state, root) {
    if (!state || activeOutcomeObserver !== state || !(root instanceof Element)) return;
    const candidates = [];
    if (root.matches?.(UI_OUTCOME_SELECTOR)) {
      candidates.push(root);
    }
    candidates.push(...root.querySelectorAll?.(UI_OUTCOME_SELECTOR) || []);
    if (isPopupRoot(root)) candidates.push(root);
    candidates.push(...[...root.querySelectorAll?.(POPUP_ROOT_SELECTOR) || []].filter(isPopupRoot));
    for (const candidate of candidates) {
      if (!(candidate instanceof Element) || !isVisibleCandidate(candidate)) continue;
      const resolved = resolveUiOutcomeCandidate(candidate);
      if (!resolved) continue;
      emitUiOutcomeRow(state, candidate, resolved.kind, resolved.message, { fromAddedNode: true, resolved });
    }
  }

  function observeUiOutcomes(interactionId, sourceAction, sourceEventId = null) {
    if (!interactionId || !document.body) return;
    stopUiOutcomeObservation();

    const state = {
      interactionId,
      sourceAction,
      sourceEventId: sourceEventId || (
        lastUserAction?.interactionId === interactionId ? lastUserAction.eventId || null : null
      ),
      signatures: new Set(),
      baselineSignatures: collectUiOutcomeSignatures(),
      count: 0,
      observer: null,
      timer: null,
      scanTimer: null
    };

    const scheduleScan = () => {
      if (state.scanTimer) clearTimeout(state.scanTimer);
      state.scanTimer = setTimeout(() => {
        scanUiOutcomes(state);
      }, 120);
    };

    state.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node instanceof Element) {
            scanUiOutcomesFromRoot(state, node);
          }
        }
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          scanUiOutcomesFromRoot(state, mutation.target);
        }
        if (mutation.type === "characterData" && mutation.target?.parentElement) {
          scanUiOutcomesFromRoot(state, mutation.target.parentElement);
        }
      }
      scheduleScan();
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "open", "aria-invalid"]
    });
    state.timer = setTimeout(() => {
      stopUiOutcomeObservation();
    }, 3000);

    activeOutcomeObserver = state;
  }

  function buildInputPayload(target, extra = {}) {
    const value = sanitizeStructuredValue(controlValueOf(target), { key: "value", element: target });
    return {
      value,
      name: target?.getAttribute?.("name") || null,
      id: target?.id || null,
      type: target instanceof HTMLInputElement ? target.type || null : null,
      input_type: extra.inputType || null,
      key: extra.key || null,
      code: extra.code || null,
      data: extra.data ?? null,
      is_composing: Boolean(extra.isComposing),
      selection_start:
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
          ? target.selectionStart
          : null,
      selection_end:
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
          ? target.selectionEnd
          : null,
      ctrl_key: extra.ctrlKey ?? null,
      shift_key: extra.shiftKey ?? null,
      alt_key: extra.altKey ?? null,
      meta_key: extra.metaKey ?? null
    };
  }

  function inputCommitSignature(target, value) {
    return JSON.stringify({
      tag: target?.tagName?.toLowerCase?.() || null,
      id: target?.id || null,
      name: target?.getAttribute?.("name") || null,
      type: target instanceof HTMLInputElement ? target.type || null : null,
      value: value ?? null
    });
  }

  function shouldEmitInputCommit(target, value) {
    if (!isInputLikeElement(target)) return true;
    const signature = inputCommitSignature(target, value);
    if (lastCommittedInputSignatureByElement.get(target) === signature) return false;
    lastCommittedInputSignatureByElement.set(target, signature);
    return true;
  }

  function shouldTrackInputEvent(action, target, event) {
    if (!(target instanceof Element)) return false;
    if (action === "beforeinput") return false;
    if (action === "blur" || action === "change" || action === "compositionend" || action === "paste") return true;
    if (action === "focus") return true;

    const now = Date.now();
    const prev = lastInputEventByElement.get(target) || {};
    const prevTime = prev[action] || 0;
    const isComposing = Boolean(event?.isComposing || (compositionState.active && compositionState.target === target));

    if (action === "beforeinput" || action === "input") {
      if (isComposing && action !== "input") return false;
      if (now - prevTime < INPUT_EVENT_DEBOUNCE_MS) return false;
    }

    lastInputEventByElement.set(target, {
      ...prev,
      [action]: now
    });
    return true;
  }

  function shouldTrackKeyEvent(event, target) {
    if (!event) return false;
    if (!isKeyboardInteractionTarget(target)) return false;
    const key = event.key || "";
    if (/^(Control|Shift|Alt|Meta|OS|Fn)$/.test(key)) return false;
    if (/^F\d{1,2}$/.test(key)) return false;
    if (isInputLikeElement(target)) return false;
    if (/^(Enter|Tab|Escape)$/.test(key)) return true;
    if (/^Arrow(Up|Down|Left|Right)$/.test(key)) {
      return Boolean(target?.matches?.("select, [role='combobox'], [role='treeitem'], [role='gridcell'], [role='cell'], [data-row-index][data-col-id], [data-row-index][data-col-index]"));
    }
    return false;
  }

  function interactiveTargetFromEvent(event) {
    const interactiveSelector = "input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox'], [role='combobox'], form, button, a[href], [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='treeitem'], [role='gridcell'], [role='cell'], [data-row-index][data-col-id], [data-row-index][data-col-index]";
    const semanticTarget = semanticTargetFromEvent(event);
    if (semanticTarget) {
      const interactive = semanticTarget.closest?.(interactiveSelector) || null;
      if (interactive && !isDocumentLevelElement(interactive)) return interactive;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return null;
    const interactive = target.closest(interactiveSelector);
    return interactive && !isDocumentLevelElement(interactive) ? interactive : null;
  }

  function apiCaptureConfig() {
    return normalizeApiCaptureConfig(runtimeConfig.api_capture);
  }

  function safeUrlPath(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      return new URL(value, location.href).pathname || "/";
    } catch {
      return null;
    }
  }

  function clonePopupContextForApi(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return sanitizeStructuredValue(clonePayloadValue(value), { key: "popup_context" });
  }

  function isPopupContextCurrentlyVisible(value) {
    const popupId = value?.active_popup_id || null;
    if (!popupId) return false;
    return visiblePopupRoots().some((root) => {
      const state = popupStateByElement.get(root) || ensurePopupState(root);
      return state?.popupId === popupId;
    });
  }

  function preferLivePopupContext(candidateContext, liveContext) {
    const candidate = clonePopupContextForApi(candidateContext);
    if (!candidate) return liveContext || null;
    if (!candidate.active_popup_id) return liveContext || candidate;
    return isPopupContextCurrentlyVisible(candidate) ? candidate : (liveContext || null);
  }

  function findRecentActionForReference(reference) {
    if (!reference?.interactionId && !reference?.eventId) return null;
    for (let index = recentUserActions.length - 1; index >= 0; index -= 1) {
      const action = recentUserActions[index];
      if (
        (reference.interactionId && action.interactionId === reference.interactionId) ||
        (reference.eventId && action.eventId === reference.eventId)
      ) {
        return action;
      }
    }
    return null;
  }

  function captureApiStartPopupContext(related) {
    const activeElement = document.activeElement instanceof Element
      ? document.activeElement
      : document.documentElement;
    const liveContext = clonePopupContextForApi(buildPopupContext(activeElement));
    const relatedAction = findRecentActionForReference(related);
    if (relatedAction) return preferLivePopupContext(relatedAction.popupContext, liveContext);
    if (
      related?.interactionId &&
      lastUserAction?.interactionId === related.interactionId
    ) {
      return preferLivePopupContext(lastUserAction.popupContext, liveContext);
    }
    return liveContext;
  }

  function buildApiRequestStartContext(pending, popupContext, menuContextOverride = null) {
    const active = popupContext && typeof popupContext === "object" ? popupContext : null;
    const menuContext = menuContextOverride && typeof menuContextOverride === "object"
      ? menuContextOverride
      : pending?.menuContext && typeof pending.menuContext === "object"
      ? pending.menuContext
      : null;
    return {
      page_url: pending?.pageUrl || location.href,
      page_session_id: pending?.pageSessionId || pageSessionId,
      started_at: pending?.startedAt || null,
      started_at_ms: pending?.startedAtMs ?? null,
      active_popup_id: active?.active_popup_id || null,
      active_popup_depth: active?.active_popup_depth ?? null,
      active_parent_popup_id: active?.active_parent_popup_id || null,
      popup_stack_depth: active?.stack_depth ?? null,
      menu_context: menuContext,
      menu_path_text: menuContext?.selected_path_text || menuContext?.path_text || null
    };
  }

  function rememberApiTransactionStart(type, rawPayload) {
    const config = apiCaptureConfig();
    if (!config.enabled || !config.transaction_mode) return;

    const payload = normalizeInternalCollectorApiPayload(rawPayload || {});
    const requestId = payload.requestId || payload.request_id || null;
    if (!requestId) return;

    const startedAtMs = Number(payload.startedAtMs || payload.started_at_ms || Date.now());
    const related = resolveRelatedActionReference(startedAtMs, null);
    const popupContext = captureApiStartPopupContext(related);
    const cprMenuContext = normalizeCprMenuContext(payload.cprMenuContext || payload.cpr_menu_context || null);
    if (cprMenuContext) setActiveCprMenuContext(cprMenuContext);
    const menuContext = chooseActiveAndCprMenuContext(
      cprMenuContext || currentActiveCprMenuContext()
    );
    const maxBufferSize = Math.max(1, Number(config.max_buffer_size || DEFAULT_API_CAPTURE_CONFIG.max_buffer_size));
    while (apiTransactionBuffer.size >= maxBufferSize) {
      const oldestKey = apiTransactionBuffer.keys().next().value;
      if (!oldestKey) break;
      apiTransactionBuffer.delete(oldestKey);
      apiRequestInteractions.delete(oldestKey);
    }

    apiTransactionBuffer.set(requestId, {
      requestId,
      transport: type === "XHR_START" ? "xhr" : "fetch",
      method: payload.method || null,
      url: payload.url || null,
      urlPath: safeUrlPath(payload.url || null),
      startedAt: payload.startedAt || payload.started_at || eventTimeToIso(startedAtMs),
      startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
      correlationId: payload.correlationId || payload.correlation_id || null,
      relatedInteractionId: related.interactionId || null,
      relatedEventId: related.eventId || null,
      relatedAction: related.action || null,
      relatedStrategy: related.strategy || "none",
      popupContext,
      menuContext,
      pageUrl: location.href,
      pageSessionId
    });

    if (related?.interactionId) {
      apiRequestInteractions.set(requestId, {
        interactionId: related.interactionId,
        eventId: related.eventId || null,
        action: related.action || null,
        startedAtMs,
        url: payload.url || null,
        method: payload.method || null,
        related_strategy: "request_start_mapping"
      });
    }

    setTimeout(() => emitApiTransactionTimeout(requestId), config.transaction_ttl_ms);
  }

  function bodyCapturePolicy(reason = "disabled_by_privacy_policy") {
    return {
      request_body_captured: false,
      response_body_captured: false,
      reason
    };
  }

  function buildApiTransactionPayload(type, rawPayload, pending, options = {}) {
    const payload = normalizeInternalCollectorApiPayload(rawPayload || {});
    const isTimeout = options.timeout === true;
    const isError = isTimeout || type === "FETCH_ERROR" || type === "XHR_ERROR";
    const requestId = payload.requestId || payload.request_id || pending?.requestId || null;
    const endedAtMs = Number(
      payload.endedAtMs ||
      payload.ended_at_ms ||
      payload.receivedAtMs ||
      payload.received_at_ms ||
      Date.now()
    );
    const startedAtMs = Number(pending?.startedAtMs || payload.startedAtMs || payload.started_at_ms || endedAtMs);
    const durationMs = Number(payload.durationMs ?? payload.duration_ms ?? (endedAtMs - startedAtMs));
    const related = resolveRelatedActionReference(startedAtMs, requestId);
    const relatedInteractionId = pending?.relatedInteractionId || related.interactionId || null;
    const relatedEventId = pending?.relatedEventId || related.eventId || null;
    const relatedStrategy = pending?.relatedStrategy || related.strategy || "none";
    const transport = pending?.transport || (type.startsWith("XHR") ? "xhr" : "fetch");
    const url = pending?.url || payload.url || null;
    const popupContext = Object.prototype.hasOwnProperty.call(pending || {}, "popupContext")
      ? clonePopupContextForApi(pending.popupContext)
      : captureApiStartPopupContext(related);
    const cprMenuContext = normalizeCprMenuContext(
      pending?.menuContext || payload.cprMenuContext || payload.cpr_menu_context || null
    );
    if (cprMenuContext) setActiveCprMenuContext(cprMenuContext);
    const menuContext = chooseActiveAndCprMenuContext(
      cprMenuContext || currentActiveCprMenuContext()
    );
    const skipReason = isInternalCollectorEndpoint(url)
      ? "internal_collector_endpoint"
      : "disabled_by_privacy_policy";

    return {
      action: isTimeout ? "api_transaction_timeout" : (isError ? "api_transaction_error" : "api_transaction"),
      eventTime: payload.endedAt || payload.ended_at || payload.receivedAt || payload.received_at || eventTimeToIso(endedAtMs),
      apiContext: {
        request_id: requestId,
        transport,
        method: pending?.method || payload.method || null,
        url,
        url_path: pending?.urlPath || safeUrlPath(url),
        status: isTimeout ? null : (payload.status ?? null),
        started_at: pending?.startedAt || payload.startedAt || payload.started_at || eventTimeToIso(startedAtMs),
        ended_at: payload.endedAt || payload.ended_at || payload.receivedAt || payload.received_at || eventTimeToIso(endedAtMs),
        duration_ms: Number.isFinite(durationMs) ? Math.max(0, Math.trunc(durationMs)) : null,
        success: !isError,
        failure_stage: isTimeout ? "timeout" : (payload.failureStage || payload.failure_stage || (isError ? "response" : null)),
        error_type: isTimeout ? "timeout" : (payload.errorType || payload.error_type || null),
        error_message: isTimeout ? "api_transaction_ttl_expired" : (payload.errorMessage || payload.error_message || null),
        correlation_id: pending?.correlationId || payload.correlationId || payload.correlation_id || null,
        is_internal_collector_endpoint: isInternalCollectorEndpoint(url),
        body_capture: bodyCapturePolicy(skipReason)
      },
      relationContext: {
        related_interaction_id: relatedInteractionId,
        related_event_id: relatedEventId,
        related_strategy: relatedStrategy,
        related_action: pending?.relatedAction || related.action || null
      },
      popupContext,
      menuContext,
      requestContext: buildApiRequestStartContext(pending, popupContext, menuContext)
    };
  }

  function buildApiTransactionRow(type, rawPayload, options = {}) {
    const requestId = rawPayload?.requestId || rawPayload?.request_id || options.requestId || null;
    const pending = requestId ? apiTransactionBuffer.get(requestId) || null : null;
    if (requestId) {
      apiTransactionBuffer.delete(requestId);
      apiRequestInteractions.delete(requestId);
    }

    const transaction = buildApiTransactionPayload(type, rawPayload, pending, options);
    const row = buildRow(document.documentElement, transaction.action, {
      eventTimeOverride: transaction.eventTime,
      elementText: transaction.action,
      correlationId: transaction.apiContext.correlation_id,
      relatedInteractionId: transaction.relationContext.related_interaction_id,
      popupContext: transaction.popupContext,
      menuContext: transaction.menuContext,
      payload: {
        kind: "api_transaction",
        api_context: transaction.apiContext,
        relation_context: transaction.relationContext,
        request_context: transaction.requestContext,
        popup_context: transaction.popupContext,
        menu_context: transaction.menuContext,
        related_interaction_id: transaction.relationContext.related_interaction_id,
        related_event_id: transaction.relationContext.related_event_id,
        related_strategy: transaction.relationContext.related_strategy
      },
      snapshot: captureSnapshot(transaction.action, {
        api: transaction.apiContext,
        relation: transaction.relationContext,
        popup_context: transaction.popupContext
      })
    });
    rememberApiTransactionLink(row);
    return row;
  }

  function buildLegacyApiRow(type, rawPayload) {
    const payload = normalizeInternalCollectorApiPayload(rawPayload || {});
    const related = resolveRelatedActionReference(payload.startedAtMs || Date.now(), payload.requestId || null);
    const action = type === "FETCH_ERROR"
      ? "fetch_error"
      : type === "XHR_ERROR"
        ? "xhr_error"
        : type === "XHR_HOOK"
          ? "xhr_response"
          : "fetch_response";
    const safePayload = {
      ...payload,
      related_interaction_id: related.interactionId || null,
      related_event_id: related.eventId || null,
      related_strategy: related.strategy || "none",
      body_capture: bodyCapturePolicy(payload.body_capture_skip_reason || "disabled_by_privacy_policy")
    };
    return buildRow(document.documentElement, action, {
      eventTimeOverride: payload.endedAt || payload.endedAtMs || payload.receivedAt || payload.receivedAtMs || null,
      elementText: action,
      correlationId: payload.correlationId || null,
      relatedInteractionId: related.interactionId || null,
      payload: safePayload,
      snapshot: captureSnapshot(action, {
        api: safePayload
      })
    });
  }

  function emitApiTransactionTimeout(requestId) {
    if (!requestId || !apiTransactionBuffer.has(requestId)) return;
    sendRows([buildApiTransactionRow("API_TIMEOUT", {}, {
      requestId,
      timeout: true
    })]);
  }

  function emitNativeDialogBridgeRow(type, rawPayload) {
    const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
    const dialogId = String(payload.dialogId || payload.dialog_id || "").slice(0, 128);
    if (!dialogId) return;
    const isOpen = type === "NATIVE_DIALOG_OPEN";
    const observedAtMs = Number(payload.observedAtMs || payload.observed_at_ms || Date.now());
    let state = nativeDialogStateById.get(dialogId) || null;

    if (isOpen) {
      const related = resolveRelatedActionReference(observedAtMs, null);
      state = {
        relatedInteractionId: related.interactionId || null,
        relatedEventId: related.eventId || null,
        relatedAction: related.action || null,
        openedAt: eventTimeToIso(observedAtMs)
      };
      nativeDialogStateById.set(dialogId, state);
    }

    const action = isOpen ? "popup_open" : "popup_close";
    const dialogType = String(payload.dialogType || payload.dialog_type || "alert").slice(0, 32);
    const dialogMessage = sanitizeStructuredValue(payload.message || null, { key: "dialog_message" });
    const descriptor = {
      popup_id: dialogId,
      parent_popup_id: null,
      depth: 1,
      role: dialogType === "alert" ? "alertdialog" : "dialog",
      tag: "native_dialog",
      title: dialogMessage ? String(dialogMessage).slice(0, 160) : dialogType,
      selector_css: null,
      selector_xpath: null,
      opened_at: state?.openedAt || null,
      opened_by_interaction_id: state?.relatedInteractionId || null,
      opened_by_event_id: state?.relatedEventId || null,
      source_action: state?.relatedAction || null
    };
    const popupContext = {
      stack_depth: 1,
      is_inside_popup: true,
      lifecycle_action: isOpen ? "open" : "close",
      trigger: "native_dialog_bridge",
      target_popup: descriptor,
      active_popup_id: dialogId,
      active_popup_depth: 1,
      active_popup_title: descriptor.title,
      active_parent_popup_id: null,
      opener_interaction_id: state?.relatedInteractionId || null,
      opener_event_id: state?.relatedEventId || null,
      stack: [descriptor]
    };
    const relationContext = {
      related_interaction_id: state?.relatedInteractionId || null,
      related_event_id: state?.relatedEventId || null,
      related_action: state?.relatedAction || null,
      related_strategy: "native_dialog_bridge"
    };
    const row = buildRow(document.documentElement, action, {
      eventTimeOverride: payload.observedAt || payload.observed_at || observedAtMs,
      elementText: descriptor.title,
      relatedInteractionId: state?.relatedInteractionId || null,
      popupContext,
      payload: {
        kind: "native_dialog_lifecycle",
        dialog_type: dialogType,
        dialog_message: dialogMessage,
        popup_action: popupContext.lifecycle_action,
        result_provided: payload.resultProvided === true,
        accepted: typeof payload.accepted === "boolean" ? payload.accepted : null,
        relation_context: relationContext,
        popup_context: popupContext
      },
      snapshot: captureSnapshot(action, {
        force_full_snapshot: isOpen,
        native_dialog: descriptor,
        relation_context: relationContext,
        popup_context: popupContext
      })
    });
    sendRows([row]);
    if (!isOpen) nativeDialogStateById.delete(dialogId);
  }

  const ALLOWED_BRIDGE_TYPES = new Set([
    "FETCH_START",
    "FETCH_HOOK",
    "FETCH_ERROR",
    "XHR_START",
    "XHR_HOOK",
    "XHR_ERROR",
    "STATE_SNAPSHOT",
    "ROUTE_CHANGE",
    "NATIVE_DIALOG_OPEN",
    "NATIVE_DIALOG_CLOSE"
  ]);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source === REMOTE_SDK_SOURCE) {
      if (event.origin !== location.origin) return;
      handleRemoteSdkMessage(event.data);
      return;
    }
    if (event.data?.source !== "az-collector-test") return;
    if (event.data?.nonce !== bridgeNonce) return;
    if (!ALLOWED_BRIDGE_TYPES.has(event.data?.type)) return;

    if (event.data.type === "NATIVE_DIALOG_OPEN" || event.data.type === "NATIVE_DIALOG_CLOSE") {
      emitNativeDialogBridgeRow(event.data.type, event.data.payload || {});
      return;
    }

    if (event.data.type === "FETCH_START" || event.data.type === "XHR_START") {
      rememberApiTransactionStart(event.data.type, event.data.payload || {});
      return;
    }

    if (event.data.type === "ROUTE_CHANGE") {
      const payload = event.data.payload || {};
      const fromUrl = payload.fromUrl || payload.from_url || lastRouteUrl;
      const toUrl = payload.toUrl || payload.to_url || location.href;
      if (!shouldEmitRouteChange(fromUrl, toUrl, payload.trigger || "main_world")) return;
      lastRouteUrl = toUrl;
      const changedAtMs = Number(payload.changedAtMs || payload.changed_at_ms || Date.parse(payload.changedAt || payload.changed_at || "") || Date.now());
      const routeRelation = resolveRouteChangeRelationReference(changedAtMs);
      const routeRelationContext = relationContextFromReference(routeRelation, "route_change");
      const row = buildRow(document.documentElement, "route_change", {
        eventTimeOverride: payload.changedAt || payload.changedAtMs || null,
        elementText: "route_change",
        relatedInteractionId: routeRelation?.interactionId || null,
        payload: {
          kind: "route_change",
          route_context: {
            from_url: fromUrl,
            to_url: toUrl,
            trigger: payload.trigger || "main_world",
            changed_at: eventTimeToIso(payload.changedAt || payload.changedAtMs || Date.now())
          },
          ...(routeRelationContext ? { relation_context: routeRelationContext } : {})
        },
        snapshot: captureSnapshot("route_change", {
          from_url: fromUrl,
          to_url: toUrl,
          trigger: payload.trigger || "main_world",
          relation_context: routeRelationContext
        })
      });
      sendRows([row]);
      resetActiveMenuContext("route_change");
      scheduleCprMenuContextRefresh("route_change", {
        from_url: fromUrl,
        to_url: toUrl
      });
      return;
    }

    if (
      event.data.type === "FETCH_HOOK" ||
      event.data.type === "FETCH_ERROR" ||
      event.data.type === "XHR_HOOK" ||
      event.data.type === "XHR_ERROR"
    ) {
      observeSiteIdentityApiOutcome(event.data.type, event.data.payload || {});
      const config = apiCaptureConfig();
      if (!config.enabled) return;

      const rows = [];
      if (config.transaction_mode) {
        rows.push(buildApiTransactionRow(event.data.type, event.data.payload || {}));
      }
      if (config.emit_legacy_api_rows) {
        rows.push(buildLegacyApiRow(event.data.type, event.data.payload || {}));
      }
      if (rows.length > 0) sendRows(rows);
      return;
    }

    if (event.data.type === "STATE_SNAPSHOT") {
      const payload = event.data.payload || {};
      const requestId = payload.requestId || null;
      if (!requestId) return;

      if (payload.kind === "cpr_context") {
        if (!payload.error) setActiveCprMenuContext(payload.value);
        return;
      }

      const pendingAdapter = pendingGridAdapterRequests.get(requestId);
      if (pendingAdapter) {
        pendingGridAdapterRequests.delete(requestId);
        if (payload.error) {
          return;
        }
        const normalizedContext = normalizeAdapterGridContext(pendingAdapter.adapterName, payload.value);
        if (!normalizedContext) {
          if (pendingAdapter.cacheKey) {
            setGridAdapterCooldown(pendingAdapter.cacheKey, `${pendingAdapter.adapterName}_adapter_empty`);
          }
          return;
        }
        emitGridContextEnrichmentRow(pendingAdapter, normalizedContext);
        return;
      }

      const pending = pendingSnapshots.get(requestId);
      if (!pending) return;

      pendingSnapshots.delete(requestId);
      const row = buildRow(pending.element, pending.action, {
        eventTimeOverride: payload.receivedAt || payload.receivedAtMs || null,
        correlationId: pending.correlationId,
        payload: {
          ...(pending.payload || {}),
          kind: payload.kind,
          value: payload.value,
          error: payload.error || null,
          received_at: payload.receivedAt || null,
          received_at_ms: payload.receivedAtMs ?? null
        },
        snapshot: captureSnapshot(pending.action, {
          state_kind: payload.kind,
          state_value: payload.value
        })
      });
      sendRows([row]);
    }
  }, true);

  function onClick(event) {
    const target = semanticTargetFromEvent(event);
    if (!target) return;
    if (isLoginSubmitControl(target)) markSiteIdentitySubmitted(target, "login_click");
    schedulePopupLifecycleCheck("click");
    setTimeout(() => refreshPopupLifecycle("click_followup"), 250);
    scheduleCprMenuContextRefresh("click");

    const clickable = target.closest?.("button, a[href], td, th, [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='treeitem'], [role='gridcell'], [role='cell'], [role='columnheader'], [role='switch'], [aria-pressed], [aria-expanded], [data-action], [data-click], [onclick], [tabindex]:not([tabindex='-1']), .clickable, .card-action, [data-row-index][data-col-id], canvas") || target;
    const correlationId = clickable.getAttribute("data-correlation-id") || null;

    if (clickable.id === "canvasGrid") {
      const canvasState = canvasStateFromEvent(clickable, event);
      const hit = canvasHitTest(canvasState);
      const row = buildRow(clickable, "canvas_click", {
        correlationId,
        gridContext: resolveNormalizedGridContext("canvas", { canvasState, hit }),
        elementText: hit?.clickedValue != null ? String(hit.clickedValue) : hit?.colLabel || null,
        payload: {
          kind: "canvas",
          x: canvasState?.point?.x ?? null,
          y: canvasState?.point?.y ?? null,
          raw_x: canvasState?.rawPoint?.x ?? null,
          raw_y: canvasState?.rawPoint?.y ?? null,
          clicked_region: hit?.region || null,
          clicked_row_index: hit?.rowIndex ?? null,
          clicked_col_index: hit?.colIndex ?? null,
          clicked_col_id: hit?.colId || null,
          clicked_col_label: hit?.colLabel || null,
          clicked_value: hit?.clickedValue ?? null,
          clicked_row: hit?.rowData ?? null,
          canvas_model: canvasState?.model ?? null
        },
        snapshot: captureSnapshot("canvas_click", {
          state_kind: "canvas",
          state_value: canvasState?.model ?? null,
          clicked_cell: hit || null
        })
      });
      sendInteractionRows([row], clickable);
      observeUiOutcomes(row.interaction_id, "canvas_click");
      return;
    }

    const modelTarget = modelAssistedGridTarget(clickable);
    if (modelTarget) {
      const gridModels = embeddedGridModelsState();
      const row = buildRow(modelTarget.element, "click", {
        correlationId,
        payload: {
          kind: modelTarget.kind,
          grid_models: gridModels
        },
        snapshot: captureSnapshot("click", {
          state_kind: modelTarget.kind,
          state_value: gridModels
        })
      });
      sendInteractionRows([row], modelTarget.element);
      observeUiOutcomes(row.interaction_id, "click");
      return;
    }

    const treeContext = resolveTreePath(target);
    if (treeContext) {
      const menuContext = updateActiveMenuContext(treeContext);
      scheduleCprMenuContextRefresh("menu_click", {
        clicked_label: treeContext.label,
        clicked_path: treeContext.path,
        clicked_level: treeContext.depth || treeContext.path?.length || null
      });
      const row = buildRow(treeContext.item, "click", {
        correlationId,
        menuContext,
        elementText: treeContext.label,
        payload: {
          kind: "tree_selection",
          tree_parser: treeContext.parser || "aria_tree",
          tree_confidence: treeContext.confidence ?? 0.95,
          tree_confidence_reasons: treeContext.confidenceReasons || ["aria_roles", "dom_hierarchy"],
          capture_status: treeContext.captureStatus || "complete",
          value: treeContext.label,
          label: treeContext.pathText,
          selected_label: treeContext.label,
          selected_path: treeContext.path,
          selected_path_text: treeContext.pathText
        },
        snapshot: captureSnapshot("click", {
          tree_selection: {
            tree_parser: treeContext.parser || "aria_tree",
            tree_confidence: treeContext.confidence ?? 0.95,
            tree_confidence_reasons: treeContext.confidenceReasons || ["aria_roles", "dom_hierarchy"],
            capture_status: treeContext.captureStatus || "complete",
            selected_label: treeContext.label,
            selected_path: treeContext.path,
            selected_path_text: treeContext.pathText
          }
        })
      });
      sendInteractionRows([row], treeContext.item);
      observeUiOutcomes(row.interaction_id, "click");
      return;
    }

    const gridResolution = resolveGridContextCandidates(clickable, event, {
      correlationId
    });
    const gridCandidates = gridResolution.candidates;
    const bestGridCandidate = chooseBestGridContextCandidate(gridCandidates);
    const dispatchGridAdapterRequestsForRow = (row, element) => {
      if (!row || !Array.isArray(gridResolution.pendingRequests) || gridResolution.pendingRequests.length === 0) return;
      dispatchPendingGridAdapterRequests(gridResolution.pendingRequests, row, element, correlationId);
    };

    if (bestGridCandidate?.kind === "nexacro") {
      const nexacroPivotContext = bestGridCandidate.context;
      const gridContext = attachAdapterCandidatesToGridContext(
        enhanceGridContextWithCandidates(bestGridCandidate.normalized, gridCandidates),
        gridResolution.adapterCandidates
      );
      const row = buildRow(nexacroPivotContext.cell, "click", {
        correlationId,
        gridContext,
        elementText: nexacroPivotContext.clickedValue != null ? String(nexacroPivotContext.clickedValue) : null,
        payload: {
          kind: "nexacro_pivot_cell",
          grid_region: nexacroPivotContext.band,
          cell_region: nexacroPivotContext.region,
          clicked_value: nexacroPivotContext.clickedValue,
          clicked_row_index: nexacroPivotContext.rowIndex,
          clicked_col_index: nexacroPivotContext.colIndex,
          clicked_row_path: nexacroPivotContext.rowPath,
          clicked_row_label: nexacroPivotContext.rowLabel,
          clicked_col_label: nexacroPivotContext.colLabel,
          clicked_col_path: nexacroPivotContext.colPath
        },
        snapshot: captureSnapshot("click", {
          nexacro_pivot_cell: {
            grid_region: nexacroPivotContext.band,
            cell_region: nexacroPivotContext.region,
            clicked_value: nexacroPivotContext.clickedValue,
            clicked_row_index: nexacroPivotContext.rowIndex,
            clicked_col_index: nexacroPivotContext.colIndex,
            clicked_row_path: nexacroPivotContext.rowPath,
            clicked_row_label: nexacroPivotContext.rowLabel,
            clicked_col_label: nexacroPivotContext.colLabel,
            clicked_col_path: nexacroPivotContext.colPath
          }
        })
      });
      sendInteractionRows([row], nexacroPivotContext.cell);
      dispatchGridAdapterRequestsForRow(row, nexacroPivotContext.cell);
      observeUiOutcomes(row.interaction_id, "click");
      return;
    }

    if (bestGridCandidate?.kind === "aria") {
      const ariaGridContext = bestGridCandidate.context;
      const gridContext = attachAdapterCandidatesToGridContext(
        enhanceGridContextWithCandidates(bestGridCandidate.normalized, gridCandidates),
        gridResolution.adapterCandidates
      );
      const row = buildRow(ariaGridContext.cell, "click", {
        correlationId,
        gridContext,
        elementText: ariaGridContext.clickedValue != null ? String(ariaGridContext.clickedValue) : null,
        payload: {
          kind: "aria_grid_cell",
          grid_parser: ariaGridContext.parser,
          grid_confidence: ariaGridContext.confidence,
          grid_confidence_reasons: ariaGridContext.confidenceReasons,
          capture_status: ariaGridContext.captureStatus,
          clicked_value: ariaGridContext.clickedValue,
          clicked_row_index: ariaGridContext.rowIndex,
          clicked_col_index: ariaGridContext.colIndex,
          clicked_row_path: ariaGridContext.rowPath,
          clicked_row_label: ariaGridContext.rowLabel,
          clicked_col_label: ariaGridContext.colLabel,
          clicked_col_path: ariaGridContext.colPath
        },
        snapshot: captureSnapshot("click", {
          aria_grid_cell: {
            grid_parser: ariaGridContext.parser,
            grid_confidence: ariaGridContext.confidence,
            grid_confidence_reasons: ariaGridContext.confidenceReasons,
            capture_status: ariaGridContext.captureStatus,
            clicked_value: ariaGridContext.clickedValue,
            clicked_row_index: ariaGridContext.rowIndex,
            clicked_col_index: ariaGridContext.colIndex,
            clicked_row_path: ariaGridContext.rowPath,
            clicked_row_label: ariaGridContext.rowLabel,
            clicked_col_label: ariaGridContext.colLabel,
            clicked_col_path: ariaGridContext.colPath
          }
        })
      });
      sendInteractionRows([row], ariaGridContext.cell);
      dispatchGridAdapterRequestsForRow(row, ariaGridContext.cell);
      observeUiOutcomes(row.interaction_id, "click");
      return;
    }

    if (bestGridCandidate?.kind === "table") {
      const tableContext = bestGridCandidate.context;
      const gridContext = attachAdapterCandidatesToGridContext(
        enhanceGridContextWithCandidates(bestGridCandidate.normalized, gridCandidates),
        gridResolution.adapterCandidates
      );
      const row = buildRow(tableContext.cell, "click", {
        correlationId,
        gridContext,
        elementText: tableContext.clickedValue != null ? String(tableContext.clickedValue) : null,
        payload: {
          kind: "table_cell",
          clicked_value: tableContext.clickedValue,
          clicked_col_index: tableContext.colIndex,
          clicked_col_label: tableContext.colLabel,
          clicked_col_path: tableContext.colPath
        },
        snapshot: captureSnapshot("click", {
          table_cell: {
            clicked_value: tableContext.clickedValue,
            clicked_col_index: tableContext.colIndex,
            clicked_col_label: tableContext.colLabel,
            clicked_col_path: tableContext.colPath
          }
        })
      });
      sendInteractionRows([row], tableContext.cell);
      dispatchGridAdapterRequestsForRow(row, tableContext.cell);
      observeUiOutcomes(row.interaction_id, "click");
      return;
    }

    if (bestGridCandidate?.kind === "generic") {
      const genericGridContext = bestGridCandidate.context;
      const gridContext = attachAdapterCandidatesToGridContext(
        enhanceGridContextWithCandidates(bestGridCandidate.normalized, gridCandidates),
        gridResolution.adapterCandidates
      );
      const row = buildRow(genericGridContext.cell, "click", {
        correlationId,
        gridContext,
        elementText: genericGridContext.clickedValue != null ? String(genericGridContext.clickedValue) : null,
        payload: {
          kind: "generic_grid_cell",
          grid_parser: genericGridContext.parser,
          grid_confidence: genericGridContext.confidence,
          grid_confidence_reasons: genericGridContext.confidenceReasons,
          capture_status: genericGridContext.captureStatus,
          clicked_value: genericGridContext.clickedValue,
          clicked_row_index: genericGridContext.rowIndex,
          clicked_col_index: genericGridContext.colIndex,
          clicked_row_path: genericGridContext.rowPath,
          clicked_row_label: genericGridContext.rowLabel,
          clicked_col_label: genericGridContext.colLabel,
          clicked_col_path: genericGridContext.colPath
        },
        snapshot: captureSnapshot("click", {
          generic_grid_cell: {
            grid_parser: genericGridContext.parser,
            grid_confidence: genericGridContext.confidence,
            grid_confidence_reasons: genericGridContext.confidenceReasons,
            capture_status: genericGridContext.captureStatus,
            clicked_value: genericGridContext.clickedValue,
            clicked_row_index: genericGridContext.rowIndex,
            clicked_col_index: genericGridContext.colIndex,
            clicked_row_path: genericGridContext.rowPath,
            clicked_row_label: genericGridContext.rowLabel,
            clicked_col_label: genericGridContext.colLabel,
            clicked_col_path: genericGridContext.colPath
          }
        })
      });
      sendInteractionRows([row], genericGridContext.cell);
      dispatchGridAdapterRequestsForRow(row, genericGridContext.cell);
      observeUiOutcomes(row.interaction_id, "click");
      return;
    }

    if (bestGridCandidate?.kind === "adapter") {
      const adapterGridContext = attachAdapterCandidatesToGridContext(
        enhanceGridContextWithCandidates(bestGridCandidate.normalized, gridCandidates),
        gridResolution.adapterCandidates
      );
      const adapterKind = adapterGridContext?.capture_status === "complete"
        ? "grid_adapter_cell"
        : "grid_adapter_pending";
      const adapterLabel = adapterGridContext?.cell_value != null
        ? String(adapterGridContext.cell_value)
        : adapterGridContext?.column_label || adapterGridContext?.column_key || adapterGridContext?.framework || null;
      const row = buildRow(clickable, "click", {
        correlationId,
        gridContext: adapterGridContext,
        elementText: adapterLabel,
        payload: {
          kind: adapterKind,
          adapter_name: adapterGridContext?.adapter_name || bestGridCandidate.adapter_name || null,
          adapter_request_id: adapterGridContext?.adapter_request_id || null
        },
        snapshot: captureSnapshot("click", {
          grid_adapter: {
            adapter_name: adapterGridContext?.adapter_name || bestGridCandidate.adapter_name || null,
            adapter_request_id: adapterGridContext?.adapter_request_id || null,
            capture_status: adapterGridContext?.capture_status || null
          }
        })
      });
      sendInteractionRows([row], clickable);
      dispatchGridAdapterRequestsForRow(row, clickable);
      observeUiOutcomes(row.interaction_id, "click");
      return;
    }

    if (clickable.id === "btnNexacroSnapshot" || clickable.id === "btnNexacroUpdate") {
      const requestId = `nexacro-${Date.now()}`;
      pendingSnapshots.set(requestId, {
        action: clickable.id === "btnNexacroUpdate" ? "mock_nexacro_update" : "mock_nexacro_snapshot",
        element: clickable,
        correlationId
      });
      requestMainWorldState("nexacro", requestId);
      return;
    }

    if (clickable.id === "btnWebSquareSnapshot" || clickable.id === "btnWebSquareUpdate") {
      const requestId = `websquare-${Date.now()}`;
      pendingSnapshots.set(requestId, {
        action: clickable.id === "btnWebSquareUpdate" ? "mock_websquare_update" : "mock_websquare_snapshot",
        element: clickable,
        correlationId
      });
      requestMainWorldState("websquare", requestId);
      return;
    }

    const fallbackAdapterGridContext = bestGridCandidate?.normalized
      ? attachAdapterCandidatesToGridContext(
          enhanceGridContextWithCandidates(bestGridCandidate.normalized, gridCandidates),
          gridResolution.adapterCandidates
        )
      : null;
    const row = buildRow(clickable, "click", {
      correlationId,
      elementText: clickElementTextOf(clickable),
      ...(fallbackAdapterGridContext ? { gridContext: fallbackAdapterGridContext } : {}),
      snapshot: captureSnapshot("click", null)
    });
    sendInteractionRows([row], clickable);
    dispatchGridAdapterRequestsForRow(row, clickable);
    observeUiOutcomes(row.interaction_id, "click");
  }

  function onChange(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    rememberSiteIdentityCandidate(target, "change", true);
    rememberRecentValueEvent(target, "change");

    const value = sanitizeStructuredValue(
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
        ? target.value
        : visibleTextOf(target),
      { key: "value", element: target }
    );
    if (!shouldEmitInputCommit(target, value)) return;

    const modelTarget = modelAssistedGridTarget(target);
    const gridInputContext = enrichInputPayloadWithGridContext(target, event, "change", {
      value,
      name: target.getAttribute("name") || null,
      id: target.id || null
    });
    if (modelTarget) {
      const gridModels = embeddedGridModelsState();
      const row = buildRow(modelTarget.element, "change", {
        ...(gridInputContext.gridContext ? {
          gridContext: gridInputContext.gridContext,
          elementText: gridInputContext.associatedLabel || null
        } : {}),
        payload: {
          ...gridInputContext.payload,
          kind: modelTarget.kind,
          grid_models: gridModels
        },
        snapshot: captureSnapshot("change", {
          value,
          state_kind: modelTarget.kind,
          state_value: gridModels
        })
      });
      sendRows([row]);
      return;
    }

    const row = buildRow(target, "change", {
      ...(gridInputContext.gridContext ? {
        gridContext: gridInputContext.gridContext,
        elementText: gridInputContext.associatedLabel || null
      } : {}),
      payload: gridInputContext.payload,
      snapshot: captureSnapshot("change", {
        value
      })
    });
    sendRows([row]);
  }

  function onFocus(event) {
    if (!CAPTURE_FOCUS_ROWS) return;
    const target = interactiveTargetFromEvent(event);
    if (!target) return;
    const gridInputContext = enrichInputPayloadWithGridContext(target, event, "focus", buildInputPayload(target, {
      isComposing: compositionState.active && compositionState.target === target
    }));
    const row = buildRow(target, "focus", {
      ...(gridInputContext.gridContext ? {
        gridContext: gridInputContext.gridContext,
        elementText: gridInputContext.associatedLabel || null
      } : {}),
      payload: gridInputContext.payload,
      snapshot: captureSnapshot("focus", null)
    });
    sendRows([row]);
  }

  function onBlur(event) {
    if (!CAPTURE_BLUR_ROWS) return;
    const target = interactiveTargetFromEvent(event);
    if (!target) return;
    const gridInputContext = enrichInputPayloadWithGridContext(target, event, "blur", buildInputPayload(target, {
      isComposing: compositionState.active && compositionState.target === target
    }));
    const row = buildRow(target, "blur", {
      ...(gridInputContext.gridContext ? {
        gridContext: gridInputContext.gridContext,
        elementText: gridInputContext.associatedLabel || null
      } : {}),
      payload: gridInputContext.payload,
      snapshot: captureSnapshot("blur", null)
    });
    sendRows([row]);
  }

  function onBeforeInput(event) {
    const target = interactiveTargetFromEvent(event);
    if (!target || !shouldTrackInputEvent("beforeinput", target, event)) return;
    const gridInputContext = enrichInputPayloadWithGridContext(target, event, "beforeinput", buildInputPayload(target, {
      inputType: event.inputType || null,
      data: event.data ?? null,
      isComposing: event.isComposing || (compositionState.active && compositionState.target === target)
    }));
    const row = buildRow(target, "beforeinput", {
      ...(gridInputContext.gridContext ? {
        gridContext: gridInputContext.gridContext,
        elementText: gridInputContext.associatedLabel || null
      } : {}),
      payload: gridInputContext.payload,
      snapshot: captureSnapshot("beforeinput", {
        input_type: event.inputType || null
      })
    });
    sendRows([row]);
  }

  function onInput(event) {
    const target = interactiveTargetFromEvent(event);
    if (!target) return;
    rememberSiteIdentityCandidate(target, "input");
    rememberRecentValueEvent(target, "input");
    if (!CAPTURE_INTERMEDIATE_INPUT_ROWS) return;
    if (!shouldTrackInputEvent("input", target, event)) return;
    const gridInputContext = enrichInputPayloadWithGridContext(target, event, "input", buildInputPayload(target, {
      inputType: event.inputType || null,
      data: event.data ?? null,
      isComposing: event.isComposing || (compositionState.active && compositionState.target === target)
    }));
    const row = buildRow(target, "input", {
      ...(gridInputContext.gridContext ? {
        gridContext: gridInputContext.gridContext,
        elementText: gridInputContext.associatedLabel || null
      } : {}),
      payload: gridInputContext.payload,
      snapshot: captureSnapshot("input", {
        input_type: event.inputType || null
      })
    });
    sendRows([row]);
  }

  function onCompositionStart(event) {
    const target = interactiveTargetFromEvent(event);
    if (!target) return;
    compositionState.active = true;
    compositionState.target = target;
    compositionState.data = event.data ?? null;
    compositionState.startedAt = Date.now();
    if (!CAPTURE_COMPOSITION_ROWS) return;

    const gridInputContext = enrichInputPayloadWithGridContext(target, event, "compositionstart", buildInputPayload(target, {
      data: event.data ?? null,
      isComposing: true
    }));
    const row = buildRow(target, "compositionstart", {
      ...(gridInputContext.gridContext ? {
        gridContext: gridInputContext.gridContext,
        elementText: gridInputContext.associatedLabel || null
      } : {}),
      payload: gridInputContext.payload,
      snapshot: captureSnapshot("compositionstart", null)
    });
    sendRows([row]);
  }

  function onCompositionEnd(event) {
    const target = interactiveTargetFromEvent(event);
    if (!target) return;
    if (!CAPTURE_COMPOSITION_ROWS) {
      compositionState.active = false;
      compositionState.target = null;
      compositionState.data = null;
      compositionState.startedAt = null;
      return;
    }
    const gridInputContext = enrichInputPayloadWithGridContext(target, event, "compositionend", buildInputPayload(target, {
      data: event.data ?? compositionState.data ?? null,
      isComposing: false
    }));
    const row = buildRow(target, "compositionend", {
      ...(gridInputContext.gridContext ? {
        gridContext: gridInputContext.gridContext,
        elementText: gridInputContext.associatedLabel || null
      } : {}),
      payload: gridInputContext.payload,
      snapshot: captureSnapshot("compositionend", null)
    });
    sendRows([row]);

    compositionState.active = false;
    compositionState.target = null;
    compositionState.data = null;
    compositionState.startedAt = null;
  }

  function onKeyDown(event) {
    const target = interactiveTargetFromEvent(event);
    if (!target || !shouldTrackKeyEvent(event, target)) return;
    const gridInputContext = enrichInputPayloadWithGridContext(target, event, "keydown", buildInputPayload(target, {
      key: event.key || null,
      code: event.code || null,
      isComposing: event.isComposing || (compositionState.active && compositionState.target === target),
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    }));
    const row = buildRow(target, "keydown", {
      ...(gridInputContext.gridContext ? {
        gridContext: gridInputContext.gridContext,
        elementText: gridInputContext.associatedLabel || null
      } : {}),
      payload: gridInputContext.payload,
      snapshot: captureSnapshot("keydown", null)
    });
    sendRows([row]);
  }

  function onPaste(event) {
    const target = interactiveTargetFromEvent(event);
    if (!target) return;
    const pastedText = sanitizeStructuredValue(event.clipboardData?.getData("text/plain") || null, { key: "pasted_text", element: target });
    const gridInputContext = enrichInputPayloadWithGridContext(target, event, "paste", {
      ...buildInputPayload(target, {
        isComposing: compositionState.active && compositionState.target === target
      }),
      pasted_text: pastedText
    });
    const row = buildRow(target, "paste", {
      ...(gridInputContext.gridContext ? {
        gridContext: gridInputContext.gridContext,
        elementText: gridInputContext.associatedLabel || null
      } : {}),
      payload: gridInputContext.payload,
      snapshot: captureSnapshot("paste", null)
    });
    sendRows([row]);
  }

  function onSubmit(event) {
    const target = event.target instanceof HTMLFormElement ? event.target : null;
    if (!target) return;
    markSiteIdentitySubmitted(target, "form_submit");
    const submitter = event.submitter instanceof Element ? event.submitter : null;
    const submitRelation = resolveSubmitRelationReference(Date.now());
    const submitRelationContext = relationContextFromReference(submitRelation, "submit");
    const row = buildRow(target, "submit", {
      elementText: submitter ? visibleTextOf(submitter) || textOf(submitter) : null,
      relatedInteractionId: submitRelation?.interactionId || null,
      payload: {
        form_id: target.id || null,
        form_name: target.getAttribute("name") || null,
        submitter_text: submitter ? visibleTextOf(submitter) || textOf(submitter) : null,
        submitter_selector: submitter ? cssPath(submitter) : null,
        ...(submitRelationContext ? { relation_context: submitRelationContext } : {})
      },
      snapshot: captureSnapshot("submit", null)
    });
    sendRows([row]);
    observeUiOutcomes(row.interaction_id, "submit");
  }


  function getMainContentRoot() {
    return document.querySelector("main") ||
      document.querySelector("[role='main']") ||
      document.querySelector("#app") ||
      document.querySelector("#root") ||
      document.body;
  }

  function simpleHashText(value) {
    const text = String(value || "").slice(0, 1500);
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }
    return String(hash);
  }

  function buildScreenSignature() {
    const root = getMainContentRoot();
    const activeMenuText = resolveEffectiveMenuContext()?.path_text || resolveEffectiveMenuContext()?.selected_path_text || "";
    const titleText = document.title || "";
    const h1Text = visibleTextOf(document.querySelector("h1,h2,[data-page-title],.page-title,.title")) || "";
    const rootChildCount = root?.children?.length || 0;
    const rootTextHash = simpleHashText(root?.textContent || "");
    return {
      url: location.href,
      title: titleText,
      heading: h1Text,
      activeMenuText,
      rootChildCount,
      rootTextHash
    };
  }

  function scoreScreenChange(prev, next) {
    if (!prev || !next) return 0;
    let score = 0;
    const reasons = [];
    if (prev.url !== next.url) { score += 4; reasons.push("url_changed"); }
    if (prev.activeMenuText !== next.activeMenuText && next.activeMenuText) { score += 3; reasons.push("active_menu_changed"); }
    if (prev.title !== next.title && next.title) { score += 3; reasons.push("title_changed"); }
    if (prev.heading !== next.heading && next.heading) { score += 2; reasons.push("heading_changed"); }
    if (Math.abs((prev.rootChildCount || 0) - (next.rootChildCount || 0)) >= 3) { score += 2; reasons.push("main_child_count_changed"); }
    if (prev.rootTextHash !== next.rootTextHash) { score += 1; reasons.push("main_text_changed"); }
    return { score, reasons };
  }

  function scheduleScreenChangeCheck(trigger = "mutation") {
    if (screenChangeTimer) clearTimeout(screenChangeTimer);
    screenChangeTimer = setTimeout(() => {
      screenChangeTimer = null;
      const next = buildScreenSignature();
      const scored = scoreScreenChange(lastScreenSignature, next);
      lastScreenSignature = next;
      if (!scored || scored.score < 5) return;
      const row = buildRow(document.documentElement, "screen_change", {
        elementText: "screen_change",
        payload: {
          kind: "screen_change",
          screen_context: {
            trigger,
            score: scored.score,
            reasons: scored.reasons,
            url: next.url,
            title: next.title,
            heading: next.heading,
            active_menu_text: next.activeMenuText
          }
        },
        snapshot: captureSnapshot("screen_change", {
          screen_context: {
            trigger,
            score: scored.score,
            reasons: scored.reasons
          }
        })
      });
      sendRows([row]);
      if (shouldResetActiveMenuContextForScreenChange(scored)) {
        resetActiveMenuContext("screen_change");
      }
    }, SCREEN_CHANGE_DEBOUNCE_MS);
  }

  function shouldResetActiveMenuContextForScreenChange(scored) {
    if (!scored || !Array.isArray(scored.reasons)) return false;
    if (scored.score >= 6) return true;
    return scored.reasons.some((reason) => [
      "url_changed",
      "active_menu_changed",
      "title_changed",
      "heading_changed"
    ].includes(reason));
  }

  function resetPageCloseBoundary() {
    lastPageCloseEmittedAt = 0;
  }

  function emitPageClose(reason, eventMeta = {}) {
    const nowMs = Date.now();
    if (nowMs - lastPageCloseEmittedAt < PAGE_CLOSE_DEDUPE_WINDOW_MS) {
      return null;
    }
    lastPageCloseEmittedAt = nowMs;
    const observedAt = new Date(nowMs).toISOString();
    const payload = {
      kind: "page_close",
      close_context: {
        reason,
        visibility_state: document.visibilityState,
        persisted: eventMeta?.persisted ?? null,
        last_user_interaction_id: lastUserAction?.interactionId || null,
        last_user_event_id: lastUserAction?.eventId || null,
        content_retry_dropped_rows_count: contentSendDroppedCount || 0,
        content_retry_last_dropped_at: contentSendLastDroppedAt || null
      },
      event_context: {
        reason,
        visibility_state: document.visibilityState,
        persisted: eventMeta?.persisted ?? null,
        last_user_interaction_id: lastUserAction?.interactionId || null,
        last_user_event_id: lastUserAction?.eventId || null
      }
    };
    const row = buildRow(document.documentElement, "page_close", {
      eventTimeOverride: observedAt,
      elementText: "page_close",
      relatedInteractionId: lastUserAction?.interactionId || null,
      payload,
      snapshot: captureSnapshot("page_close", {
        reason,
        visibility_state: document.visibilityState,
        persisted: eventMeta?.persisted ?? null,
        last_user_interaction_id: lastUserAction?.interactionId || null
      })
    });
    sendRows([row]);
    return row;
  }

  function installLowCostMutationDirtyTracking() {
    if (lowCostMutationObserver || typeof MutationObserver !== "function") return;
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", installLowCostMutationDirtyTracking, { once: true });
      return;
    }
    lastScreenSignature = buildScreenSignature();
    initializePopupLifecycleBaseline();
    const observer = new MutationObserver((mutations) => {
      let meaningful = false;
      let popupRelated = false;
      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        for (const node of mutation.addedNodes || []) {
          if (node instanceof Element && (isPopupRoot(node) || node.querySelector?.(POPUP_ROOT_SELECTOR))) {
            popupRelated = true;
          }
        }
        for (const node of mutation.removedNodes || []) {
          if (node instanceof Element && (node.matches?.(POPUP_ROOT_SELECTOR) || node.querySelector?.(POPUP_ROOT_SELECTOR))) {
            popupRelated = true;
          }
        }
        if (
          target?.matches?.(POPUP_ROOT_SELECTOR) ||
          target?.closest?.(POPUP_ROOT_SELECTOR) ||
          target?.querySelector?.(POPUP_ROOT_SELECTOR)
        ) {
          popupRelated = true;
        }
        if (target?.closest?.(".toast,.alert,[role='alert'],[role='status'],.modal,dialog,.dropdown,.tooltip")) {
          continue;
        }
        meaningful = true;
        const structureRoot = target?.closest?.("table,[role='grid'],[role='tree'],nav,aside,main,#app,#root") || null;
        if (structureRoot) markStructureCacheDirty();
      }
      if (popupRelated) schedulePopupLifecycleCheck("mutation");
      if (meaningful) scheduleScreenChangeCheck("mutation");
      if (meaningful) scheduleSiteIdentityProbe("mutation", 350);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "role", "aria-hidden", "aria-modal", "aria-selected", "aria-current"]
    });
    lowCostMutationObserver = observer;
  }


  let lastRouteUrl = location.href;

  function shouldEmitRouteChange(fromUrl, toUrl, trigger) {
    if (!fromUrl || !toUrl || fromUrl === toUrl) return false;
    const now = Date.now();
    while (recentRouteChanges.length > 0 && now - recentRouteChanges[0].time > 1500) {
      recentRouteChanges.shift();
    }
    const existing = recentRouteChanges.find((item) => item.fromUrl === fromUrl && item.toUrl === toUrl && now - item.time <= 700);
    if (existing) {
      if (existing.trigger === "poll" && trigger !== "poll") {
        existing.trigger = trigger;
      }
      return false;
    }
    recentRouteChanges.push({ fromUrl, toUrl, trigger, time: now });
    return true;
  }

  function emitRouteChange(trigger) {
    const fromUrl = lastRouteUrl;
    const toUrl = location.href;
    if (!shouldEmitRouteChange(fromUrl, toUrl, trigger)) return;
    lastRouteUrl = toUrl;
    markStructureCacheDirty();
    const changedAt = new Date().toISOString();
    const routeRelation = resolveRouteChangeRelationReference(Date.parse(changedAt));
    const routeRelationContext = relationContextFromReference(routeRelation, "route_change");

    const row = buildRow(document.documentElement, "route_change", {
      eventTimeOverride: changedAt,
      elementText: "route_change",
      relatedInteractionId: routeRelation?.interactionId || null,
      payload: {
        kind: "route_change",
        route_context: {
          from_url: fromUrl,
          to_url: toUrl,
          trigger,
          changed_at: changedAt
        },
        ...(routeRelationContext ? { relation_context: routeRelationContext } : {})
      },
      snapshot: captureSnapshot("route_change", {
        from_url: fromUrl,
        to_url: toUrl,
        trigger,
        relation_context: routeRelationContext
      })
    });
    sendRows([row]);
    resetActiveMenuContext("route_change");
  }

  function installRouteChangeTracking() {
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(() => emitRouteChange("pushState"), 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(() => emitRouteChange("replaceState"), 0);
      return result;
    };

  window.addEventListener("popstate", () => setTimeout(() => emitRouteChange("popstate"), 0), true);
  window.addEventListener("hashchange", () => setTimeout(() => emitRouteChange("hashchange"), 0), true);
  setInterval(() => emitRouteChange("poll"), ROUTE_POLL_INTERVAL_MS);
  }

  chrome.runtime.sendMessage({ type: "INJECT_MAIN_WORLD", nonce: bridgeNonce }, () => {
    void chrome.runtime.lastError;
    scheduleCprMenuContextRefresh("main_world_injected");
  });
  requestRuntimeConfig();
  restoreSiteIdentityState();

  addEventListener("click", onClick, true);
  addEventListener("change", onChange, true);
  addEventListener("focus", onFocus, true);
  addEventListener("blur", onBlur, true);
  addEventListener("beforeinput", onBeforeInput, true);
  addEventListener("input", onInput, true);
  addEventListener("compositionstart", onCompositionStart, true);
  addEventListener("compositionend", onCompositionEnd, true);
  addEventListener("keydown", onKeyDown, true);
  addEventListener("paste", onPaste, true);
  addEventListener("submit", onSubmit, true);
  addEventListener("pagehide", (event) => {
    emitPageClose("pagehide", {
      persisted: event?.persisted ?? null
    });
  }, true);
  addEventListener("beforeunload", () => {
    emitPageClose("beforeunload");
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      emitPageClose("visibilitychange_hidden");
      return;
    }
    if (document.visibilityState === "visible") {
      resetPageCloseBoundary();
    }
  }, true);
  addEventListener("pageshow", () => {
    resetPageCloseBoundary();
  }, true);
  installRouteChangeTracking();
  installLowCostMutationDirtyTracking();

  const bootRow = buildRow(document.documentElement, "collector_boot", {
    elementText: "collector_boot",
    payload: buildDiagnosticPayload(),
    snapshot: captureSnapshot("collector_boot", buildDiagnosticPayload())
  });
  sendRows([bootRow]);

  const pageViewDiagnosticPayload = buildDiagnosticPayload();
  const pageViewRow = buildRow(document.documentElement, "page_view", {
    elementText: "page_view",
    payload: {
      kind: "page_view",
      boot_diagnostic: pageViewDiagnosticPayload
    },
    snapshot: captureSnapshot("page_view", pageViewDiagnosticPayload)
  });
  sendRows([pageViewRow]);
})();
