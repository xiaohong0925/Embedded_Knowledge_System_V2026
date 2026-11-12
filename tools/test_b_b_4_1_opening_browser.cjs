const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("../.browser-tools/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const siteRoot = path.join(root, "site");
const outDir = path.join(root, "reviews", "sections", "B-B.4.1-browser");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const articlePath = "/b-bus-protocols/b-di-su-wai-she-jie-kou/b-b-4-1-spi/";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".pdf": "application/pdf", ".woff2": "font/woff2" };

function assert(condition, message) { if (!condition) throw new Error(message); }
function serveSite() {
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { response.writeHead(400); response.end("Bad URL"); return; }
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const pageErrors = [];
  const consoleErrors = [];
  const resource404 = [];
  const results = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() === 404) resource404.push(response.url()); });

  try {
    const response = await page.goto(`${origin}${articlePath}`, { waitUntil: "networkidle", timeout: 60000 });
    assert(response.status() === 200, `正文 HTTP 状态异常：${response.status()}`);
    const text = await page.locator("article").innerText();
    const basic = text.indexOf("主从式、同步、全双工");
    const wires = text.indexOf("标准四线 SPI");
    const device = text.indexOf("W25Q128JV-IQ/JQ");
    const mode = text.indexOf("Mode 0");
    assert(basic >= 0 && wires > basic && device > wires && mode > device, "基本模型、四线、器件和 Mode 0 的顺序异常");
    assert((await page.locator("h1").first().innerText()).includes("SPI 物理层"), "正文标题未加载");
    const images = page.locator('img[alt^="一个主机通过共享时钟"], img[alt^="W25Q128JV 手册中的"]');
    assert(await images.count() === 2, "开头两张图片未全部出现");
    for (let i = 0; i < 2; i += 1) assert(await images.nth(i).evaluate((img) => img.complete && img.naturalWidth > 0), `第 ${i + 1} 张图片加载失败`);
    const manual = page.getByRole("link", { name: "点击查看 W25Q128JV 数据手册", exact: true });
    const manualHref = await manual.getAttribute("href");
    assert(manualHref.endsWith("images/W25Q128JV_RevF.pdf"), `手册链接异常：${manualHref}`);
    const manualResponse = await page.request.get(new URL(manualHref, `${origin}${articlePath}`).href);
    assert(manualResponse.status() === 200 && (await manualResponse.body()).length > 1000, "手册 PDF 无法访问");
    assert(await page.locator("iframe").count() === 4, "既有四个交互 iframe 数量异常");
    assert(await page.locator("details").count() === 11, "既有交互 fallback 与 8 个 Q&A 的总 details 数量异常");
    results.push("基本模型→四线→器件→Mode 0 顺序、两张图片、手册 PDF、既有资源：PASS");

    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.evaluate(() => { window.scrollTo(0, 0); });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
      assert(layout.documentWidth <= layout.viewport, `${width}px 页面级横向溢出：${JSON.stringify(layout)}`);
      await page.screenshot({ path: path.join(outDir, width === 1440 ? "opening-desktop.png" : "opening-narrow.png") });
      results.push(`${width}px 新开头布局与截图：PASS`);
    }

    const knownReleaseApi = "https://api.github.com/repos/xiaohong0925/Embedded_Knowledge_System_V2026/releases/latest";
    const other404 = resource404.filter((url) => url !== knownReleaseApi);
    assert(other404.length === 0, `存在其他资源 404：${other404.join(" | ")}`);
    assert(pageErrors.length === 0, `页面脚本异常：${pageErrors.join(" | ")}`);
    results.push(`页面脚本异常 0；其他资源 404 为 0；全局 releases API 记录 ${resource404.filter((url) => url === knownReleaseApi).length} 次；console.error 共 ${consoleErrors.length} 条`);
    console.log(JSON.stringify({ status: "pass", results }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
