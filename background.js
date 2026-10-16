importScripts(
  "src/lib/terms.js",
  "src/lib/sites.js",
  "src/lib/settings.js",
  "src/lib/glossary.js",
  "src/lib/batch.js",
  "src/lib/mock.js",
  "src/lib/api.js",
);

const CONTENT_FILES = [
  "src/lib/terms.js",
  "src/lib/sites.js",
  "src/lib/settings.js",
  "src/lib/glossary.js",
  "src/lib/batch.js",
  "src/lib/mock.js",
  "src/lib/api.js",
  "src/lib/dom.js",
  "src/lib/ui.js",
  "src/content.js",
];

const TEST_SENTENCE = "Hello, Claude Agent.";

function paintBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#C8607A" });
}

paintBadge();
chrome.runtime.onInstalled.addListener(paintBadge);
chrome.runtime.onStartup.addListener(paintBadge);

async function getSettings() {
  const stored = await chrome.storage.local.get(null);
  return PT.normalizeSettings(stored);
}

function post(port, message) {
  try {
    port.postMessage(message);
  } catch {
    /* 页面已经关掉或端口断开。 */
  }
}

async function dispatchToggle(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "TOGGLE" });
    return;
  } catch {
    /* 旧标签页可能还没有内容脚本。 */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    await chrome.tabs.sendMessage(tabId, { type: "TOGGLE" });
  } catch {
    chrome.action.setBadgeText({ tabId, text: "!" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#C8607A" });
    chrome.action.setTitle({
      tabId,
      title: "这个页面不能翻译（浏览器内部页、PDF 或被站点策略禁止）。",
    });
  }
}

chrome.action.onClicked.addListener((tab) => {
  dispatchToggle(tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-translate") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) dispatchToggle(tab.id);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "fy-translate") return;
  let controller = new AbortController();
  let running = false;
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener((msg) => {
    if (msg?.type === "CANCEL") {
      controller.abort();
      return;
    }
    if (msg?.type !== "START" || running) return;
    running = true;
    controller = new AbortController();
    const signal = controller.signal;
    (async () => {
      const settings = await getSettings();
      try {
        await PT.translateTexts(msg.items || [], settings, {
          nonce: msg.nonce,
          signal,
          onUnit(unit) {
            post(port, { type: "UNIT", unit });
          },
        });
        if (signal.aborted) {
          post(port, { type: "CANCELLED" });
          return;
        }
        post(port, { type: "DONE" });
      } catch (error) {
        if (error?.code === "CANCELLED" || signal.aborted) {
          post(port, { type: "CANCELLED" });
          return;
        }
        const message = PT.describeError(error, settings.apiKey);
        console.error("[page-translate] translate failed", error?.code || error?.name, message);
        post(port, {
          type: "ERROR",
          error: {
            code: error.code || "UNKNOWN",
            message,
          },
        });
      }
    })();
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_PUBLIC_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse(PT.publicSettings(settings, msg.hostname)))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (msg?.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === "SET_STATE") {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.action.setBadgeText({ tabId, text: msg.badge || "" });
      chrome.action.setTitle({ tabId, title: msg.title || "整页一键翻译" });
    }
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === "TEST_CONNECTION") {
    testConnection(msg.settings)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: { message: error.message || "测试失败。" } }));
    return true;
  }
  return undefined;
});

async function testConnection(override) {
  // 选项页只 sendMessage。请求必须在有 host_permissions 的 service worker 里发，避免页面 CORS。
  let settings = { apiKey: "" };
  try {
    const stored = await getSettings();
    settings = PT.normalizeSettings({
      ...stored,
      ...(override || {}),
      terms: override?.terms || stored.terms,
      disabledSites: stored.disabledSitesText,
      fabTop: stored.fabTop,
    });
    const url = PT.chatCompletionsUrl(settings.baseUrl);
    console.info(
      "[page-translate] TEST_CONNECTION service worker",
      PT.scrub(url, settings.apiKey),
      settings.model,
      settings.demoMode ? "demo" : "live",
    );
    const result = await PT.translateTexts([{ id: "test", text: TEST_SENTENCE, codes: [] }], settings, {
      nonce: "test",
      concurrency: 1,
    });
    console.info("[page-translate] TEST_CONNECTION service worker ok");
    return { ok: true, text: result[0]?.text || "", demoMode: settings.demoMode };
  } catch (error) {
    const message = PT.describeError(error, settings.apiKey);
    console.error("[page-translate] TEST_CONNECTION service worker failed", error?.code || error?.name, message);
    return {
      ok: false,
      error: {
        code: error.code || "UNKNOWN",
        message,
      },
    };
  }
}
