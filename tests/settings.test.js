const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/lib/terms.js");
require("../src/lib/sites.js");
const { isSiteDisabled } = require("../src/lib/sites.js");
require("../src/lib/settings.js");
const { normalizeSettings, publicSettings, DEFAULT_MODEL, DEFAULT_BASE_URL } = require("../src/lib/settings.js");

test("空配置回落到 DeepSeek 默认值，并带上内置术语", () => {
  const settings = normalizeSettings({});
  assert.equal(settings.model, DEFAULT_MODEL);
  assert.equal(settings.baseUrl, DEFAULT_BASE_URL);
  assert.equal(settings.targetLanguage, "简体中文");
  assert.equal(settings.fabEnabled, true);
  assert.equal(settings.demoMode, false);
  assert.ok(settings.terms.includes("Claude"));
  assert.ok(settings.terms.includes("Agent"));
});

test("旧默认 Base URL 和 deepseek-chat 会迁移到当前默认", () => {
  const migrated = normalizeSettings({
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  });
  assert.equal(migrated.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(migrated.model, "deepseek-flash");

  const slashed = normalizeSettings({
    baseUrl: "https://api.deepseek.com/",
    model: "  deepseek-chat  ",
  });
  assert.equal(slashed.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(slashed.model, "deepseek-flash");

  const cased = normalizeSettings({ baseUrl: "https://API.DeepSeek.com" });
  assert.equal(cased.baseUrl, "https://api.deepseek.com/v1");
});

test("已经是 /v1 或自定义网关、自定义模型时不迁移", () => {
  const current = normalizeSettings({
    baseUrl: "https://api.deepseek.com/v1/",
    model: "deepseek-v4-pro",
  });
  assert.equal(current.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(current.model, "deepseek-v4-pro");

  const explicit = normalizeSettings({
    baseUrl: "https://api.deepseek.com/chat/completions",
    model: "deepseek-reasoner",
  });
  assert.equal(explicit.baseUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(explicit.model, "deepseek-reasoner");

  const gateway = normalizeSettings({
    baseUrl: "https://example.com/v1/",
    model: "local-model",
  });
  assert.equal(gateway.baseUrl, "https://example.com/v1");
  assert.equal(gateway.model, "local-model");
});

test("用户清空术语后不会自动填回", () => {
  const settings = normalizeSettings({ terms: [], apiKey: "  sk-1  ", baseUrl: "https://example.com/v1/" });
  assert.deepEqual(settings.terms, []);
  assert.equal(settings.apiKey, "sk-1");
  assert.equal(settings.baseUrl, "https://example.com/v1");
});

test("网站黑名单匹配自身和子域名", () => {
  assert.equal(isSiteDisabled("docs.google.com", "google.com"), true);
  assert.equal(isSiteDisabled("google.com", "google.com"), true);
  assert.equal(isSiteDisabled("notgoogle.com", "google.com"), false);
  assert.equal(isSiteDisabled("example.com", "*.example.com"), true);
  assert.equal(isSiteDisabled("news.ycombinator.com", "example.com\nnews.ycombinator.com"), true);
  assert.equal(isSiteDisabled("localhost", "http://localhost:3000/path"), true);
  assert.equal(isSiteDisabled("claude.ai", "com"), false);
});

test("公开设置不包含 API Key", () => {
  const settings = normalizeSettings({ apiKey: "sk-secret", fabEnabled: false, disabledSites: "example.com" });
  const pub = publicSettings(settings, "docs.example.com");
  assert.equal(pub.hasKey, true);
  assert.equal("apiKey" in pub, false);
  assert.equal(pub.fabEnabled, false);
  assert.equal(pub.showFab, false);
});
