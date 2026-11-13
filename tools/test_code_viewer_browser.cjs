const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("../.browser-tools/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const siteRoot = path.join(root, "site");
const chapter = path.join(root, "docs", "B. 总线协议", "B. 低速外设接口");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const articlePath = "/b-bus-protocols/b-di-su-wai-she-jie-kou/b-b-4-3-spi-linux/";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

function serveSite() {
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { response.writeHead(400); response.end("Bad URL"); return; }
    let filePath = path.resolve(siteRoot, `.${pathname}`);
    if (!filePath.startsWith(siteRoot)) { response.writeHead(403); response.end("Forbidden"); return; }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { response.writeHead(404); response.end("Not found"); return; }
    response.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "text/plain; charset=utf-8" });
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectedRanges(value, lineCount) {
  if (!value) return [];
  return value.split(",").map((part) => {
    const [start, end] = part.split("-").map(Number);
    return [start, Math.min(end || start, lineCount)];
  });
}

(async () => {
  const server = await serveSite();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const resource404 = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() === 404) resource404.push(response.url()); });
  const results = [];

  try {
    const response = await page.goto(`${origin}${articlePath}`, { waitUntil: "networkidle" });
    assert(response.status() === 200, `正文 HTTP ${response.status()}`);
    const links = page.locator("a[data-code-viewer]");
    assert(await links.count() === 12, `弹窗入口应为 12，实际 ${await links.count()}`);
    const originalUrl = page.url();

    for (let index = 0; index < 12; index += 1) {
      const link = links.nth(index);
      const href = await link.getAttribute("href");
      const rangeValue = (await link.getAttribute("data-code-lines")) || "";
      const expectedTitle = await link.getAttribute("data-code-title");
      const hrefPath = decodeURIComponent(new URL(href, `${origin}${articlePath}`).pathname);
      const codeMarker = hrefPath.indexOf("/code/");
      assert(codeMarker >= 0, `入口 ${index + 1} 不是配套源码 URL：${href}`);
      const sourcePath = path.join(chapter, hrefPath.slice(codeMarker + 1));
      const expectedText = fs.readFileSync(sourcePath, "utf8");
      const expectedLineCount = expectedText.replace(/\r\n?/g, "\n").split("\n").length;
      await link.scrollIntoViewIfNeeded();
      await link.click();
      const dialog = page.locator("dialog.code-viewer");
      await dialog.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const status = document.querySelector(".code-viewer__status").textContent;
        return status.includes(" 行") && !status.includes("正在");
      });
      assert((await page.locator("#code-viewer-title").innerText()) === expectedTitle, `入口 ${index + 1} 标题不符`);
      assert(await page.locator(".code-viewer__line").count() === expectedLineCount, `入口 ${index + 1} 行数不符`);
      assert((await page.locator("[data-code-copy]").getAttribute("data-source")) === expectedText, `入口 ${index + 1} 源码文本不符`);
      assert((await page.locator("[data-code-download]").getAttribute("download")) === expectedTitle, `入口 ${index + 1} 下载名不符`);
      const raw = page.locator("[data-code-raw]");
      assert(await raw.getAttribute("target") === "_blank", `入口 ${index + 1} 原文件未在新标签打开`);
      const rel = await raw.getAttribute("rel");
      assert(rel.includes("noopener") && rel.includes("noreferrer"), `入口 ${index + 1} 原文件 rel 不符`);

      const ranges = expectedRanges(rangeValue, expectedLineCount);
      const expectedHighlights = ranges.reduce((sum, [start, end]) => sum + end - start + 1, 0);
      assert(await page.locator(".code-viewer__line.is-highlighted").count() === expectedHighlights, `入口 ${index + 1} 高亮行数不符`);
      if (ranges.length) {
        const first = Number(await page.locator(".code-viewer__line.is-highlighted").first().getAttribute("data-line"));
        assert(first === Math.min(...ranges.map(([start]) => start)), `入口 ${index + 1} 首个高亮行不符`);
        await page.waitForFunction(() => document.querySelector(".code-viewer__code").scrollTop > 0);
      }

      if (expectedTitle === "spi-frame-observer.dts") {
        await page.locator("[data-code-copy]").click();
        await page.waitForFunction(() => document.querySelector(".code-viewer__status").textContent.includes("已复制"));
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        assert(clipboardText.replace(/\r\n?/g, "\n") === expectedText.replace(/\r\n?/g, "\n"), "复制内容与 DTS 原文不符（已排除 Windows 剪贴板换行规范化）");
        const downloadPromise = page.waitForEvent("download");
        await page.locator("[data-code-download]").click();
        const download = await downloadPromise;
        assert(download.suggestedFilename() === "spi-frame-observer.dts", `DTS 下载名 ${download.suggestedFilename()}`);
      }

      if (index === 11) {
        const downloadPromise = page.waitForEvent("download");
        await page.locator("[data-code-download]").click();
        const download = await downloadPromise;
        assert(["Makefile", "Makefile.txt"].includes(download.suggestedFilename()), `Makefile 下载名 ${download.suggestedFilename()}`);
      }

      if (index % 3 === 0) await page.keyboard.press("Escape");
      else await page.locator("[data-code-close]").click();
      assert(!(await dialog.isVisible()), `入口 ${index + 1} 关闭失败`);
      assert(new URL(page.url()).pathname === new URL(originalUrl).pathname, `入口 ${index + 1} 导致正文导航：${page.url()}`);
    }
    results.push("12 个入口：内容、行号、高亮、原文件链接与关闭 PASS");
    results.push("DTS 复制与下载、Makefile 下载、Esc 关闭、正文不跳转 PASS");

    const errorPage = await context.newPage();
    await errorPage.route("**/code/B-B.4.3/spi_frame_observer.c", (route) => route.fulfill({ status: 404, body: "intentional test 404" }));
    await errorPage.goto(`${origin}${articlePath}`, { waitUntil: "networkidle" });
    await errorPage.locator('a[data-code-title="spi_frame_observer.c"]').click();
    await errorPage.waitForFunction(() => document.querySelector(".code-viewer__status").textContent.includes("HTTP 404"));
    assert(await errorPage.locator(".code-viewer__error").isVisible(), "404 未显示可读错误");
    assert(await errorPage.locator("[data-code-copy]").isDisabled(), "404 后复制按钮未禁用");
    assert((await errorPage.locator("[data-code-raw]").getAttribute("href")).endsWith("/code/B-B.4.3/spi_frame_observer.c"), "404 后原文件出口丢失");
    await errorPage.keyboard.press("Escape");
    assert(await errorPage.locator("dialog.code-viewer code").count() === 1, "404 后代码容器被移除，无法重试");
    await errorPage.unroute("**/code/B-B.4.3/spi_frame_observer.c");
    await errorPage.locator('a[data-code-title="spi_frame_observer.c"]').click();
    await errorPage.waitForFunction(() => document.querySelectorAll(".code-viewer__line").length > 100);
    assert(await errorPage.locator(".code-viewer__error").count() === 0, "404 后成功重试仍显示旧错误");
    assert(await errorPage.locator("[data-code-copy]").isEnabled(), "404 后成功重试未恢复复制");
    await errorPage.mouse.click(5, 5);
    assert(!(await errorPage.locator("dialog.code-viewer").isVisible()), "点击遮罩未关闭弹窗");
    await errorPage.close();
    results.push("制造 404：可读错误、原文件出口、成功重试、Esc 与遮罩关闭 PASS");

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}${articlePath}`, { waitUntil: "networkidle" });
      await page.locator('a[data-code-title="spi.c"]').first().click();
      await page.waitForFunction(() => document.querySelectorAll(".code-viewer__line").length > 4000);
      const layout = await page.evaluate(() => {
        const dialog = document.querySelector("dialog.code-viewer");
        const rect = dialog.getBoundingClientRect();
        return {
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          controlsFit: Array.from(dialog.querySelectorAll("button, a")).every((control) => {
            const box = control.getBoundingClientRect();
            return box.left >= 0 && box.right <= window.innerWidth + 1;
          })
        };
      });
      assert(layout.documentWidth <= width && layout.bodyWidth <= width, `${width}px 页面横向溢出 ${JSON.stringify(layout)}`);
      assert(layout.left >= 0 && layout.right <= width + 1 && layout.top >= 0 && layout.bottom <= 901, `${width}px 弹窗超出视口`);
      assert(layout.controlsFit, `${width}px 弹窗控件超出视口`);
      if (width === 375 || width === 1440) {
        await page.screenshot({ path: path.join(root, ".browser-tools", `code-viewer-${width}.png`), fullPage: false });
      }
      await page.keyboard.press("Escape");
      results.push(`${width}px：弹窗与控件在视口内，无页面横向溢出 PASS`);
    }

    const knownReleaseApi = "https://api.github.com/repos/xiaohong0925/Embedded_Knowledge_System_V2026/releases/latest";
    const unexpected404 = resource404.filter((url) => url !== knownReleaseApi);
    assert(unexpected404.length === 0, `异常资源 404：${unexpected404.join(" | ")}`);
    assert(pageErrors.length === 0, `JavaScript 异常：${pageErrors.join(" | ")}`);
    assert(consoleErrors.filter((message) => !message.includes("404")).length === 0, `console.error：${consoleErrors.join(" | ")}`);
    results.push("无 JavaScript 异常、意外 console.error 或本站资源 404 PASS");
    console.log(results.join("\n"));
    console.log("CODE_VIEWER_BROWSER_PASS links=12 widths=375,768,1440");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
