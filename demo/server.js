const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 47231);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(root, relative));
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) return null;
  return full;
}

function previewDocument() {
  const html = fs.readFileSync(path.join(root, "demo", "index.html"), "utf8");
  const libs = ["terms", "sites", "settings", "glossary", "batch", "mock", "api", "dom", "ui"]
    .map((name) => `<script src="/src/lib/${name}.js"></script>`)
    .join("");
  const banner =
    '<div class="demo-banner" data-fy-ui="1" translate="no">本地演示：模拟翻译，不调用 DeepSeek。点右侧半露的圆按钮做双语对照，再点一次还原。</div>';
  return html
    .replace("<html", '<html data-fy-standalone="1"')
    .replace("</body>", `${banner}${libs}<script src="/demo/preview.js"></script></body>`);
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/preview") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(previewDocument());
      return;
    }
    const requestPath = url.pathname === "/" ? "/demo/index.html" : url.pathname;
    const full = safePath(requestPath);
    if (!full || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] || "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  });
}

function start(listenPort = port) {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(listenPort, "127.0.0.1", () => resolve(server));
  });
}

if (require.main === module) {
  start().then((server) => {
    const address = server.address();
    console.log(`http://127.0.0.1:${address.port}/preview`);
  });
}

module.exports = { start, createServer };
