(() => {
  "use strict";

  /* TEMPLATE: 复制后优先替换本配置。所有数据都只是教学模型，不连接硬件。 */
  const EXAMPLE_STRUCT = `struct example_request {
    int input;
    int output;
    int state;
};`;

  const EXAMPLE_CHECK = `static int example_execute(struct example_request *request)
{
    if (!request)
        return -1;`;

  const EXAMPLE_WRITE = `    request->state = 1;
    request->output = request->input * 2;
    request->state = 2;
    return 0;`;

  const EXAMPLE_RETURN = `    request->state = 1;
    request->output = request->input * 2;
    request->state = 2;
    return 0;
}`;

  const LAB_CONFIG = {
    title: "Framework Lab Template",
    kicker: "REUSABLE TEACHING TEMPLATE",
    subtitle: "让代码、状态和观察结果在同一步骤里出现。",
    transaction: ["input", "state", "output", "return"],
    modelBasis: "占位模型：请替换为已核验的机制依据",
    scenarios: {
      normal: [
        {
          label: "准备输入",
          path: "code/example.c · 占位教学代码",
          code: EXAMPLE_STRUCT,
          startLine: 6,
          line: 6,
          full: { key: "exampleFile", needle: "struct example_request {" },
          states: { "request.input": "21", "request.output": "未定义", "request.state": "0", "return": "尚未调用" },
          observations: ["输入属于调用者", "输出和状态尚未产生"],
          note: "先从一笔具体操作开始。这里只是占位值 21；实际章节应换成正文一直使用的贯穿实例。"
        },
        {
          label: "检查参数",
          path: "code/example.c · example_execute()",
          code: EXAMPLE_CHECK,
          startLine: 12,
          line: 14,
          full: { key: "exampleExecute", needle: "if (!request)" },
          states: { "request.input": "21", "request.output": "未定义", "request.state": "0", "return": "继续执行" },
          observations: ["request 非空，检查通过", "尚未修改 output"],
          note: "把判断条件和高亮行对应起来。不要只说“检查参数”，要说明检查对象、通过条件和失败去向。"
        },
        {
          label: "改变状态",
          path: "code/example.c · example_execute()",
          code: EXAMPLE_WRITE,
          startLine: 17,
          line: 19,
          full: { key: "exampleExecute", needle: "request->state = 2;" },
          states: { "request.input": "21", "request.output": "42", "request.state": "1 → 2", "return": "尚未返回" },
          observations: ["output = input × 2 = 42", "state 从 1 变为 2"],
          note: "代码、对象状态和可观察结果同步更新。实际章节可在这里拆出共享状态与调用者私有状态。"
        },
        {
          label: "返回结果",
          path: "code/example.c · example_execute()",
          code: EXAMPLE_RETURN,
          startLine: 17,
          line: 20,
          full: { key: "exampleExecute", needle: "return 0;" },
          states: { "request.input": "21", "request.output": "42", "request.state": "2", "return": "0", "returnTone": "good" },
          observations: ["返回值 0 表示本占位函数成功", "计算结果通过 request.output 返回"],
          note: "明确区分返回值和输出参数。实际章节必须按所引源码解释成功值、部分完成和负错误码。"
        }
      ],
      failure: [
        {
          label: "准备空指针",
          path: "code/example.c · 占位失败路径",
          code: EXAMPLE_CHECK,
          startLine: 12,
          line: 12,
          full: { key: "exampleExecute", needle: "static int example_execute" },
          states: { "request": "NULL", "request.output": "不可访问", "request.state": "不可访问", "return": "尚未调用" },
          observations: ["本次输入是无效指针", "没有可写的输出对象"],
          note: "失败路径必须仍从同一入口开始，说明它与正常路径共享哪些前置步骤。"
        },
        {
          label: "检查失败",
          path: "code/example.c · example_execute()",
          code: EXAMPLE_CHECK,
          startLine: 12,
          line: 14,
          full: { key: "exampleExecute", needle: "if (!request)" },
          states: { "request": "NULL", "request.output": "未修改", "request.state": "未修改", "return": "即将返回 -1", "returnTone": "error" },
          observations: ["!request 为真", "不执行后续状态写入"],
          note: "指出阻止继续执行的具体条件，避免只显示一个红色错误结果。"
        },
        {
          label: "返回错误",
          path: "code/example.c · example_execute()",
          code: EXAMPLE_CHECK,
          startLine: 12,
          line: 15,
          full: { key: "exampleExecute", needle: "return -1;" },
          states: { "request": "NULL", "request.output": "未修改", "request.state": "未修改", "return": "-1", "returnTone": "error" },
          observations: ["返回 -1", "output 和 state 保持未修改"],
          note: "错误路径也要交代清理、状态保留和调用者如何判断。-1 只是占位值，不是某内核 API 的约定。"
        }
      ]
    },
    sourceFiles: [
      {
        name: "example.c",
        kind: "占位源码",
        url: "./code/example.c",
        context: "仅用于演示同源文件加载。它不是驱动，不代表任何真实硬件接口，未编译或运行。"
      },
      {
        name: "lab.js",
        kind: "交互逻辑",
        url: "./lab.js",
        context: "模板自身脚本，用于演示第二个静态源文件的加载与切换。实际章节应替换为正文引用的完整源码。"
      }
    ]
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const pad = (value) => String(value).padStart(2, "0");
  const listen = (id, event, handler) => $(id).addEventListener(event, handler);

  function renderCode(element, source, currentLine = -1, startLine = 1) {
    element.replaceChildren();
    source.replace(/\n$/, "").split("\n").forEach((line, index) => {
      const absoluteLine = startLine + index;
      const row = document.createElement("span");
      row.className = "code-line";
      if (absoluteLine === currentLine) row.classList.add("is-current");

      const number = document.createElement("span");
      number.className = "line-no";
      number.textContent = String(absoluteLine);
      number.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "line-text";
      text.textContent = line || " ";
      row.append(number, text);
      element.appendChild(row);
    });

    const current = element.querySelector(".is-current");
    const windowElement = element.parentElement;
    if (current) {
      const top = current.offsetTop - windowElement.clientHeight / 2;
      windowElement.scrollTop = Math.max(0, top);
    } else {
      windowElement.scrollTop = 0;
    }
  }

  function makeFullView(step) {
    if (!step.full) return null;
    const { key, needle } = step.full;
    if (!key || !needle) throw new Error("步骤 full 必须同时提供 key 和 needle");
    const assets = window.LAB_FULL_CODE || {};
    const asset = assets[key];
    if (!asset) throw new Error(`完整代码 key 不存在：${key}`);
    if (typeof asset.code !== "string" || !Number.isInteger(asset.startLine) || asset.startLine < 1) {
      throw new Error(`完整代码 ${key} 必须包含 code 和从 1 开始的整数 startLine`);
    }
    const offset = asset.code.indexOf(needle);
    if (offset < 0) throw new Error(`完整代码 ${key} 中找不到 needle：${needle}`);
    if (offset !== asset.code.lastIndexOf(needle)) {
      throw new Error(`完整代码 ${key} 中 needle 不唯一：${needle}`);
    }
    const highlightLine = asset.startLine + asset.code.slice(0, offset).split("\n").length - 1;
    return {
      path: asset.path || key,
      code: asset.code,
      startLine: asset.startLine,
      highlightLine
    };
  }

  Object.values(LAB_CONFIG.scenarios).forEach((steps) => {
    steps.forEach((step) => {
      step.fullView = makeFullView(step);
    });
  });

  let scenario = "normal";
  let stepIndex = 0;
  let codeViewMode = "snippet";
  let updateStepStrip = () => {};

  function currentSteps() {
    return LAB_CONFIG.scenarios[scenario];
  }

  function makeStepStrip() {
    const container = $("step-strip");
    container.replaceChildren();
    currentSteps().forEach((step, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "step-chip";
      const number = document.createElement("span");
      number.textContent = pad(index + 1);
      button.append(number, document.createTextNode(step.label));
      button.addEventListener("click", () => {
        stepIndex = index;
        renderStep();
      });
      container.appendChild(button);
    });

    updateStepStrip = () => {
      $$(".step-chip", container).forEach((button, index) => {
        button.classList.toggle("is-active", index === stepIndex);
        button.classList.toggle("is-done", index < stepIndex);
        if (index === stepIndex) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
    };
  }

  function renderStates(states) {
    const grid = $("state-grid");
    grid.replaceChildren();
    Object.entries(states).forEach(([name, value]) => {
      if (name === "returnTone") return;
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = name;
      detail.textContent = value;
      if (name === "return" && states.returnTone) detail.classList.add(`is-${states.returnTone}`);
      wrapper.append(term, detail);
      grid.appendChild(wrapper);
    });
  }

  function renderCodeView() {
    const step = currentSteps()[stepIndex];
    const toggle = $("step-full-toggle");
    if (codeViewMode === "full" && !step.fullView) codeViewMode = "snippet";
    const showFull = codeViewMode === "full" && step.fullView;

    toggle.disabled = !step.fullView;
    toggle.textContent = showFull ? "步骤片段" : "完整函数";
    toggle.setAttribute("aria-pressed", String(Boolean(showFull)));
    toggle.title = step.fullView ? "在当前步骤片段与其完整来源之间切换" : "本步骤没有登记完整代码，已禁用切换";

    if (showFull) {
      $("step-code-path").textContent = `${step.fullView.path} · 起始行 ${step.fullView.startLine}`;
      renderCode($("step-code"), step.fullView.code, step.fullView.highlightLine, step.fullView.startLine);
    } else {
      $("step-code-path").textContent = `${step.path} · 步骤片段`;
      renderCode($("step-code"), step.code, step.line, step.startLine || 1);
    }
  }

  function renderStep() {
    const steps = currentSteps();
    const step = steps[stepIndex];
    $("step-counter").textContent = `${pad(stepIndex + 1)} / ${pad(steps.length)}`;
    $("step-note").textContent = step.note;
    renderCodeView();
    renderStates(step.states);

    const observations = $("step-observations");
    observations.replaceChildren();
    step.observations.forEach((observation) => {
      const item = document.createElement("li");
      item.textContent = observation;
      observations.appendChild(item);
    });

    $("step-prev").disabled = stepIndex === 0;
    $("step-next").disabled = stepIndex === steps.length - 1;
    updateStepStrip();
  }

  listen("step-full-toggle", "click", () => {
    codeViewMode = codeViewMode === "full" ? "snippet" : "full";
    renderCodeView();
  });
  listen("step-prev", "click", () => {
    stepIndex = Math.max(0, stepIndex - 1);
    renderStep();
  });
  listen("step-next", "click", () => {
    stepIndex = Math.min(currentSteps().length - 1, stepIndex + 1);
    renderStep();
  });
  listen("step-reset", "click", () => {
    stepIndex = 0;
    renderStep();
  });
  listen("scenario-mode", "change", (event) => {
    scenario = event.target.value;
    stepIndex = 0;
    makeStepStrip();
    renderStep();
  });

  const sourceCache = new Map();
  let selectedSource = LAB_CONFIG.sourceFiles[0].name;
  let sourceRequest = 0;

  function renderSourceButtons() {
    const nav = $("source-files");
    nav.replaceChildren();
    LAB_CONFIG.sourceFiles.forEach((file) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "source-file-button";
      button.classList.toggle("is-active", file.name === selectedSource);
      button.setAttribute("aria-pressed", String(file.name === selectedSource));
      const name = document.createElement("code");
      name.textContent = file.name;
      const detail = document.createElement("small");
      detail.textContent = file.kind;
      button.append(name, detail);
      button.addEventListener("click", () => loadSource(file.name));
      nav.appendChild(button);
    });
  }

  async function loadSource(name) {
    const file = LAB_CONFIG.sourceFiles.find((candidate) => candidate.name === name);
    if (!file) return;
    selectedSource = name;
    const request = ++sourceRequest;
    renderSourceButtons();
    $("source-path").textContent = file.url.replace(/^\.\//, "");
    $("source-context").textContent = file.context;
    $("source-download").href = file.url;
    $("source-download").setAttribute("download", file.name);
    $("copy-source").disabled = true;

    if (sourceCache.has(name)) {
      renderCode($("source-code"), sourceCache.get(name));
      $("source-status").textContent = `已从缓存读取 ${name} · 与首次加载内容相同`;
      $("copy-source").disabled = false;
      return;
    }

    $("source-code").textContent = "正在加载…";
    $("source-status").textContent = `请求 ${file.url}`;
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const content = await response.text();
      sourceCache.set(name, content);
      if (request !== sourceRequest) return;
      renderCode($("source-code"), content);
      $("source-status").textContent = `加载成功：${name} · 请按文件说明判断其验证状态`;
      $("copy-source").disabled = false;
    } catch (error) {
      if (request !== sourceRequest) return;
      $("source-code").textContent = `无法加载 ${name}\n${error.message}\n\n请通过 HTTP 打开本页面，或使用“下载文件”直接访问源文件。`;
      $("source-status").textContent = "源码加载失败：file:// 通常会阻止 fetch；请经 MkDocs、GitHub Pages 或其他 HTTP 服务访问。";
    }
  }

  listen("copy-source", "click", async () => {
    const content = sourceCache.get(selectedSource);
    if (!content) return;
    try {
      let copied = false;
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(content);
          copied = true;
        } catch {
          /* 页面未聚焦时剪贴板 API 可能被拒绝，继续尝试兼容路径。 */
        }
      }
      if (!copied) {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("浏览器拒绝复制");
      }
      $("source-status").textContent = `已复制 ${selectedSource}`;
    } catch (error) {
      $("source-status").textContent = `复制失败：${error.message}。可在代码区全选，或使用下载文件。`;
    }
  });

  const views = ["mechanism", "source"];
  let activeView = "mechanism";

  function switchView(view, updateHash = true) {
    if (!views.includes(view)) view = "mechanism";
    activeView = view;
    views.forEach((name) => {
      $(`view-${name}`).classList.toggle("is-active", name === view);
    });
    $$(".rail-item").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (updateHash && window.location.hash !== `#${view}`) {
      history.replaceState(null, "", `#${view}`);
    }
    if (view === "source" && !sourceCache.has(selectedSource)) loadSource(selectedSource);
    document.title = `${LAB_CONFIG.title} · ${view}`;
  }

  $$(".rail-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  window.addEventListener("hashchange", () => switchView(window.location.hash.slice(1), false));

  document.addEventListener("keydown", (event) => {
    if (activeView !== "mechanism" || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    stepIndex = Math.max(0, Math.min(currentSteps().length - 1, stepIndex + direction));
    renderStep();
    event.preventDefault();
  });

  $("lab-title").textContent = LAB_CONFIG.title;
  $("lab-kicker").textContent = LAB_CONFIG.kicker;
  $("lab-subtitle").textContent = LAB_CONFIG.subtitle;
  $("model-basis").textContent = LAB_CONFIG.modelBasis;
  const tag = $("transaction-tag");
  LAB_CONFIG.transaction.forEach((item, index) => {
    if (index > 0) {
      const arrow = document.createElement("b");
      arrow.textContent = "→";
      tag.appendChild(arrow);
    }
    const value = document.createElement("span");
    value.textContent = item;
    tag.appendChild(value);
  });

  makeStepStrip();
  renderStep();
  renderSourceButtons();
  $("copy-source").disabled = true;
  switchView(views.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "mechanism", false);
})();
