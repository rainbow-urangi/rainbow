// 컨텐츠 스크립트가 보내는 배치를 수신해 저장(우선 storage.local로)
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg?.type === "BATCH_EVENTS") {
    const key = `batch_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    await chrome.storage.local.set({ [key]: msg.payload });
    console.log("[BATCH_EVENTS] saved:", msg.payload);
    sendResponse({ ok: true });
    return true;
  }
});

// (선택) 네트워크 요청 감지 시 플러시 트리거
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0) {
      chrome.tabs.sendMessage(details.tabId, { type: "FLUSH_REQUEST" }).catch(()=>{});
    }
  },
  { urls: ["<all_urls>"] }
);
