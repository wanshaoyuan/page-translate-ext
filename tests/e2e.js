const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const { start } = require("../demo/server");

function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = "/tmp/chrome-for-testing/chrome";
  if (fs.existsSync(root)) {
    const versions = fs.readdirSync(root).sort().reverse();
    for (const version of versions) {
      const candidate = path.join(root, version, "chrome-linux64", "chrome");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "/usr/local/bin/google-chrome";
}

const CHROME = resolveChrome();
const ROOT = path.resolve(__dirname, "..");

async function launch(extraArgs, options = {}) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: options.headless !== false,
    ignoreDefaultArgs: options.ignoreDefaultArgs,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=zh-CN", ...(extraArgs || [])],
  });
}

async function clickFab(page) {
  await page.evaluate(() => {
    const button = document.querySelector("fy-fab")?.shadowRoot?.querySelector("button");
    if (!button) throw new Error("找不到悬浮按钮");
    button.click();
  });
}

async function translationText(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("fy-trans")].map((node) => node.shadowRoot.textContent || "").join("\n"),
  );
}

async function previewFlow(url, shots) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 860 });
    await page.goto(url, { waitUntil: "networkidle0" });
    assert.equal(await page.$("fy-trans"), null);
    await page.screenshot({ path: shots.before, fullPage: true });

    const before = await page.evaluate(() => {
      const host = document.querySelector("fy-fab");
      const box = host.getBoundingClientRect();
      return { right: box.right, width: box.width, top: box.top, inner: window.innerWidth };
    });
    assert.ok(before.right > before.inner + 8, "按钮应有一部分露在页面右缘之外");
    assert.ok(before.right - before.width < before.inner, "按钮仍有一部分留在页面内");

    await clickFab(page);
    await page.waitForSelector("h1 fy-trans");
    const report = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const trans = h1.querySelector("fy-trans");
      const h1Box = h1.getBoundingClientRect();
      const transBox = trans.getBoundingClientRect();
      const border = getComputedStyle(trans.shadowRoot.querySelector(".line")).borderLeftColor;
      return {
        original: h1.childNodes[0].textContent,
        translated: trans.shadowRoot.textContent,
        transTop: transBox.top,
        h1Top: h1Box.top,
        border,
        preCount: document.querySelectorAll("pre fy-trans").length,
        textarea: document.querySelector("textarea").value,
        mode: document.querySelector("fy-fab").getAttribute("data-mode"),
        code: [...document.querySelectorAll("fy-trans")].some((node) =>
          (node.shadowRoot.textContent || "").includes("kubectl apply -f agent.yaml"),
        ),
      };
    });
    assert.equal(report.original, "Claude Agents on Kubernetes");
    assert.match(report.translated, /Claude/);
    assert.match(report.translated, /Kubernetes/);
    assert.doesNotMatch(report.translated, /克劳德/);
    assert.ok(report.transTop > report.h1Top + 8, "译文应排在标题原文下方");
    assert.match(report.border, /200,\s*96,\s*122/);
    assert.equal(report.preCount, 0);
    assert.equal(report.textarea, "Notes about Claude Agent");
    assert.equal(report.mode, "translated");
    assert.equal(report.code, true);
    const all = await translationText(page);
    ["Agent", "Prompt", "Token", "LLM", "RAG", "MCP", "Embedding", "Fine-tuning", "Docker", "API", "SDK", "CLI", "GitHub", "Copilot", "Cursor", "Transformer", "Context window", "DeepSeek", "GPT"].forEach(
      (term) => assert.match(all, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    );
    assert.doesNotMatch(all, /克劳德|智能体|吉皮蒂|变形金刚|深度求索/);

    await page.screenshot({ path: shots.after, fullPage: true });
    const parked = await page.evaluate(() => {
      const box = document.querySelector("fy-fab").getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    });
    await page.mouse.move(parked.left + 12, parked.top + parked.height / 2);
    await page.mouse.down();
    await page.mouse.move(parked.left + 12, Math.max(40, parked.top - 140), { steps: 8 });
    await page.mouse.up();
    const dragged = await page.evaluate(() => ({
      top: document.querySelector("fy-fab").getBoundingClientRect().top,
      count: document.querySelectorAll("fy-trans").length,
    }));
    assert.ok(dragged.top < parked.top - 40, "上下拖动后按钮位置应改变");
    assert.ok(dragged.count > 0, "拖动不应把译文清掉");

    await page.mouse.move(before.inner - 12, dragged.top + 24);
    await page.screenshot({ path: shots.hover });
    const expanded = await page.evaluate(() => {
      const box = document.querySelector("fy-fab").getBoundingClientRect();
      return { right: box.right, width: box.width, inner: window.innerWidth, label: document.querySelector("fy-fab").shadowRoot.querySelector(".label").textContent };
    });
    assert.ok(expanded.width > before.width + 40, "悬停后胶囊应展开");
    assert.match(expanded.label, /还原/);

    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.screenshot({ path: shots.mobile, fullPage: true });
    await clickFab(page);
    try {
      await page.waitForFunction(() => !document.querySelector("fy-trans"), { timeout: 1500 });
    } catch {
      // 拖动结束时如果没有产生 click，下一次点击会先被当成拖动收尾。
      await clickFab(page);
      await page.waitForFunction(() => !document.querySelector("fy-trans"));
    }
    assert.equal(await page.$("fy-trans"), null);
    const restored = await page.evaluate(() => ({
      title: document.querySelector("h1").textContent,
      mode: document.querySelector("fy-fab").getAttribute("data-mode"),
    }));
    assert.equal(restored.title, "Claude Agents on Kubernetes");
    assert.equal(restored.mode, "idle");
  } finally {
    await browser.close();
  }
}

async function extensionFlow(articleUrl) {
  const browser = await launch(
    [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    { headless: false, ignoreDefaultArgs: ["--disable-extensions"] },
  );
  try {
    const target = await browser.waitForTarget(
      (item) => item.type() === "service_worker" && item.url().includes("background.js"),
      { timeout: 15000 },
    );
    const extensionId = new URL(target.url()).host;
    const options = await browser.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/options.html`, { waitUntil: "networkidle0" });
    await options.waitForFunction(() => document.querySelector("#model").value === "deepseek-chat");
    await options.click("#demoMode");
    await options.click("#save");
    await options.waitForFunction(() => document.querySelector("#status").textContent.includes("已保存"));

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 860 });
    await page.goto(articleUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector("fy-fab");
    await clickFab(page);
    await page.waitForSelector("h1 fy-trans");
    const translated = await page.evaluate(() => document.querySelector("h1 fy-trans").shadowRoot.textContent);
    assert.match(translated, /Claude/);
    assert.doesNotMatch(translated, /克劳德/);
    const worker = await target.worker();
    const badge = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return chrome.action.getBadgeText({ tabId: tab.id });
    });
    assert.equal(badge, "译");
    await clickFab(page);
    await page.waitForFunction(() => !document.querySelector("fy-trans"));
    const cleared = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return chrome.action.getBadgeText({ tabId: tab.id });
    });
    assert.equal(cleared, "");
  } finally {
    await browser.close();
  }
}

async function main() {
  const server = await start(0);
  const port = server.address().port;
  const shots = {
    before: "/tmp/fy-before.png",
    after: "/tmp/fy-after.png",
    hover: "/tmp/fy-hover.png",
    mobile: "/tmp/fy-mobile.png",
  };
  try {
    await previewFlow(`http://127.0.0.1:${port}/preview`, shots);
    console.log("preview ok");
    await extensionFlow(`http://127.0.0.1:${port}/`);
    console.log("extension ok");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
