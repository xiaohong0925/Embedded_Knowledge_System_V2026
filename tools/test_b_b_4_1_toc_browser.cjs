const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("../.browser-tools/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const siteRoot = path.join(root, "site");
const outDir = path.join(root, "reviews", "sections", "B-B.4.1-browser");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const articlePath = "/b-bus-protocols/b-di-su-wai-she-jie-kou/b-b-4-1-spi/";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".pdf": "application/pdf", ".woff2": "font/woff2" };
function assert(condition, message) { if (!condition) throw new Error(message); }
function serveSite() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const filePath = path.resolve(siteRoot, `.${pathname}`);
    if (!filePath.startsWith(siteRoot)) { response.writeHead(403); response.end("Forbidden"); return; }
    let target = filePath;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404); response.end("Not found"); return; }
    response.writeHead(200, { "Content-Type": mime[path.extname(target)] || "text/plain; charset=utf-8" });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = await serveSite();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 1100 } });
  const pageErrors = [];
  const resource404 = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => { if (response.status() === 404) resource404.push(response.url()); });
  try {
    const response = await page.goto(`${origin}${articlePath}`, { waitUntil: "networkidle", timeout: 60000 });
    assert(response.status() === 200, `正文 HTTP 状态异常：${response.status()}`);
    await page.locator('.md-header__button[for="__drawer"]').click();
    await page.waitForFunction(() => document.getElementById("__drawer").checked, { timeout: 5000 });
    await page.waitForTimeout(450);
    const drawerBox = await page.locator(".md-nav--primary").boundingBox();
    assert(drawerBox && drawerBox.x >= 0, `目录抽屉未完整进入视口：${JSON.stringify(drawerBox)}`);
    await page.locator('label.md-nav__link--active[for="__toc"]').click();
    await page.waitForFunction(() => document.getElementById("__toc").checked, { timeout: 5000 });
    await page.waitForTimeout(450);
    const toc = await page.locator(".md-nav--primary").innerText();
    for (const title of ["四线怎样完成一笔读取", "电平、移位与 MISO 驱动权", "CPOL 与 CPHA 怎样决定采样", "由 CPOL×CPHA 推导四种模式", "多从机怎样避免 MISO 争用", "模式正确，为什么仍会读错？"]) {
      assert(toc.includes(title), `目录缺少短标题：${title}`);
    }
    assert(!toc.includes("推挽、高阻、全双工移位和驱动权"), "旧的长标题仍存在");
    assert(!toc.includes("先定义 CPOL、CPHA、预载、更新和采样"), "旧的术语堆叠标题仍存在");
    const layout = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    assert(layout.documentWidth <= layout.viewport, `375px 页面横向溢出：${JSON.stringify(layout)}`);
    await page.screenshot({ path: path.join(outDir, "toc-narrow.png") });
    const knownReleaseApi = "https://api.github.com/repos/xiaohong0925/Embedded_Knowledge_System_V2026/releases/latest";
    const other404 = resource404.filter((url) => url !== knownReleaseApi);
    assert(other404.length === 0, `其他资源 404：${other404.join(" | ")}`);
    assert(pageErrors.length === 0, `页面脚本异常：${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ status: "pass", short_titles: 6, screenshot: "toc-narrow.png", global_release_404: resource404.length }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
