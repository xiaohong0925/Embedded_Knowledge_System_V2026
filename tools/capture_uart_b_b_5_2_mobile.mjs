import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'reviews', 'sections', 'B-B.5.2-browser', 'interactive-mobile-375.png');
const pages = await fetch('http://127.0.0.1:9222/json').then((response) => response.json());
const page = pages.find((entry) => entry.type === 'page');
if (!page) throw new Error('No Chrome page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  if (message.error) task.reject(new Error(JSON.stringify(message.error)));
  else task.resolve(message.result);
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 375,
  height: 812,
  deviceScaleFactor: 2,
  mobile: true,
});
await cdp('Page.navigate', {
  url: 'http://localhost:7100/b-bus-protocols/b-di-su-wai-she-jie-kou/images/b-b-5-2-uart-sampling.html',
});

for (let attempt = 0; attempt < 100; attempt += 1) {
  const result = await cdp('Runtime.evaluate', {
    expression: 'document.readyState',
    returnByValue: true,
  });
  if (result.result.value === 'complete') break;
  if (attempt === 99) throw new Error('Page load timeout');
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const metrics = await cdp('Runtime.evaluate', {
  expression: `JSON.stringify({width: innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight})`,
  returnByValue: true,
});
const screenshot = await cdp('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
});
fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
console.log(metrics.result.value);
console.log(`${output}: ${fs.statSync(output).size} bytes`);
ws.close();
