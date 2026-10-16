const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/lib/terms.js");
require("../src/lib/sites.js");
require("../src/lib/settings.js");
require("../src/lib/glossary.js");
require("../src/lib/batch.js");
require("../src/lib/mock.js");
require("../src/lib/api.js");

const { DEFAULT_TERMS } = require("../src/lib/terms.js");
const { normalizeSettings } = require("../src/lib/settings.js");
const {
  MESSAGES,
  TranslateError,
  chatCompletionsUrl,
  buildSystemPrompt,
  translateTexts,
} = require("../src/lib/api.js");

function jsonResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function settings(extra) {
  return normalizeSettings({ apiKey: "sk-test-key", terms: ["Claude", "Agent", "Prompt", "Token"], ...extra });
}

test("补全 DeepSeek 的 chat completions 地址", () => {
  assert.equal(chatCompletionsUrl("https://api.deepseek.com"), "https://api.deepseek.com/chat/completions");
  assert.equal(chatCompletionsUrl("https://api.deepseek.com/"), "https://api.deepseek.com/chat/completions");
  assert.equal(chatCompletionsUrl("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(
    chatCompletionsUrl("https://example.com/v1/chat/completions"),
    "https://example.com/v1/chat/completions",
  );
});

test("系统提示同时约束占位符和术语", () => {
  const prompt = buildSystemPrompt("简体中文", ["Claude", "Agent", "MyProduct"]);
  assert.match(prompt, /克劳德/);
  assert.match(prompt, /Agent/);
  assert.match(prompt, /MyProduct/);
  assert.match(prompt, /⟪/);
  assert.match(prompt, /translations/);
});

test("没有 Key 时给出中文提示且不发请求", async () => {
  let called = 0;
  await assert.rejects(
    () =>
      translateTexts([{ id: "a", text: "Hello Claude" }], normalizeSettings({}), {
        nonce: "ab",
        fetchImpl: async () => {
          called += 1;
          throw new Error("should not fetch");
        },
      }),
    (error) => error instanceof TranslateError && error.code === "NO_KEY" && error.userMessage === MESSAGES.NO_KEY,
  );
  assert.equal(called, 0);
});

test("演示模式不访问网络，并保留 Claude 与 Agent", async () => {
  let called = 0;
  const result = await translateTexts([{ id: "a", text: "Hello, Claude Agent.", codes: [] }], settings({ demoMode: true, apiKey: "" }), {
    nonce: "demo",
    fetchImpl: async () => {
      called += 1;
      return jsonResponse({});
    },
  });
  assert.equal(called, 0);
  assert.match(result[0].text, /Claude/);
  assert.match(result[0].text, /Agent/);
  assert.doesNotMatch(result[0].text, /克劳德|代理/);
});

test("模型若把占位符译掉，最终仍还原术语", async () => {
  const result = await translateTexts(
    [{ id: "a", text: "Claude is an Agent for this test." }],
    settings(),
    {
      nonce: "ab",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.model, "deepseek-chat");
        assert.equal(init.headers.Authorization, "Bearer sk-test-key");
        assert.equal(_url, "https://api.deepseek.com/chat/completions");
        const input = JSON.parse(body.messages[1].content);
        const translations = input.map((text) =>
          text
            .replace(/⟪[a-z0-9]+T0⟫/g, "克劳德")
            .replace(/⟪[a-z0-9]+T1⟫/g, "代理")
            .replace(" for this test.", " 用于这次测试。"),
        );
        return jsonResponse({ choices: [{ message: { content: JSON.stringify({ translations }) } }] });
      },
    },
  );
  assert.match(result[0].text, /Claude/);
  assert.match(result[0].text, /Agent/);
  assert.match(result[0].text, /用于这次测试/);
  assert.doesNotMatch(result[0].text, /克劳德/);
});

test("正常保留占位符时还原原文术语", async () => {
  const [item] = await translateTexts([{ id: "a", text: "Claude is an Agent." }], settings(), {
    nonce: "zz",
    fetchImpl: async (_url, init) => {
      const input = JSON.parse(JSON.parse(init.body).messages[1].content);
      const translations = input.map((text) => text.replace(" is an ", " 是 ").replace(/\.$/, "。"));
      return jsonResponse({
        choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(translations)}\n\`\`\`` } }],
      });
    },
  });
  assert.match(item.text, /Claude 是 Agent/);
});

test("HTTP 401、429、网络错误和条数不一致都有中文说明", async () => {
  async function fail(fetchImpl) {
    try {
      await translateTexts([{ id: "a", text: "Hello Claude today" }], settings(), { nonce: "ab", fetchImpl });
    } catch (error) {
      return error;
    }
    assert.fail("应该抛出翻译错误");
  }

  const auth = await fail(async () => jsonResponse({ error: { message: "invalid" } }, 401));
  assert.equal(auth.code, "AUTH");
  assert.match(auth.message, /API Key/);

  let attempts = 0;
  const limited = await fail(async () => {
    attempts += 1;
    return jsonResponse({ error: { message: "slow down" } }, 429, { "retry-after": "30" });
  });
  assert.equal(limited.code, "RATE_LIMIT");
  assert.match(limited.message, /429/);
  assert.equal(attempts, 1);

  const network = await fail(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(network.code, "NETWORK");
  assert.match(network.message, /网络/);

  const mismatch = await fail(async () =>
    jsonResponse({ choices: [{ message: { content: JSON.stringify({ translations: ["only one", "extra"] }) } }] }),
  );
  assert.equal(mismatch.code, "LENGTH_MISMATCH");
  assert.match(mismatch.message, /条数/);
});

test("429 会重试一次，response_format 不被支持时去掉再请求", async () => {
  let calls = 0;
  const retried = await translateTexts([{ id: "a", text: "Hello Claude today" }], settings(), {
    nonce: "ab",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({}, 429, { "retry-after": "0" });
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ translations: ["你好 Claude today"] }) } }],
      });
    },
  });
  assert.equal(calls, 2);
  assert.match(retried[0].text, /Claude/);

  calls = 0;
  await translateTexts([{ id: "a", text: "Hello Claude today" }], settings({ model: "deepseek-reasoner" }), {
    nonce: "ab",
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.model, "deepseek-reasoner");
      if (body.response_format) return jsonResponse({ error: { message: "unsupported" } }, 400);
      const input = JSON.parse(body.messages[1].content);
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ translations: input.map((text) => text) }) } }],
      });
    },
  });
  assert.equal(calls, 2);
});

test("取消翻译不会当成网络错误", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      translateTexts([{ id: "a", text: "Hello Claude today" }], settings(), {
        nonce: "ab",
        signal: controller.signal,
        fetchImpl: async () => jsonResponse({}),
      }),
    (error) => error.code === "CANCELLED",
  );
});

test("默认术语通过演示模式整句保留英文", async () => {
  const sentence = "Read the Transformer paper when the result surprises you. DeepSeek, GPT, and Claude can sit in the same paragraph, and none of them should be transliterated.";
  const [item] = await translateTexts([{ id: "a", text: sentence, codes: [] }], normalizeSettings({ demoMode: true, terms: DEFAULT_TERMS }), {
    nonce: "demo",
  });
  ["Transformer", "DeepSeek", "GPT", "Claude"].forEach((term) => {
    assert.match(item.text, new RegExp(term));
  });
  assert.doesNotMatch(item.text, /克劳德|吉皮蒂|变形金刚|深度求索/);
});
