(function (root, factory) {
  const api = factory(root);
  root.PT = Object.assign(root.PT || {}, api);
  if (typeof module !== "undefined" && module.exports && typeof process !== "undefined") {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const DEFAULT_BASE_URL = "https://api.deepseek.com";
  const DEFAULT_MODEL = "deepseek-chat";
  const DEFAULT_LANGUAGE = "简体中文";
  const LANGUAGES = ["简体中文", "繁體中文", "English", "日本語", "한국어", "Français", "Deutsch", "Español"];

  function clampRatio(value, fallback) {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(0.92, Math.max(0.08, number));
  }

  function fingerprint(settings) {
    const source = [
      settings.targetLanguage,
      settings.demoMode ? "1" : "0",
      (settings.terms || []).join("\n"),
    ].join("|");
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
      hash = (Math.imul(hash, 31) + source.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  function normalizeSettings(stored) {
    const input = stored || {};
    const PT = root.PT || {};
    const model = String(input.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    let baseUrl = String(input.baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
    baseUrl = baseUrl.replace(/\/+$/, "");
    const terms = Array.isArray(input.terms)
      ? PT.dedupeTerms(input.terms)
      : (PT.DEFAULT_TERMS || []).slice();
    return {
      apiKey: typeof input.apiKey === "string" ? input.apiKey.trim() : "",
      model,
      baseUrl,
      targetLanguage: String(input.targetLanguage || DEFAULT_LANGUAGE).trim() || DEFAULT_LANGUAGE,
      terms,
      fabEnabled: input.fabEnabled !== false,
      fabTop: clampRatio(input.fabTop, 0.42),
      disabledSitesText: typeof input.disabledSites === "string" ? input.disabledSites : "",
      disabledSites: PT.parseSiteList ? PT.parseSiteList(input.disabledSites || "") : [],
      demoMode: input.demoMode === true,
    };
  }

  function publicSettings(settings, hostname) {
    const PT = root.PT || {};
    const siteDisabled = hostname && PT.isSiteDisabled
      ? PT.isSiteDisabled(hostname, settings.disabledSitesText || settings.disabledSites)
      : false;
    return {
      targetLanguage: settings.targetLanguage,
      demoMode: settings.demoMode,
      hasKey: Boolean(settings.apiKey),
      terms: settings.terms,
      fingerprint: fingerprint(settings),
      fabEnabled: settings.fabEnabled,
      showFab: settings.fabEnabled && !siteDisabled,
      fabTop: settings.fabTop,
      disabledSites: settings.disabledSites,
      model: settings.model,
      baseUrl: settings.baseUrl,
    };
  }

  return {
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    DEFAULT_LANGUAGE,
    LANGUAGES,
    clampRatio,
    fingerprint,
    normalizeSettings,
    publicSettings,
  };
});
