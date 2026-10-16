const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const { start } = require("../demo/server");

const ARTIFACTS = process.env.FY_ARTIFACTS || "/opt/cursor/artifacts";

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
  const visible = await page.evaluate(() => {
    const button = document.querySelector("fy-fab")?.shadowRoot?.querySelector("button");
    if (!button) throw new Error("找不到悬浮按钮");
    const rect = button.getBoundingClientRect();
    return {
      x: Math.min(window.innerWidth - 2, Math.max(2, rect.left + 8)),
      y: rect.top + rect.height / 2,
    };
  });
  await page.mouse.move(visible.x, visible.y);
  await new Promise((resolve) => setTimeout(resolve, 320));
  const center = await page.evaluate(() => {
    const button = document.querySelector("fy-fab")?.shadowRoot?.querySelector("button");
    if (!button) throw new Error("找不到悬浮按钮");
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(center.x, center.y);
}

function fakeTranslate(text) {
  return String(text)
    .split(/(⟪[^⟫]*⟫)/)
    .map((part) => (part.startsWith("⟪") || !part.trim() ? part : "中文译文"))
    .join("");
}

function startMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const strings = JSON.parse(body.messages.find((item) => item.role === "user").content);
      const translations = strings.map(fakeTranslate);
      requests.push({
        count: strings.length,
        model: body.model,
        responseFormat: body.response_format || null,
        thinking: body.thinking || null,
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify({ translations }) },
        }],
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, requests, port: server.address().port }));
  });
}

async function dispatchToggle(worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { ok: false, reason: "no tab" };
    const response = await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE" });
    return { ok: true, url: tab.url, response };
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
    await options.waitForFunction(() => document.querySelector("#model").value === "deepseek-flash");
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

async function liveExtensionFlow(articleUrl, mock) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const shots = {
    connection: path.join(ARTIFACTS, "screenshot_test_connection.png"),
    before: path.join(ARTIFACTS, "screenshot_before_translate.png"),
    after: path.join(ARTIFACTS, "screenshot_after_translate.png"),
    restored: path.join(ARTIFACTS, "screenshot_restored.png"),
  };
  const summary = [];
  const note = (line) => {
    summary.push(line);
    console.log(line);
  };
  const browser = await launch(
    [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    { headless: false, ignoreDefaultArgs: ["--disable-extensions"] },
  );
  try {
    const target = await browser.waitForTarget(
      (item) => item.type() === "service_worker" && item.url().includes("background.js"),
      { timeout: 15000 },
    );
    const worker = await target.worker();
    const extensionId = new URL(target.url()).host;
    const options = await browser.newPage();
    await options.setViewport({ width: 1100, height: 900 });
    await options.goto(`chrome-extension://${extensionId}/src/options.html`, { waitUntil: "networkidle0" });
    await options.waitForFunction(() => document.querySelector("#model").value === "deepseek-flash");
    await options.$eval("#apiKey", (el) => {
      el.value = "sk-live-test";
    });
    await options.$eval("#model", (el) => {
      el.value = "mock-translator";
    });
    await options.$eval("#baseUrl", (el, value) => {
      el.value = value;
    }, `http://127.0.0.1:${mock.port}/v1`);
    await options.$eval("#demoMode", (el) => {
      el.checked = false;
    });
    await options.click("#test");
    await options.waitForFunction(() => {
      const text = document.querySelector("#status")?.textContent || "";
      return text.includes("接口返回") || text.includes("失败") || text.includes("错误");
    }, { timeout: 15000 });
    const status = await options.$eval("#status", (el) => ({ text: el.textContent, className: el.className }));
    assert.equal(status.className, "ok");
    assert.match(status.text, /接口返回/);
    assert.doesNotMatch(status.text, /演示模式/);
    assert.match(status.text, /Claude/);
    assert.match(status.text, /Agent/);
    assert.doesNotMatch(status.text, /克劳德|代理/);
    await options.$eval("#status", (el) => el.scrollIntoView({ block: "center" }));
    await options.screenshot({ path: shots.connection });
    note(`test connection ok: ${status.text}`);
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].count, 1);
    assert.equal(mock.requests[0].thinking, null);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(articleUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector("fy-fab");
    assert.equal(await page.$("fy-trans"), null);
    await page.screenshot({ path: shots.before, fullPage: true });
    note("before: no fy-trans");

    await clickFab(page);
    await page.waitForFunction(
      () => document.querySelector("fy-fab")?.getAttribute("data-mode") === "translated",
      { timeout: 15000 },
    );
    const translated = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const trans = h1.querySelector("fy-trans");
      const body = trans?.shadowRoot?.querySelector(".body");
      const h1Box = h1.getBoundingClientRect();
      const transBox = trans.getBoundingClientRect();
      const all = [...document.querySelectorAll("fy-trans")].map((node) => node.shadowRoot.querySelector(".body")?.textContent || "");
      return {
        count: all.length,
        original: h1.childNodes[0].textContent,
        text: body?.textContent || "",
        below: transBox.top > h1Box.top + 8,
        preCount: document.querySelectorAll("pre fy-trans").length,
        joined: all.join("\n"),
      };
    });
    assert.ok(translated.count >= 18, `译文段数过少: ${translated.count}`);
    assert.equal(translated.original, "Claude Agents on Kubernetes");
    assert.match(translated.text, /中文译文/);
    assert.match(translated.text, /Claude/);
    assert.match(translated.text, /Agent/);
    assert.match(translated.text, /Kubernetes/);
    assert.doesNotMatch(translated.joined, /克劳德|代理/);
    assert.equal(translated.below, true);
    assert.equal(translated.preCount, 0);
    await page.screenshot({ path: shots.after, fullPage: true });
    note(`fab mouse click translated ${translated.count} blocks; h1=${translated.text}`);

    await clickFab(page);
    await page.waitForFunction(() => !document.querySelector("fy-trans"), { timeout: 8000 });
    const restored = await page.evaluate(() => ({
      title: document.querySelector("h1").textContent,
      mode: document.querySelector("fy-fab").getAttribute("data-mode"),
    }));
    assert.equal(restored.title, "Claude Agents on Kubernetes");
    assert.equal(restored.mode, "idle");
    await page.screenshot({ path: shots.restored, fullPage: true });
    note("fab second click restored");

    await page.bringToFront();
    const commands = await worker.evaluate(() => chrome.commands.getAll());
    note(`commands: ${JSON.stringify(commands)}`);
    const toolbar = await dispatchToggle(worker);
    assert.equal(toolbar.ok, true);
    await page.waitForFunction(
      () => document.querySelector("fy-fab")?.getAttribute("data-mode") === "translated",
      { timeout: 15000 },
    );
    const viaAction = await page.evaluate(() => document.querySelector("h1 fy-trans")?.shadowRoot?.querySelector(".body")?.textContent || "");
    assert.match(viaAction, /中文译文/);
    assert.match(viaAction, /Claude/);
    note(`toolbar/action dispatchToggle translated: ${viaAction}`);
    await dispatchToggle(worker);
    await page.waitForFunction(() => !document.querySelector("fy-trans"), { timeout: 8000 });

    const command = await dispatchToggle(worker);
    assert.equal(command.ok, true);
    await page.waitForFunction(
      () => document.querySelector("fy-fab")?.getAttribute("data-mode") === "translated",
      { timeout: 15000 },
    );
    const viaCommand = await page.evaluate(() => document.querySelectorAll("fy-trans").length);
    assert.ok(viaCommand >= 18);
    note(`command dispatchToggle translated ${viaCommand} blocks`);
    await dispatchToggle(worker);
    await page.waitForFunction(() => !document.querySelector("fy-trans"));
    note(`mock requests: ${JSON.stringify(mock.requests.map((item) => ({ count: item.count, model: item.model, responseFormat: item.responseFormat, thinking: item.thinking })))}`);
    fs.writeFileSync(path.join(ARTIFACTS, "e2e_live_summary.txt"), `${summary.join("\n")}\n`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const server = await start(0);
  const mock = await startMock();
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
    await liveExtensionFlow(`http://127.0.0.1:${port}/`, mock);
    console.log("live ok");
  } finally {
    server.close();
    mock.server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
