/* 显式标记的源码链接：弹窗阅读、复制、下载；无 JS 时仍打开原文件。 */
(function () {
  "use strict";

  const SELECTOR = "a[data-code-viewer]";
  const cache = new Map();
  let dialog;
  let activeRequest = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createDialog() {
    const root = element("dialog", "code-viewer");
    root.setAttribute("aria-labelledby", "code-viewer-title");
    root.innerHTML = `
      <section class="code-viewer__panel">
        <header class="code-viewer__header">
          <div class="code-viewer__badge" aria-hidden="true">&lt;/&gt;</div>
          <div class="code-viewer__heading">
            <h2 id="code-viewer-title">源码查看</h2>
            <p class="code-viewer__path"></p>
          </div>
          <button class="code-viewer__icon-button" type="button" data-code-close aria-label="关闭源码查看器" title="关闭（Esc）">×</button>
        </header>
        <div class="code-viewer__toolbar">
          <span class="code-viewer__status" role="status" aria-live="polite"></span>
          <div class="code-viewer__actions">
            <button type="button" data-code-copy disabled>复制源码</button>
            <a href="#" data-code-download download>下载文件</a>
          </div>
        </div>
        <pre class="code-viewer__code" tabindex="0" aria-label="文件内容"><code></code></pre>
        <footer class="code-viewer__footer">
          <span>Esc 关闭 · 可复制或下载完整文件</span>
          <a href="#" target="_blank" rel="noopener noreferrer" data-code-raw>打开原文件</a>
        </footer>
      </section>`;

    root.querySelector("[data-code-close]").addEventListener("click", () => root.close());
    root.querySelector("[data-code-copy]").addEventListener("click", copySource);
    root.addEventListener("click", (event) => {
      if (event.target === root) root.close();
    });
    document.body.appendChild(root);
    return root;
  }

  function parseRanges(value, lineCount) {
    const ranges = [];
    (value || "").split(",").forEach((part) => {
      const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
      if (!match) return;
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (start < 1 || end < start) return;
      ranges.push([start, Math.min(end, lineCount)]);
    });
    return ranges;
  }

  function renderSource(text, rangeValue) {
    const code = dialog.querySelector("code");
    const pre = dialog.querySelector(".code-viewer__code");
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const ranges = parseRanges(rangeValue, lines.length);
    const fragment = document.createDocumentFragment();

    lines.forEach((line, index) => {
      const number = index + 1;
      const row = element("span", "code-viewer__line");
      row.dataset.line = String(number);
      if (ranges.some(([start, end]) => number >= start && number <= end)) {
        row.classList.add("is-highlighted");
      }
      const gutter = element("span", "code-viewer__line-number", String(number));
      gutter.setAttribute("aria-hidden", "true");
      row.append(gutter, element("span", "code-viewer__line-text", line || " "));
      fragment.appendChild(row);
    });

    code.replaceChildren(fragment);
    pre.scrollTop = 0;
    pre.scrollLeft = 0;
    if (ranges.length) {
      requestAnimationFrame(() => {
        const primary = code.querySelector(`[data-line="${ranges[0][0]}"]`);
        if (primary) pre.scrollTop = Math.max(0, primary.offsetTop - pre.clientHeight * 0.3);
      });
    }
    return lines.length;
  }

  async function copySource() {
    const copyButton = dialog.querySelector("[data-code-copy]");
    const status = dialog.querySelector(".code-viewer__status");
    const text = copyButton.dataset.source || "";
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = element("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("copy failed");
      }
      status.textContent = "已复制完整源码";
      copyButton.textContent = "已复制";
      setTimeout(() => { copyButton.textContent = "复制源码"; }, 1400);
    } catch {
      status.textContent = "复制失败，请在代码区全选后复制";
      dialog.querySelector(".code-viewer__code").focus();
    }
  }

  async function openViewer(link) {
    if (!dialog) dialog = createDialog();
    const request = ++activeRequest;
    const url = new URL(link.href, window.location.href);
    const fileName = link.dataset.codeTitle || decodeURIComponent(url.pathname.split("/").pop());
    const title = dialog.querySelector("#code-viewer-title");
    const path = dialog.querySelector(".code-viewer__path");
    const status = dialog.querySelector(".code-viewer__status");
    const copyButton = dialog.querySelector("[data-code-copy]");
    const download = dialog.querySelector("[data-code-download]");
    const raw = dialog.querySelector("[data-code-raw]");

    title.textContent = fileName;
    path.textContent = link.dataset.codePath || url.pathname;
    path.title = path.textContent;
    status.textContent = "正在载入源码…";
    copyButton.disabled = true;
    copyButton.dataset.source = "";
    download.href = url.href;
    download.setAttribute("download", fileName.split("/").pop());
    raw.href = url.href;
    dialog.querySelector("code").replaceChildren();
    if (!dialog.open) dialog.showModal();

    try {
      if (!cache.has(url.href)) {
        cache.set(url.href, fetch(url.href).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        }));
      }
      const text = await cache.get(url.href);
      if (request !== activeRequest || !dialog.open) return;
      const lineCount = renderSource(text, link.dataset.codeLines);
      copyButton.dataset.source = text;
      copyButton.disabled = false;
      status.textContent = `${lineCount} 行${link.dataset.codeLines ? ` · 已标出 ${link.dataset.codeLines} 行` : ""}`;
    } catch (error) {
      cache.delete(url.href);
      if (request !== activeRequest || !dialog.open) return;
      const message = `源码载入失败（${error.message}）。可打开原文件或稍后重试。`;
      status.textContent = message;
      const code = dialog.querySelector("code");
      code.replaceChildren(element("p", "code-viewer__error", message));
    }
  }

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest(SELECTOR);
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    event.stopPropagation();
    openViewer(link);
  }, true);
})();
