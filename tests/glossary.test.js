const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/lib/terms.js");
require("../src/lib/glossary.js");

const { DEFAULT_TERMS, REQUIRED_TERMS } = require("../src/lib/terms.js");
const {
  protectTerms,
  finalizeTranslation,
  hasTranslatableProse,
  shouldTranslateText,
} = require("../src/lib/glossary.js");

test("内置词表包含要求的技术术语且不重复", () => {
  const seen = new Set();
  DEFAULT_TERMS.forEach((term) => {
    assert.equal(seen.has(term.toLowerCase()), false, term);
    seen.add(term.toLowerCase());
  });
  REQUIRED_TERMS.forEach((term) => {
    assert.ok(DEFAULT_TERMS.includes(term), term);
  });
});

test("保护术语并保留原文大小写", () => {
  const { text, replacements } = protectTerms(
    "claude 和 Claude 都是 Agent，不是 Agency。",
    ["Claude", "Agent"],
    "ab",
  );
  assert.deepEqual(replacements, ["claude", "Claude", "Agent"]);
  assert.equal(text.includes("Agency"), true);
  assert.equal(text.includes("Claude"), false);
  assert.match(text, /⟪abT0⟫/);
  const restored = finalizeTranslation(text, replacements, "ab");
  assert.equal(restored, "claude 和 Claude 都是 Agent，不是 Agency。");
});

test("长术语优先于其中的短术语", () => {
  const sample = "Use GitHub Copilot and JavaScript, then run Git.";
  const { replacements } = protectTerms(sample, ["Git", "GitHub", "GitHub Copilot", "Java", "JavaScript"], "ab");
  assert.deepEqual(replacements, ["GitHub Copilot", "JavaScript", "Git"]);
});

test("中文紧挨着英文术语时仍然保护", () => {
  const { replacements } = protectTerms("用Claude做Agent", ["Claude", "Agent"], "ab");
  assert.deepEqual(replacements, ["Claude", "Agent"]);
});

test("Context window 和 Fine-tuning 按整词保护", () => {
  const { replacements } = protectTerms(
    "Tune the Context window with Fine-tuning, not a window.",
    DEFAULT_TERMS,
    "ab",
  );
  assert.ok(replacements.includes("Context window"));
  assert.ok(replacements.includes("Fine-tuning"));
  assert.equal(replacements.includes("window"), false);
});

test("要求的术语在同一句里都不会被拆掉", () => {
  const sentence = REQUIRED_TERMS.map((term) => `See ${term}.`).join(" ");
  const { replacements } = protectTerms(sentence, DEFAULT_TERMS, "ab");
  REQUIRED_TERMS.forEach((term) => {
    assert.ok(
      replacements.some((item) => item.toLowerCase() === term.toLowerCase()),
      term,
    );
  });
});

test("占位符被模型改写后仍能还原", () => {
  const { replacements } = protectTerms("Claude meets Agent", ["Claude", "Agent"], "ab");
  const restored = finalizeTranslation("{{abT0}} 遇见 [[ ab T1 ]]", replacements, "ab");
  assert.equal(restored, "Claude 遇见 Agent");
});

test("占位符丢失时按误译表修正，且只改回丢失的那些", () => {
  const source = "The proxy talks to the Agent.";
  const { text, replacements } = protectTerms(source, ["Agent"], "ab");
  assert.deepEqual(replacements, ["Agent"]);
  const kept = finalizeTranslation(`这个代理与 ${text.match(/⟪abT0⟫/)[0]} 交谈。`, replacements, "ab");
  assert.equal(kept, "这个代理与 Agent 交谈。");

  const dropped = finalizeTranslation("这个代理与代理交谈。", replacements, "ab");
  assert.equal(dropped, "这个代理与Agent交谈。");
});

test("Claude 被译成克劳德时能够改回", () => {
  const { replacements } = protectTerms("Claude ships", ["Claude"], "cd");
  const output = finalizeTranslation("克劳德发布了。", replacements, "cd");
  assert.equal(output, "Claude发布了。");
});

test("纯术语片段不必再送翻，普通句子需要送翻", () => {
  assert.equal(hasTranslatableProse("Claude Agent", ["Claude", "Agent"]), false);
  assert.equal(hasTranslatableProse("Claude is an Agent", ["Claude", "Agent"]), true);
  assert.equal(shouldTranslateText("这是一段已经写好的中文说明文字。", [], "简体中文"), false);
  assert.equal(shouldTranslateText("Claude is an Agent in production.", [], "简体中文"), true);
});
