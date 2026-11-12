const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("../.browser-tools/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const siteRoot = path.join(root, "site");
const outDir = path.join(root, "reviews", "sections", "B-B.4.5-browser");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const articlePath = "/b-bus-protocols/b-di-su-wai-she-jie-kou/b-b-4-5-w25qxx-spi-nor-flash/";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
    assert((await page.locator("h1").first().innerText()).includes("W25Qxx"), "正文标题未加载");
    const wiring = page.locator('svg[viewBox="0 0 900 450"]');
    const address = page.locator('svg[viewBox="0 0 900 380"]');
    assert(await wiring.count() === 1 && await address.count() === 1, "两幅教学 SVG 数量异常");
    const details = page.locator("details");
    assert(await details.count() === 7, "Q&A 数量不是 7");
    for (let i = 0; i < 7; i += 1) {
      const item = details.nth(i);
      await item.locator("summary").click();
      assert(await item.evaluate((el) => el.open), `Q${i + 1} 无法展开`);
      await item.locator("summary").click();
      assert(!(await item.evaluate((el) => el.open)), `Q${i + 1} 无法收起`);
    }
    results.push("正文、两幅 SVG 与 7 个可展开/收起 Q&A：PASS");

    for (const width of [1440, 1024, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      assert(layout.documentWidth <= layout.viewport, `${width}px 出现页面级横向溢出：${JSON.stringify(layout)}`);
      for (const [name, locator] of [["wiring", wiring], ["address", address]]) {
        const box = await locator.boundingBox();
        assert(box && box.width > 0 && box.height > 0, `${width}px ${name} 未正常渲染`);
        const sizing = await locator.evaluate((el) => {
          const parent = el.parentElement;
          const own = el.getBoundingClientRect();
          return {
            width: own.width,
            overflowX: getComputedStyle(parent).overflowX,
            parentClientWidth: parent.clientWidth,
            parentScrollWidth: parent.scrollWidth,
          };
        });
        assert(sizing.width >= 700, `${width}px ${name} 被过度缩小：${JSON.stringify(sizing)}`);
        assert(sizing.overflowX === "auto", `${width}px ${name} 缺少容器内滚动`);
        assert(sizing.parentScrollWidth >= sizing.parentClientWidth, `${width}px ${name} 滚动范围异常`);
      }
      results.push(`${width}px 页面与两幅 SVG 布局：PASS`);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await wiring.screenshot({ path: path.join(outDir, "wiring-desktop.png") });
    await address.screenshot({ path: path.join(outDir, "address-desktop.png") });
    await page.setViewportSize({ width: 375, height: 1000 });
    await wiring.screenshot({ path: path.join(outDir, "wiring-narrow.png") });
    await address.screenshot({ path: path.join(outDir, "address-narrow.png") });
    for (const [name, locator] of [["wiring", wiring], ["address", address]]) {
      const scroll = await locator.evaluate((el) => {
        const parent = el.parentElement;
        parent.scrollLeft = parent.scrollWidth;
        return { left: parent.scrollLeft, max: parent.scrollWidth - parent.clientWidth };
      });
      assert(scroll.left > 0 && scroll.left === scroll.max, `${name} 无法滚动到最右端：${JSON.stringify(scroll)}`);
    }
    results.push("两幅 SVG 的桌面与 375px 截图已保存；最右端滚动断言：PASS");

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
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
