// B-B.3.6 实验室真实浏览器验收。只用 Node 内置模块；结束关闭 HTTP 与 Chrome。
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "../../../..");
const labPath = "/B. 总线协议/B. 低速外设接口/html/pmbus-lab.html";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const tempRoot = path.join(here, ".browser-test-temp");
const profileDir = path.join(tempRoot, "profile");
let browser;
let server;
let socket;

const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".c", "text/plain; charset=utf-8"],
  [".dts", "text/plain; charset=utf-8"], [".md", "text/plain; charset=utf-8"],
  [".yaml", "text/plain; charset=utf-8"]
]);

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer(async (request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
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
    await new Promise((resolve) => setTimeout(resolve, 60));
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
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") this.consoleErrors.push(message.params);
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
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  const port = await startServer();
  const origin = `http://127.0.0.1:${port}`;
  const labUrl = `${origin}${encodeURI(labPath)}`;

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
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: labUrl });
  await waitFor(() => cdp.evaluate(`document.querySelector("#source-status")?.textContent.includes("完整文件")`), "六个源码文件加载");

  const expected = { raw: 9, native: 3, emulated: 4, race: 5, decode: 4, driver: 10, failure: 5 };
  const scenarioResults = {};
  for (const [scenario, count] of Object.entries(expected)) {
    await cdp.evaluate(`document.querySelector("#scenario-mode").value=${JSON.stringify(scenario)};document.querySelector("#scenario-mode").dispatchEvent(new Event("change",{bubbles:true}));`);
    for (let index = 0; index < count; index++) {
      const current = await cdp.evaluate(`({
        counter:document.querySelector("#step-counter").textContent,
        code:document.querySelector("#step-code").textContent,
        path:document.querySelector("#step-code-path").textContent,
        note:document.querySelector("#step-note").textContent,
        states:document.querySelectorAll("#state-grid dd").length
      })`);
      assert(current.counter === `${index + 1} / ${count}`, `${scenario} 步骤计数错误：${current.counter}`);
      assert(current.code.length > 30 && !current.code.includes("找不到源码") && !current.code.includes("源码尚未加载"), `${scenario} 第 ${index + 1} 步源码未加载`);
      assert(current.path.includes(":"), `${scenario} 第 ${index + 1} 步缺少行号`);
      assert(current.note.length > 20 && current.states >= 2, `${scenario} 第 ${index + 1} 步教学状态不完整`);
      if (index < count - 1) await cdp.evaluate(`document.querySelector("#step-next").click()`);
    }
    const finalText = await cdp.evaluate(`document.querySelector("#state-grid").textContent`);
    if (["raw", "decode", "driver"].includes(scenario)) assert(finalText.includes("1500"), `${scenario} 未得到 1500`);
    if (scenario === "failure") assert(finalText.includes("恢复错误"), "失败场景未保留恢复错误记录");
    scenarioResults[scenario] = { steps: count, finalText };
  }

  await cdp.evaluate(`document.querySelector("#scenario-mode").value="driver";document.querySelector("#scenario-mode").dispatchEvent(new Event("change",{bubbles:true}));document.querySelectorAll(".step-dot")[2].click();`);
  const snippetLength = await cdp.evaluate(`document.querySelector("#step-code").textContent.length`);
  await cdp.evaluate(`document.querySelector("#step-full-toggle").click()`);
  const fullLength = await cdp.evaluate(`document.querySelector("#step-code").textContent.length`);
  assert(fullLength > snippetLength, "完整定义视图没有展开代码");

  await cdp.evaluate(`document.querySelector('[data-view="source"]').click()`);
  const sourceResults = {};
  for (const key of ["demo", "dts", "makefile", "smbus", "tps", "core"]) {
    await cdp.evaluate(`document.querySelector('.source-file[data-file="${key}"]').click()`);
    const result = await cdp.evaluate(`({text:document.querySelector("#source-code").textContent,status:document.querySelector("#source-status").textContent,href:document.querySelector("#source-download").href})`);
    assert(result.text.length > 100 && result.status.includes("完整文件"), `${key} 完整源码加载失败`);
    assert(result.href.startsWith(origin), `${key} 下载链接不是本地 HTTP 资源`);
    sourceResults[key] = { characters: result.text.length, status: result.status };
  }

  await cdp.evaluate(`document.querySelector('[data-view="mechanism"]').click()`);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const layout = await cdp.evaluate(`({body:document.documentElement.scrollWidth,viewport:window.innerWidth,code:document.querySelector(".code-window").clientWidth})`);
  assert(layout.body <= layout.viewport, `移动布局出现页面级横向溢出：${JSON.stringify(layout)}`);
  assert(cdp.exceptions.length === 0, `浏览器异常：${JSON.stringify(cdp.exceptions)}`);
  assert(cdp.consoleErrors.length === 0, `控制台错误：${JSON.stringify(cdp.consoleErrors)}`);
  assert(cdp.badResponses.length === 0, `资源加载错误：${JSON.stringify(cdp.badResponses)}`);

  const result = {
    passed: true,
    lab: labPath,
    browser: "Headless Chrome via CDP",
    scenarios: scenarioResults,
    sources: sourceResults,
    mobileLayout: layout,
    runtimeExceptions: cdp.exceptions.length,
    consoleErrors: cdp.consoleErrors.length,
    failedResponses: cdp.badResponses.length,
    scope: "仅验证浏览器 DOM 交互、源码加载、场景状态与布局；不验证内核模块编译、真实总线、芯片或仪器。"
  };
  await writeFile(path.join(here, "browser-test-result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ passed: true, scenarios: Object.keys(expected).length, sources: Object.keys(sourceResults).length, mobileLayout: layout, chromeStderr: chromeErrors ? "present" : "empty" }, null, 2));
}

try {
  await main();
} finally {
  if (socket) socket.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}
