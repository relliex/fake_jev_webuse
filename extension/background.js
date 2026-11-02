/**
 * Lite-JEV: Background Service Worker
 * Universal Browser Agent Harness: Manages side panel, tab routing, native navigation & on-demand content injection
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Lite-JEV] Universal Browser Agent Extension active.");
});

// Open Side Panel on action click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab && tab.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (err) {
    console.error("[Lite-JEV] Failed to open side panel:", err);
  }
});

/**
 * Checks whether a URL supports standard content script injection
 */
function isInjectableUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("file://")
  );
}

/**
 * Gets the actual focused target web tab the user is interacting with
 * (Filters out the extension's own side panel UI)
 */
async function getTargetActiveTab() {
  const currentExtId = chrome.runtime.id;

  // 1. Focused window active tab (not the extension's own side panel)
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  for (const tab of activeTabs) {
    if (tab.url && !tab.url.includes(currentExtId)) {
      return tab;
    }
  }

  // 2. Any active tab across windows (not the extension)
  const allActive = await chrome.tabs.query({ active: true });
  for (const tab of allActive) {
    if (tab.url && !tab.url.includes(currentExtId)) {
      return tab;
    }
  }

  // 3. Fallback to any non-extension tab
  const allTabs = await chrome.tabs.query({});
  for (let i = allTabs.length - 1; i >= 0; i--) {
    const t = allTabs[i];
    if (t.url && !t.url.includes(currentExtId)) {
      return t;
    }
  }

  return allTabs.length > 0 ? allTabs[allTabs.length - 1] : null;
}

/**
 * Waits until tab navigation completes or times out
 */
function waitForTabLoaded(tabId, timeoutMs = 9000) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(onUpdatedListener);
        resolve();
      }
    }, timeoutMs);

    function onUpdatedListener(tid, changeInfo) {
      if (tid === tabId && changeInfo.status === "complete") {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdatedListener);
          resolve();
        }
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdatedListener);
  });
}

/**
 * Ensures content script & css are injected into the page
 */
async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/content.css"],
    });
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content.js"],
    });
  } catch (_) {}
  await new Promise((r) => setTimeout(r, 150));
}

async function sendToWebTabWithAutoInject(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (err) {
    // If not injected, inject and retry
    try {
      await ensureContentScriptInjected(tabId);
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch (injErr) {
      throw new Error(`页面注入与通信失败: ${injErr.message || err.message}`);
    }
  }
}

/**
 * Executes native browser-level URL navigation on the target tab
 */
async function executeNativeNavigation(tabId, targetUrl) {
  let url = targetUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file://")) {
    url = "https://" + url;
  }
  await chrome.tabs.update(tabId, { url });
  await waitForTabLoaded(tabId, 9000);
  await ensureContentScriptInjected(tabId);
  return {
    ok: true,
    action: "GOTO",
    url,
    observation: `已成功在当前标签页打开目标网址: ${url}`,
  };
}

// Router for messages from Side Panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_ACTIVE_TAB") {
    getTargetActiveTab().then((tab) => sendResponse({ tab }));
    return true;
  }

  if (request.action === "BRIDGE_TO_PAGE") {
    getTargetActiveTab().then(async (tab) => {
      if (!tab || !tab.id) {
        return sendResponse({ ok: false, error: "未发现浏览器活动标签页，请打开任意网页" });
      }

      const payload = request.payload || {};
      const actionType = payload.action;
      const subAction = payload.payload?.action;

      // Intercept GOTO / NAVIGATE at browser level for 100% reliability
      if (actionType === "EXECUTE_ACTION" && (subAction === "GOTO" || subAction === "NAVIGATE")) {
        const destUrl = payload.payload.url || payload.payload.value || payload.payload.id;
        if (destUrl) {
          try {
            const navRes = await executeNativeNavigation(tab.id, destUrl);
            return sendResponse(navRes);
          } catch (navErr) {
            return sendResponse({ ok: false, error: `网址导航失败: ${navErr.message}` });
          }
        }
      }

      // If active tab is not an injectable standard web page (e.g. chrome://newtab, about:blank, extension page)
      if (!isInjectableUrl(tab.url)) {
        if (actionType === "SCAN_PAGE") {
          return sendResponse({
            ok: true,
            page_url: tab.url || "chrome://newtab",
            page_title: tab.title || "新标签页",
            page_archetype: "NEW_TAB_PAGE",
            is_new_tab: true,
            elements: [],
            scroll_status: { percent: 0, description: "空白页" },
            modal_status: { hasModal: false },
          });
        }
        if (actionType === "HOVER_ELEMENT" || actionType === "CLEAR_HOVER" || actionType === "TOGGLE_BADGES") {
          return sendResponse({ ok: true });
        }
        return sendResponse({
          ok: true,
          observation: "当前处于新标签页，建议使用 GOTO 工具直达目标网站",
        });
      }

      // Standard injectable web page (http, https, file)
      try {
        const res = await sendToWebTabWithAutoInject(tab.id, payload);
        sendResponse(res);
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    });
    return true;
  }

  return false;
});
