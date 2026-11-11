const fs = require("fs");
const path = require("path");
const http = require("http");
const vm = require("vm");
const { chromium } = require("../.browser-tools/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const siteRoot = path.join(root, "site");
const chapter = path.join(root, "docs", "B. 总线协议", "B. 低速外设接口");
const htmlDir = path.join(chapter, "html");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

function loadConfig() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(htmlDir, "spi-framework-fullcode.js"), "utf8"), context);
  const script = fs.readFileSync(path.join(htmlDir, "spi-framework-lab.js"), "utf8");
  const end = script.indexOf("  const $ =");
  vm.runInContext(`${script.slice(0, end)}\nglobalThis.__config = LAB_CONFIG;\n})();`, context);
  return { config: context.__config, fullCode: context.window.SPI_FULL_CODE };
}

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
const pad = (value) => String(value).padStart(2, "0");

(async () => {
  const { config, fullCode } = loadConfig();
  const server = await serveSite();
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const articlePath = "/b-bus-protocols/b-di-su-wai-she-jie-kou/b-b-4-3-spi-linux/";
  const labPath = "/b-bus-protocols/b-di-su-wai-she-jie-kou/html/spi-framework-lab.html";
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
    const articleResponse = await page.goto(`${origin}${articlePath}`, { waitUntil: "networkidle" });
    assert(articleResponse.status() === 200, `正文 HTTP 状态异常：${articleResponse.status()}`);
    assert((await page.locator("h1").first().innerText()).includes("SPI Linux"), "正文标题未加载");
    const link = page.getByRole("link", { name: "在新窗口打开 SPI Framework Lab", exact: true });
    await link.scrollIntoViewIfNeeded();
    assert(await link.getAttribute("target") === "_blank", "正文链接缺少 target=_blank");
    const rel = await link.getAttribute("rel");
    assert(rel.includes("noopener") && rel.includes("noreferrer"), "正文链接缺少 noopener noreferrer");
    const iframe = page.locator('iframe[title="B-B.4.3 SPI Framework Lab"]');
    assert(await iframe.count() === 1, "正文 iframe 缺失");
    assert((await iframe.boundingBox()).height === 960, "iframe 高度不是 960px");
    const originalUrl = page.url();
    const newPagePromise = context.waitForEvent("page");
    await link.click();
    const lab = await newPagePromise;
    await lab.waitForLoadState("networkidle");
    assert(new URL(page.url()).pathname === new URL(originalUrl).pathname && !page.isClosed(),
      `打开实验室后正文未保留在原页面：before=${originalUrl} after=${page.url()} lab=${lab.url()}`);
    assert(lab.url() === `${origin}${labPath}`, `新标签页未进入实验室：${lab.url()}`);
    results.push("正文 iframe、target/rel 与新标签打开：PASS");
    await lab.close();
    const articleExternal404 = resource404.splice(0);
    const articleConsoleErrors = consoleErrors.splice(0);
    const knownReleaseApi = "https://api.github.com/repos/xiaohong0925/Embedded_Knowledge_System_V2026/releases/latest";
    assert(articleExternal404.every((url) => url === knownReleaseApi), `正文存在其他 404：${articleExternal404.join(" | ")}`);
    results.push(`正文全局脚本的非实验资源问题单独记录：${articleExternal404.join(" | ") || "无"}；console.error ${articleConsoleErrors.length} 条`);

    await page.goto(`${origin}${labPath}`, { waitUntil: "networkidle" });
    assert(await page.title() === "SPI Framework Lab · mechanism", "默认机制视图标题异常");
    for (const [scenario, steps] of Object.entries(config.scenarios)) {
      await page.selectOption("#scenario-mode", scenario);
      assert(await page.locator(".step-chip").count() === steps.length, `${scenario} 步骤数量不符`);
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        await page.locator(".step-chip").nth(index).click();
        assert((await page.locator("#step-counter").innerText()).trim() === `${pad(index + 1)} / ${pad(steps.length)}`,
          `${scenario}[${index + 1}] 计数不符`);
        assert((await page.locator("#step-code-path").innerText()).includes(step.path), `${scenario}[${index + 1}] 片段路径不符`);
        assert((await page.locator("#step-code .is-current .line-no").innerText()).trim() === String(step.line),
          `${scenario}[${index + 1}] 片段高亮行不符`);
        const states = await page.locator("#state-grid > div").evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [
          node.querySelector("dt").textContent, node.querySelector("dd").textContent
        ])));
        const expectedStates = Object.fromEntries(Object.entries(step.states).filter(([key]) => key !== "returnTone"));
        assert(JSON.stringify(states) === JSON.stringify(expectedStates), `${scenario}[${index + 1}] 状态不符`);
        assert((await page.locator("#step-note").innerText()).trim() === step.note, `${scenario}[${index + 1}] 解释不符`);
        const observations = await page.locator("#step-observations li").allInnerTexts();
        assert(JSON.stringify(observations) === JSON.stringify(step.observations), `${scenario}[${index + 1}] 观察项不符`);
        const toggle = page.locator("#step-full-toggle");
        if (step.full) {
          assert(await toggle.isEnabled(), `${scenario}[${index + 1}] 完整函数按钮被禁用`);
          await toggle.click();
          assert((await page.locator("#step-code-path").innerText()).includes(fullCode[step.full.key].path),
            `${scenario}[${index + 1}] 完整来源路径不符`);
          assert((await page.locator("#step-code .is-current .line-no").innerText()).trim() === String(step.line),
            `${scenario}[${index + 1}] 完整来源高亮行不符`);
          assert((await page.locator("#step-code .line-no").first().innerText()).trim() === String(fullCode[step.full.key].startLine),
            `${scenario}[${index + 1}] 完整来源起始行不符`);
          await toggle.click();
        } else {
          assert(await toggle.isDisabled(), `${scenario}[${index + 1}] 无完整来源时按钮未禁用`);
        }
      }
      await page.locator("#step-reset").click();
      assert((await page.locator("#step-counter").innerText()).trim() === `01 / ${pad(steps.length)}`, `${scenario} 复位失败`);
      await page.locator("#step-next").click();
      assert((await page.locator("#step-counter").innerText()).trim() === `02 / ${pad(steps.length)}`, `${scenario} 下一步失败`);
      await page.locator("#step-prev").click();
      assert((await page.locator("#step-counter").innerText()).trim() === `01 / ${pad(steps.length)}`, `${scenario} 上一步失败`);
      await page.keyboard.press("ArrowRight");
      assert((await page.locator("#step-counter").innerText()).trim() === `02 / ${pad(steps.length)}`, `${scenario} 右方向键失败`);
      await page.keyboard.press("ArrowLeft");
      assert((await page.locator("#step-counter").innerText()).trim() === `01 / ${pad(steps.length)}`, `${scenario} 左方向键失败`);
      results.push(`${scenario}：${steps.length} 步、完整来源、状态、上下步、复位与键盘：PASS`);
    }

    await page.locator('.rail-item[data-view="source"]').click();
    assert(page.url().endsWith("#source"), "源码视图 hash 未更新");
    await page.reload({ waitUntil: "networkidle" });
    assert(await page.locator("#view-source").isVisible(), "#source 刷新后未保持");
    for (const file of config.sourceFiles) {
      await page.locator(".source-file-button").filter({ hasText: file.name }).click();
      await page.waitForFunction((name) => {
        const status = document.getElementById("source-status").textContent;
        return status.includes(`加载成功：${name}`) || status.includes(`已从缓存读取 ${name}`);
      }, file.name);
      assert((await page.locator("#source-code .line-no").first().innerText()).trim() === "1", `${file.name} 源码行号不是从 1 开始`);
      assert((await page.locator("#source-download").getAttribute("download")) === file.name, `${file.name} 下载名不符`);
      await page.locator("#copy-source").click();
      await page.waitForFunction((name) => {
        const status = document.getElementById("source-status").textContent;
        return status.includes(`已复制 ${name}`) || status.includes("复制失败");
      }, file.name);
      const copyStatus = await page.locator("#source-status").innerText();
      assert(copyStatus.includes(`已复制 ${file.name}`), `${file.name} 复制失败：${copyStatus}`);
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#source-download").click();
      const download = await downloadPromise;
      const suggestedName = download.suggestedFilename();
      const allowedNames = file.name === "Makefile" ? ["Makefile", "Makefile.txt"] : [file.name];
      assert(allowedNames.includes(suggestedName), `${file.name} 下载事件文件名不符：${suggestedName}`);
      results.push(`源码 ${file.name}：加载、复制、下载 PASS（Chrome 保存名 ${suggestedName}）`);
    }
    await page.evaluate(() => { window.location.hash = "#mechanism"; });
    await page.waitForFunction(() => document.getElementById("view-mechanism").classList.contains("is-active"));
    await page.reload({ waitUntil: "networkidle" });
    assert(await page.locator("#view-mechanism").isVisible(), "#mechanism 刷新后未保持");
    await page.goto(`${origin}${labPath}#invalid-view`, { waitUntil: "networkidle" });
    assert(await page.locator("#view-mechanism").isVisible(), "错误 hash 未回退机制视图");
    results.push("hash 切换、刷新与错误 hash 回退：PASS");

    const errorPage = await context.newPage();
    await errorPage.route("**/code/B-B.4.3/spi_frame_observer.c", (route) => route.fulfill({ status: 404, body: "intentional test 404" }));
    await errorPage.goto(`${origin}${labPath}#source`, { waitUntil: "networkidle" });
    await errorPage.waitForFunction(() => document.getElementById("source-status").textContent.includes("源码加载失败"));
    assert((await errorPage.locator("#source-code").innerText()).includes("HTTP 404"), "错误 URL 未显示 HTTP 404");
    assert((await errorPage.locator("#source-status").innerText()).includes("请经 MkDocs"), "错误 URL 未给出可读恢复方法");
    await errorPage.close();
    results.push("制造源码 404：可读错误与恢复说明 PASS");

    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}${labPath}#mechanism`, { waitUntil: "networkidle" });
      for (const view of ["mechanism", "source"]) {
        await page.locator(`.rail-item[data-view="${view}"]`).click();
        if (view === "source") await page.waitForFunction(() => document.getElementById("source-status").textContent.includes("加载成功"));
        const layout = await page.evaluate(() => ({
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          visibleButtons: Array.from(document.querySelectorAll("button")).filter((button) => {
            const style = getComputedStyle(button);
            const rect = button.getBoundingClientRect();
            return !button.classList.contains("step-chip") && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          }).every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= window.innerWidth + 1;
          })
        }));
        assert(layout.documentWidth <= width && layout.bodyWidth <= width,
          `${width}px ${view} 整体横向溢出：${JSON.stringify(layout)}`);
        assert(layout.visibleButtons, `${width}px ${view} 存在超出视口的可见按钮`);
      }
      results.push(`${width}px 机制/源码视图：无整体横向溢出，按钮在视口内 PASS`);
    }

    assert(pageErrors.length === 0, `JavaScript 异常：${pageErrors.join(" | ")}`);
    assert(consoleErrors.length === 0, `console.error：${consoleErrors.join(" | ")}；404=${resource404.join(" | ")}`);
    assert(resource404.length === 0, `实验室自身资源 404：${resource404.join(" | ")}`);
    results.push("无 JavaScript 异常、console.error 或自身资源 404：PASS");
    console.log(results.join("\n"));
    console.log(`BROWSER_TEST_PASS scenarios=${Object.keys(config.scenarios).length} steps=${Object.values(config.scenarios).reduce((sum, steps) => sum + steps.length, 0)} widths=375,768,1024,1440`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
