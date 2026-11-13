// B-B.3.4 实验室真实浏览器验收。只用 Node 内置模块；测试结束关闭 HTTP 与 Chrome。
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = process.env.LAB_TEST_ROOT ? path.resolve(process.env.LAB_TEST_ROOT) : path.resolve(here, "../../../..");
const labPath = "/B. 总线协议/B. 低速外设接口/html/i2cdev-lab.html";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const tempRoot = path.join(here, ".browser-test-temp");
const downloadDir = path.join(tempRoot, "downloads");
const profileDir = path.join(tempRoot, "profile");
let failCoreOnce = false;
let browser;
let server;
let socket;

const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".c", "text/plain; charset=utf-8"], [".h", "text/plain; charset=utf-8"],
  [".sh", "text/plain; charset=utf-8"], [".md", "text/plain; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml"]
]);

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer(async (request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/__test_fail_core_once") {
        failCoreOnce = true;
        response.writeHead(200).end("ok");
        return;
      }
      if (failCoreOnce && pathname.endsWith("/i2c-core-base.c")) {
        failCoreOnce = false;
        response.writeHead(404).end("intentional test failure");
        return;
      }
      const filename = path.resolve(docsRoot, `.${pathname}`);
      if (!filename.startsWith(`${docsRoot}${path.sep}`)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      try {
        const info = await stat(filename);
        if (!info.isFile()) throw new Error("not file");
        const body = await readFile(filename);
        response.writeHead(200, {
          "Content-Type": mime.get(path.extname(filename)) || "application/octet-stream",
          "Content-Length": body.length,
          "Cache-Control": "no-store"
        });
        response.end(body);
      } catch {
        response.writeHead(404).end("not found");
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function waitFor(check, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待超时：${description}；最后结果：${String(last)}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    this.badResponses = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") this.exceptions.push(message.params);
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.consoleErrors.push(message.params);
      }
      if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
        this.badResponses.push({ status: message.params.response.status, url: message.params.response.url });
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(downloadDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  const port = await startServer();
  const origin = `http://127.0.0.1:${port}`;
  let labUrl = `${origin}${encodeURI(labPath)}`;

  browser = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeErrors = "";
  browser.stderr.on("data", (chunk) => { chromeErrors += chunk.toString(); });

  const debugPort = await waitFor(async () => {
    const content = await readFile(path.join(profileDir, "DevToolsActivePort"), "utf8");
    return Number(content.split(/\r?\n/)[0]);
  }, "Chrome DevTools 端口");
  const pages = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const list = await response.json();
    return list.find((item) => item.type === "page") ? list : null;
  }, "Chrome 页面目标");
  const page = pages.find((item) => item.type === "page");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(socket);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Browser.grantPermissions", {
    origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"]
  });
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow", downloadPath: downloadDir
  });
  let articleResult = "未单独检查构建后正文";
  if (process.env.LAB_TEST_ARTICLE) {
    const articleUrl = new URL(
      encodeURI(process.env.LAB_TEST_ARTICLE).replace(/^\/+/, ""),
      `${origin}/`
    ).href;
    await cdp.send("Page.navigate", { url: articleUrl });
    await waitFor(() => cdp.evaluate(`document.readyState === "complete" && !!document.querySelector('a[href$="i2cdev-lab.html"]')`), "构建后正文与实验室链接");
    const articleLink = await cdp.evaluate(`(() => {
      const link = document.querySelector('a[href$="i2cdev-lab.html"]');
      const iframe = document.querySelector('iframe[title*="i2c-dev"]');
      return { target: link.target, rel: link.rel, href: link.href, iframe: iframe?.src, article: location.href };
    })()`);
    assert(articleLink.target === "_blank" && articleLink.rel.includes("noopener") && articleLink.rel.includes("noreferrer"), "正文新窗口链接属性错误");
    const iframeResponse = await fetch(articleLink.iframe);
    assert(iframeResponse.ok, `构建后 iframe 路径不可访问：${iframeResponse.status}`);
    const originalTargetIds = new Set(
      (await cdp.send("Target.getTargets")).targetInfos.map((target) => target.targetId)
    );
    await cdp.evaluate(`document.querySelector('a[href$="i2cdev-lab.html"]').scrollIntoView({ block: "center", behavior: "instant" })`);
    const clickPoint = await waitFor(() => cdp.evaluate(`(() => {
      const rect = document.querySelector('a[href$="i2cdev-lab.html"]').getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > innerHeight) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`), "正文链接进入视口");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...clickPoint });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...clickPoint, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...clickPoint, button: "left", clickCount: 1 });
    const newTarget = await waitFor(async () => {
      const targets = await cdp.send("Target.getTargets");
      return targets.targetInfos.find((target) => target.type === "page" && !originalTargetIds.has(target.targetId));
    }, "正文链接创建新标签页");
    await waitFor(async () => {
      const targets = await cdp.send("Target.getTargets");
      return targets.targetInfos.find((target) => target.targetId === newTarget.targetId && target.url.includes("i2cdev-lab.html"));
    }, "新标签页加载实验室");
    assert(await cdp.evaluate("location.href") === articleLink.article, "打开实验室时覆盖了正文标签页");
    await cdp.send("Target.closeTarget", { targetId: newTarget.targetId });
    labUrl = articleLink.href;
    articleResult = "构建后正文 iframe 可访问；新标签页打开且正文保留";
  }

  await cdp.send("Page.navigate", { url: labUrl });
  await waitFor(() => cdp.evaluate(`document.readyState === "complete"`), "实验室文档加载");
  const initialized = await cdp.evaluate(`document.getElementById("step-counter")?.textContent.includes("/") || false`);
  if (!initialized) {
    console.error("初始化诊断：", JSON.stringify({
      labUrl,
      location: await cdp.evaluate("location.href"),
      body: await cdp.evaluate("document.body.innerText.slice(0, 1200)"),
      exceptions: cdp.exceptions,
      consoleErrors: cdp.consoleErrors,
      badResponses: cdp.badResponses
    }, null, 2));
    throw new Error("实验室脚本未完成初始化");
  }

  const expected = { normal: 10, busy: 4, nack: 5, short: 4, efault: 4 };
  const results = [];
  for (const [scenario, count] of Object.entries(expected)) {
    await cdp.evaluate(`(() => {
      const select = document.getElementById("scenario-mode");
      select.value = ${JSON.stringify(scenario)};
      select.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    for (let index = 0; index < count; index++) {
      const snippet = await cdp.evaluate(`(() => ({
        counter: document.getElementById("step-counter").textContent,
        line: document.querySelector("#step-code .is-current .line-no")?.textContent,
        path: document.getElementById("step-code-path").textContent,
        note: document.getElementById("step-note").textContent,
        states: document.querySelectorAll("#state-grid dt").length,
        observations: document.querySelectorAll("#step-observations li").length
      }))()`);
      assert(snippet.counter === `${String(index + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`, `${scenario} 步骤计数错误`);
      assert(Number(snippet.line) > 0 && snippet.note.length > 20 && snippet.states >= 3 && snippet.observations >= 2, `${scenario} 第 ${index + 1} 步内容不完整`);
      await cdp.evaluate(`document.getElementById("step-full-toggle").click()`);
      const full = await cdp.evaluate(`(() => ({
        pressed: document.getElementById("step-full-toggle").getAttribute("aria-pressed"),
        line: document.querySelector("#step-code .is-current .line-no")?.textContent,
        path: document.getElementById("step-code-path").textContent,
        lines: document.querySelectorAll("#step-code .code-line").length
      }))()`);
      assert(full.pressed === "true" && Number(full.line) > 0 && full.path.includes("起始行") && full.lines > 5, `${scenario} 第 ${index + 1} 步完整函数切换失败`);
      await cdp.evaluate(`document.getElementById("step-full-toggle").click()`);
      if (index < count - 1) await cdp.evaluate(`document.getElementById("step-next").click()`);
    }
    results.push(`${scenario}:${count}步（片段/完整函数均通过）`);
  }

  await cdp.evaluate(`(() => {
    const select = document.getElementById("scenario-mode");
    select.value = "normal";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  assert(await cdp.evaluate(`document.getElementById("step-counter").textContent`) === "02 / 10", "右方向键未推进");
  await cdp.evaluate(`document.getElementById("step-prev").click()`);
  assert(await cdp.evaluate(`document.getElementById("step-counter").textContent`) === "01 / 10", "上一步未返回");
  await cdp.evaluate(`document.getElementById("step-next").click(); document.getElementById("step-reset").click()`);
  assert(await cdp.evaluate(`document.getElementById("step-counter").textContent`) === "01 / 10", "复位失败");

  await cdp.evaluate(`document.querySelector('[data-view="source"]').click()`);
  await waitFor(() => cdp.evaluate(`document.getElementById("source-status").textContent.startsWith("加载成功")`), "默认源码加载");
  assert(await cdp.evaluate(`location.hash`) === "#source", "源码 hash 错误");
  const sourceNames = await cdp.evaluate(`Array.from(document.querySelectorAll(".source-file-button code"), node => node.textContent)`);
  assert(sourceNames.length === 8, "源码文件数量不是 8");
  for (const name of sourceNames) {
    await cdp.evaluate(`Array.from(document.querySelectorAll(".source-file-button")).find(button => button.querySelector("code").textContent === ${JSON.stringify(name)}).click()`);
    await waitFor(() => cdp.evaluate(`document.getElementById("source-status").textContent.startsWith("加载成功") || document.getElementById("source-status").textContent.startsWith("已从缓存")`), `加载 ${name}`);
    assert(await cdp.evaluate(`document.querySelectorAll("#source-code .code-line").length`) > 5, `${name} 未显示完整行`);
  }

  await cdp.evaluate(`document.querySelector(".source-file-button").click()`);
  await waitFor(() => cdp.evaluate(`document.getElementById("source-status").textContent.startsWith("加载成功") || document.getElementById("source-status").textContent.startsWith("已从缓存")`), "返回首个源码");
  await cdp.evaluate(`document.getElementById("copy-source").click()`);
  await waitFor(() => cdp.evaluate(`document.getElementById("source-status").textContent.startsWith("已复制")`), "复制源码");
  await cdp.evaluate(`document.getElementById("source-download").click()`);
  await waitFor(async () => (await stat(path.join(downloadDir, "i2c-rdwr-read.c"))).isFile(), "下载源码");

  // 此前已加载过全部源码；先刷新清空页面缓存，再注入一次性 404。
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(() => cdp.evaluate(`document.readyState === "complete" && location.hash === "#source" && document.getElementById("source-status").textContent.startsWith("加载成功")`), "404 前刷新并加载默认源码");
  await fetch(`${origin}/__test_fail_core_once`);
  const errorsBefore = cdp.consoleErrors.length;
  await cdp.evaluate(`Array.from(document.querySelectorAll(".source-file-button")).find(button => button.querySelector("code").textContent === "i2c-core-base.c").click()`);
  await waitFor(() => cdp.evaluate(`document.getElementById("source-status").textContent.startsWith("源码加载失败")`), "预期 404 错误提示");
  assert(await cdp.evaluate(`document.getElementById("source-code").textContent.includes("HTTP 404")`), "404 未显示可读错误");
  await cdp.evaluate(`Array.from(document.querySelectorAll(".source-file-button")).find(button => button.querySelector("code").textContent === "i2c-core-base.c").click()`);
  await waitFor(() => cdp.evaluate(`document.getElementById("source-status").textContent.startsWith("加载成功")`), "404 后恢复加载");
  assert(cdp.consoleErrors.length >= errorsBefore, "错误路径检查状态异常");

  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(() => cdp.evaluate(`document.readyState === "complete" && location.hash === "#source" && document.getElementById("view-source").classList.contains("is-active")`), "刷新后 hash 路由");
  await cdp.evaluate(`location.hash = "#mechanism"`);
  await waitFor(() => cdp.evaluate(`document.getElementById("view-mechanism").classList.contains("is-active")`), "机制 hash 路由");

  const layouts = [];
  for (const width of [375, 768, 1024, 1440]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height: 1000, deviceScaleFactor: 1, mobile: width === 375
    });
    const layout = await cdp.evaluate(`(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      nextVisible: !!document.getElementById("step-next").getBoundingClientRect().width,
      selectVisible: !!document.getElementById("scenario-mode").getBoundingClientRect().width
    }))()`);
    assert(layout.documentWidth <= width + 1 && layout.bodyWidth <= width + 1, `${width}px 出现页面级横向溢出：${JSON.stringify(layout)}`);
    assert(layout.nextVisible && layout.selectVisible, `${width}px 控件不可见`);
    layouts.push(`${width}px:无页面级横向溢出`);
  }

  assert(cdp.exceptions.length === 0, `浏览器 JavaScript 异常：${JSON.stringify(cdp.exceptions)}`);
  assert(cdp.consoleErrors.length === 0, `存在未预期 console.error：${cdp.consoleErrors.length}`);
  const localBadResponses = cdp.badResponses.filter((item) => item.url.startsWith(`${origin}/`));
  assert(localBadResponses.length === 1 && localBadResponses[0].status === 404, `除预期 404 外存在本地失败资源：${JSON.stringify(localBadResponses)}`);

  const report = {
    result: "PASS",
    browser: "Google Chrome headless（真实 Chromium DOM/CDP）",
    article: articleResult,
    mechanism: results,
    keyboard: "右方向键、上一步、复位通过",
    source: `${sourceNames.length} 个文件 HTTP 加载、复制、首个文件下载通过`,
    errorRecovery: "人为单次 404 显示可读错误，随后重新加载成功",
    hash: "#source 刷新保持，#mechanism 切换通过",
    layout: layouts,
    javascriptExceptions: cdp.exceptions.length,
    unexpectedConsoleErrors: 0,
    unexpectedResourceFailures: 0,
    intentionalFailures: "1 次 i2c-core-base.c HTTP 404",
    note: "这是 DOM 交互与布局检查，不包含人工视觉截图验收，也不验证硬件。"
  };
  await writeFile(path.join(here, "browser-test-result.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (chromeErrors.includes("FATAL")) throw new Error("Chrome 报告 FATAL");
}

try {
  await main();
} finally {
  if (socket) socket.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (browser && browser.exitCode === null) {
    browser.kill();
    await new Promise((resolve) => browser.once("exit", resolve));
  }
  await rm(tempRoot, { recursive: true, force: true });
}
