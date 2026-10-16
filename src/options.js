(function () {
  "use strict";

  const termList = document.querySelector("#termList");
  const termInput = document.querySelector("#termInput");
  const termFilter = document.querySelector("#termFilter");
  const termCount = document.querySelector("#termCount");
  const status = document.querySelector("#status");
  const language = document.querySelector("#targetLanguage");
  let terms = [];

  PT.LANGUAGES.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    language.appendChild(option);
  });

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = kind || "";
  }

  function renderTerms() {
    const query = termFilter.value.trim().toLowerCase();
    termList.replaceChildren();
    const visible = terms.filter((term) => term.toLowerCase().includes(query));
    termCount.textContent = `${terms.length} 个术语`;
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = terms.length ? "没有匹配的术语。" : "还没有术语，翻译时将不做白名单保护。";
      termList.appendChild(empty);
      return;
    }
    visible.forEach((term) => {
      const chip = document.createElement("span");
      chip.className = "term";
      chip.append(document.createTextNode(term));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `删除术语 ${term}`);
      remove.addEventListener("click", () => {
        terms = terms.filter((item) => item !== term);
        renderTerms();
      });
      chip.appendChild(remove);
      termList.appendChild(chip);
    });
  }

  function addTerm() {
    const value = termInput.value.trim();
    if (value.length < 2) {
      setStatus("术语至少要有 2 个字符。", "bad");
      return;
    }
    if (/[⟪⟫\r\n]/.test(value) || !/[\p{L}]/u.test(value)) {
      setStatus("术语需要包含字母，且不能换行。", "bad");
      return;
    }
    if (terms.some((term) => term.toLowerCase() === value.toLowerCase())) {
      setStatus("这个术语已经在列表里。", "bad");
      return;
    }
    terms = PT.dedupeTerms(terms.concat(value)).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    termInput.value = "";
    setStatus(`已添加 ${value}。记得保存。`, "ok");
    renderTerms();
  }

  function readForm() {
    return {
      apiKey: document.querySelector("#apiKey").value,
      model: document.querySelector("#model").value,
      baseUrl: document.querySelector("#baseUrl").value,
      targetLanguage: language.value,
      demoMode: document.querySelector("#demoMode").checked,
      fabEnabled: document.querySelector("#fabEnabled").checked,
      disabledSites: document.querySelector("#disabledSites").value,
      terms,
    };
  }

  function validate(raw) {
    const baseUrl = raw.baseUrl.trim() || PT.DEFAULT_BASE_URL;
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    } catch {
      return "Base URL 需要以 http:// 或 https:// 开头。";
    }
    return "";
  }

  async function persist() {
    const raw = readForm();
    const problem = validate(raw);
    if (problem) {
      setStatus(problem, "bad");
      return null;
    }
    const current = await chrome.storage.local.get(["fabTop"]);
    const next = PT.normalizeSettings({ ...raw, fabTop: current.fabTop });
    await chrome.storage.local.set({
      apiKey: next.apiKey,
      model: next.model,
      baseUrl: next.baseUrl,
      targetLanguage: next.targetLanguage,
      demoMode: next.demoMode,
      fabEnabled: next.fabEnabled,
      disabledSites: raw.disabledSites,
      terms: next.terms,
    });
    return next;
  }

  async function load() {
    const stored = await chrome.storage.local.get(null);
    const settings = PT.normalizeSettings(stored);
    document.querySelector("#apiKey").value = settings.apiKey;
    document.querySelector("#model").value = settings.model;
    document.querySelector("#baseUrl").value = settings.baseUrl;
    if (![...language.options].some((option) => option.value === settings.targetLanguage)) {
      const extra = document.createElement("option");
      extra.value = settings.targetLanguage;
      extra.textContent = settings.targetLanguage;
      language.appendChild(extra);
    }
    language.value = settings.targetLanguage;
    document.querySelector("#demoMode").checked = settings.demoMode;
    document.querySelector("#fabEnabled").checked = settings.fabEnabled;
    document.querySelector("#disabledSites").value = settings.disabledSitesText;
    terms = settings.terms.slice().sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    renderTerms();
  }

  document.querySelector("#toggleKey").addEventListener("click", () => {
    const input = document.querySelector("#apiKey");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    document.querySelector("#toggleKey").textContent = show ? "隐藏" : "显示";
  });
  document.querySelector("#addTerm").addEventListener("click", addTerm);
  termInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTerm();
    }
  });
  termFilter.addEventListener("input", renderTerms);
  document.querySelector("#resetTerms").addEventListener("click", () => {
    if (!confirm("用内置术语覆盖当前列表？还没保存的修改会丢失。")) return;
    terms = PT.DEFAULT_TERMS.slice().sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    renderTerms();
    setStatus("已恢复内置术语，记得保存。", "ok");
  });
  document.querySelector("#save").addEventListener("click", async () => {
    const saved = await persist();
    if (saved) setStatus("已保存。回到网页后再点一次翻译即可生效。", "ok");
  });
  document.querySelector("#test").addEventListener("click", async () => {
    const button = document.querySelector("#test");
    button.disabled = true;
    setStatus("正在保存并测试…", "");
    try {
      const saved = await persist();
      if (!saved) return;
      // 不在选项页里 fetch。后台 service worker 有 host_permissions，由它发 TEST_CONNECTION。
      const result = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION", settings: readForm() });
      if (!result?.ok) {
        setStatus(result?.error?.message || "测试失败。", "bad");
        return;
      }
      const warning = /克劳德|克勞德/.test(result.text) ? " 术语保护可能没有生效。" : "";
      const mode = result.demoMode ? "演示模式" : "接口";
      setStatus(`${mode}返回：${result.text}${warning}`, warning ? "bad" : "ok");
    } catch (error) {
      const name = error?.name || "Error";
      const message = error?.message || "测试失败。";
      setStatus(message ? `${name}: ${message}` : name, "bad");
    } finally {
      button.disabled = false;
    }
  });

  load().catch((error) => setStatus(error.message || "设置读取失败。", "bad"));
})();
