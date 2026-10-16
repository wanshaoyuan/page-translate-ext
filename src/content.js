(function () {
  "use strict";

  if (window.top !== window) return;
  if (document.documentElement?.dataset?.fyStandalone === "1") return;
  if (globalThis.__FY_LOADED) return;
  globalThis.__FY_LOADED = true;

  const PAGE_NONCE = Math.random().toString(36).slice(2, 6).padEnd(4, "x");
  const NO_KEY = "请先在扩展设置页填写 DeepSeek API Key。右键点击工具栏图标，选择「选项」。";

  let mode = "idle";
  let runId = 0;
  let port = null;
  let applied = 0;
  let demoMode = false;
  let fab = null;
  let toast = null;
  let progress = { done: 0, total: 0 };
  const cache = new Map();

  function view() {
    return { mode, done: progress.done, total: progress.total, demo: demoMode };
  }

  function badgeText() {
    if (mode === "translating") {
      if (!progress.total) return "...";
      return `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`;
    }
    if (mode === "translated") return "译";
    if (mode === "error") return "!";
    return "";
  }

  function titleText() {
    if (mode === "translating") return `正在翻译 ${progress.done}/${progress.total}`;
    if (mode === "translated") return "已双语对照，再点一次还原";
    if (mode === "error") return "翻译失败，再点一次可清除译文";
    return "整页一键翻译";
  }

  function render() {
    fab?.update(view());
    chrome.runtime.sendMessage({ type: "SET_STATE", badge: badgeText(), title: titleText() }).catch(() => {});
  }

  function ensureToast() {
    if (!toast) {
      toast = PT.mountToast(document, {
        onOpenSettings() {
          chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
        },
      });
    }
    return toast;
  }

  function cacheKey(fingerprint, group) {
    return `${fingerprint}\n${group.text}\n${(group.codes || []).join("\n")}`;
  }

  function applyGroup(group, text) {
    if (!String(text || "").trim()) return 0;
    let count = 0;
    (group.elements || []).forEach((element) => {
      if (!element.isConnected) return;
      if (PT.mountTranslation(element, text, group.codes, PAGE_NONCE)) count += 1;
    });
    return count;
  }

  function closePort() {
    const current = port;
    port = null;
    if (!current) return;
    try {
      current.postMessage({ type: "CANCEL" });
    } catch {
      /* 端口可能已经断开。 */
    }
    try {
      current.disconnect();
    } catch {
      /* 同上。 */
    }
  }

  function resetToOriginal() {
    runId += 1;
    closePort();
    PT.clearTranslations(document);
    applied = 0;
    progress = { done: 0, total: 0 };
    mode = "idle";
    ensureToast().hide();
    render();
  }

  async function refreshFab(known) {
    let settings = known;
    if (!settings) {
      try {
        settings = await chrome.runtime.sendMessage({
          type: "GET_PUBLIC_SETTINGS",
          hostname: location.hostname,
        });
      } catch {
        settings = { showFab: true, fabTop: 0.42 };
      }
    }
    if (!settings?.showFab) {
      fab?.destroy();
      fab = null;
      return;
    }
    if (!fab) {
      fab = PT.mountFab(document, {
        top: settings.fabTop,
        onToggle() {
          toggle();
        },
        onTopChange(ratio) {
          chrome.storage.local.set({ fabTop: ratio });
        },
      });
    } else if (!fab.host.hasAttribute("data-dragging")) {
      fab.setTop(settings.fabTop);
    }
    fab.update(view());
  }

  async function toggle() {
    if (mode === "translating" || mode === "translated" || mode === "error") {
      resetToOriginal();
      return;
    }
    const my = ++runId;
    mode = "translating";
    applied = 0;
    progress = { done: 0, total: 0 };
    demoMode = false;
    render();
    ensureToast().showProgress(0, 0, false);

    let pub;
    try {
      pub = await chrome.runtime.sendMessage({
        type: "GET_PUBLIC_SETTINGS",
        hostname: location.hostname,
      });
    } catch {
      if (my !== runId) return;
      mode = "error";
      render();
      ensureToast().showMessage("扩展后台没有响应，请在扩展管理页重新加载本扩展。", { timeout: 6400 });
      return;
    }
    if (my !== runId) return;
    demoMode = Boolean(pub?.demoMode);
    render();
    if (!pub?.hasKey && !demoMode) {
      mode = "idle";
      render();
      ensureToast().showMessage(NO_KEY, { settings: true });
      return;
    }

    const units = PT.collectUnits(document.body, {
      nonce: PAGE_NONCE,
      terms: pub.terms || [],
      targetLanguage: pub.targetLanguage,
    });
    const groups = PT.groupDuplicateUnits(units);
    if (!groups.length) {
      mode = "idle";
      render();
      ensureToast().showMessage("这一页没有找到可翻译的正文。代码块、输入框和画布里的文字会跳过。", {
        timeout: 5600,
      });
      return;
    }

    const pending = [];
    progress.total = groups.reduce((sum, group) => sum + group.elements.length, 0);
    groups.forEach((group) => {
      const key = cacheKey(pub.fingerprint, group);
      if (cache.has(key)) {
        applied += applyGroup(group, cache.get(key));
        progress.done += group.elements.length;
      } else {
        pending.push(group);
      }
    });
    render();
    if (!pending.length) {
      mode = applied ? "translated" : "idle";
      render();
      ensureToast().showMessage(applied ? `已对照 ${applied} 段，原文仍在上方。` : "没有得到译文。", {
        timeout: 2400,
      });
      return;
    }
    ensureToast().showProgress(progress.done, progress.total, demoMode);

    port = chrome.runtime.connect({ name: "fy-translate" });
    const active = port;
    active.onMessage.addListener((msg) => {
      if (my !== runId) return;
      if (msg.type === "UNIT") {
        const group = pending.find((item) => item.id === msg.unit?.unitId);
        if (!group) return;
        cache.set(cacheKey(pub.fingerprint, group), msg.unit.text);
        applied += applyGroup(group, msg.unit.text);
        progress.done += group.elements.length;
        render();
        ensureToast().showProgress(progress.done, progress.total, demoMode);
        return;
      }
      if (msg.type === "ERROR") {
        mode = applied ? "translated" : "error";
        render();
        const offerSettings = msg.error?.code === "NO_KEY" || msg.error?.code === "AUTH" || msg.error?.code === "BAD_URL";
        ensureToast().showMessage(msg.error?.message || "翻译失败，请稍后重试。", {
          settings: offerSettings,
          timeout: offerSettings ? 0 : 7200,
        });
        closePort();
        return;
      }
      if (msg.type === "DONE") {
        mode = applied ? "translated" : "idle";
        render();
        ensureToast().showMessage(applied ? `已对照 ${applied} 段，原文仍保留在上方。` : "没有得到译文。", {
          timeout: 2500,
        });
        closePort();
      }
    });
    active.onDisconnect.addListener(() => {
      if (my !== runId || mode !== "translating") return;
      mode = applied ? "translated" : "error";
      render();
      ensureToast().showMessage("翻译中断了。已经插入的对照会保留，再点一次可全部移除。", { timeout: 6400 });
    });
    active.postMessage({
      type: "START",
      nonce: PAGE_NONCE,
      items: pending.map((group) => ({ id: group.id, text: group.text, codes: group.codes })),
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "TOGGLE") {
      toggle();
      sendResponse({ ok: true });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.fabEnabled || changes.disabledSites || changes.fabTop) refreshFab();
  });

  refreshFab().finally(render);
})();
