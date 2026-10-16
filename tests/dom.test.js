const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");

require("../src/lib/terms.js");
require("../src/lib/sites.js");
require("../src/lib/settings.js");
require("../src/lib/glossary.js");
require("../src/lib/batch.js");
require("../src/lib/mock.js");
require("../src/lib/api.js");
require("../src/lib/dom.js");
require("../src/lib/ui.js");

const { DEFAULT_TERMS } = require("../src/lib/terms.js");
const { normalizeSettings } = require("../src/lib/settings.js");
const { PHRASES } = require("../src/lib/mock.js");
const { collectUnits, mountTranslation, clearTranslations } = require("../src/lib/dom.js");
const { translateTexts } = require("../src/lib/api.js");
const { mountFab } = require("../src/lib/ui.js");

function plain(unit, nonce) {
  return unit.text.replace(new RegExp(`⟪${nonce}C(\\d+)⟫`, "g"), (_match, index) => unit.codes[Number(index)] ?? "");
}

test("示例文章只收集该译的块，并跳过代码块、脚本和输入框", () => {
  const html = fs.readFileSync("demo/index.html", "utf8");
  const dom = new JSDOM(html);
  const nonce = "demo";
  const units = collectUnits(dom.window.document.body, {
    nonce,
    terms: DEFAULT_TERMS,
    targetLanguage: "简体中文",
  });
  const plains = units.map((unit) => plain(unit, nonce));
  const missing = plains.filter((text) => !PHRASES.has(text));
  assert.deepEqual(missing, []);
  assert.equal(plains.some((text) => text.includes("kubectl get pods")), false);
  assert.equal(plains.some((text) => text.includes("should stay inside this script")), false);
  assert.equal(plains.some((text) => text.includes("Notes about Claude Agent")), false);
  assert.equal(plains.includes("Filter articles"), true);
  const codeUnit = units.find((unit) => unit.codes.length);
  assert.deepEqual(codeUnit.codes, ["kubectl apply -f agent.yaml"]);
});

test("隐藏节点、contenteditable 和中文段落不会进入队列", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <p>Visible Claude Agent paragraph for readers.</p>
    <div hidden><p>Hidden Claude Agent paragraph for readers.</p></div>
    <p style="display:none">Display none Claude Agent paragraph.</p>
    <div contenteditable="true">Editable Claude Agent paragraph here.</div>
    <p>这是一段已经完成的中文说明，不应该再次送去翻译。</p>
    <pre><code>kubectl apply</code></pre>
    <textarea>Claude Agent notes</textarea>
  </body>`);
  const units = collectUnits(dom.window.document.body, {
    nonce: "ab",
    terms: DEFAULT_TERMS,
    targetLanguage: "简体中文",
  });
  assert.equal(units.length, 1);
  assert.match(units[0].text, /Visible Claude Agent/);
});

test("译文插在原文下方，不改原文，代码留在译文里，清除后页面复原", async () => {
  const html = fs.readFileSync("demo/index.html", "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const nonce = "demo";
  const h1 = document.querySelector("h1");
  const original = h1.textContent;
  const units = collectUnits(document.body, { nonce, terms: DEFAULT_TERMS, targetLanguage: "简体中文" });
  const settings = normalizeSettings({ demoMode: true, terms: DEFAULT_TERMS });
  const translated = await translateTexts(
    units.map((unit) => ({ id: unit.id, text: unit.text, codes: unit.codes })),
    settings,
    { nonce, fetchImpl: async () => { throw new Error("no network"); } },
  );
  const byId = new Map(translated.map((item) => [item.unitId, item.text]));
  units.forEach((unit) => mountTranslation(unit.element, byId.get(unit.id), unit.codes, nonce));

  assert.equal(h1.childNodes[0].textContent, original);
  const titleTranslation = h1.querySelector("fy-trans");
  assert.ok(titleTranslation);
  assert.equal(h1.compareDocumentPosition(titleTranslation) & document.DOCUMENT_POSITION_FOLLOWING, document.DOCUMENT_POSITION_FOLLOWING);
  assert.match(titleTranslation.shadowRoot.textContent, /Claude/);
  assert.match(titleTranslation.shadowRoot.textContent, /Kubernetes/);
  assert.doesNotMatch(titleTranslation.shadowRoot.textContent, /克劳德/);

  const codeHost = [...document.querySelectorAll("fy-trans")].find((node) => node.shadowRoot.querySelector("code"));
  assert.equal(codeHost.shadowRoot.querySelector("code").textContent, "kubectl apply -f agent.yaml");
  assert.equal(document.querySelector("pre fy-trans"), null);
  assert.equal(document.querySelector("textarea").value, "Notes about Claude Agent");

  const listItem = [...document.querySelectorAll("li")].find((node) => node.textContent.includes("Pin the SDK"));
  assert.equal(listItem.querySelector("fy-trans").shadowRoot.textContent.includes("SDK"), true);

  clearTranslations(document);
  assert.equal(document.querySelector("fy-trans"), null);
  assert.equal(h1.textContent, original);
  assert.equal(h1.hasAttribute("data-fy-source"), false);
});

test("悬浮按钮用 Shadow DOM 隔离，点击切换状态", () => {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", { pretendToBeVisual: true });
  let clicks = 0;
  const fab = mountFab(dom.window.document, {
    top: 0.2,
    onToggle() {
      clicks += 1;
    },
  });
  assert.ok(fab.host.shadowRoot);
  assert.equal(fab.host.getAttribute("data-fy-ui"), "1");
  fab.update({ mode: "translating", done: 1, total: 4, demo: true });
  assert.equal(fab.host.getAttribute("data-mode"), "translating");
  assert.match(fab.host.shadowRoot.textContent, /1\/4/);
  fab.host.shadowRoot.querySelector("button").click();
  assert.equal(clicks, 1);
  fab.update({ mode: "translated" });
  assert.equal(fab.host.shadowRoot.querySelector("button").getAttribute("aria-pressed"), "true");
  fab.destroy();
  assert.equal(dom.window.document.querySelector("fy-fab"), null);
});
