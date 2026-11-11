const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const chapter = path.join(root, "docs", "B. 总线协议", "B. 低速外设接口");
const htmlDir = path.join(chapter, "html");
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(htmlDir, "spi-framework-fullcode.js"), "utf8"), context);
const script = fs.readFileSync(path.join(htmlDir, "spi-framework-lab.js"), "utf8");
const configEnd = script.indexOf("  const $ =");
if (configEnd < 0) throw new Error("找不到 LAB_CONFIG 结束位置");
vm.runInContext(`${script.slice(0, configEnd)}\nglobalThis.__config = LAB_CONFIG;\n})();`, context);
const config = context.__config;
const fullCode = context.window.SPI_FULL_CODE;
const errors = [];
let stepCount = 0;
let fullViewCount = 0;

function check(condition, message) {
  if (!condition) errors.push(message);
}

function sourceForDisplay(displayPath) {
  if (displayPath === "drivers/spi/spi.c") {
    return path.join(root, "help-docs", "kernel-src-v6.6", "drivers_spi_spi.c");
  }
  if (displayPath === "drivers/spi/spi-rockchip.c") {
    return path.join(root, "help-docs", "kernel-src-v6.6", "drivers_spi_spi-rockchip.c");
  }
  if (displayPath.startsWith("code/B-B.4.3/")) return path.join(chapter, displayPath);
  throw new Error(`未知源码路径：${displayPath}`);
}

for (const [scenario, steps] of Object.entries(config.scenarios)) {
  check(steps.length > 0, `${scenario} 没有步骤`);
  for (const [index, step] of steps.entries()) {
    stepCount += 1;
    const id = `${scenario}[${index + 1}] ${step.label}`;
    const sourcePath = sourceForDisplay(step.path.split(" · ")[0]);
    const source = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
    const sourceLines = source.split("\n");
    const snippetLines = step.code.split("\n");
    check(Number.isInteger(step.startLine) && step.startLine >= 1, `${id}: startLine 非法`);
    check(Number.isInteger(step.line) && step.line >= step.startLine && step.line < step.startLine + snippetLines.length,
      `${id}: 高亮行 ${step.line} 不在片段 ${step.startLine}～${step.startLine + snippetLines.length - 1}`);
    const verbatim = sourceLines.slice(step.startLine - 1, step.startLine - 1 + snippetLines.length).join("\n");
    check(verbatim === step.code, `${id}: 步骤片段与 ${path.relative(root, sourcePath)}:${step.startLine} 不一致\nEXPECTED ${JSON.stringify(step.code)}\nACTUAL   ${JSON.stringify(verbatim)}`);
    check(step.note && step.observations.length > 0 && Object.keys(step.states).length > 0,
      `${id}: 缺少状态、观察或解释`);
    if (step.full) {
      fullViewCount += 1;
      const asset = fullCode[step.full.key];
      check(asset, `${id}: 完整代码 key 不存在 ${step.full.key}`);
      if (!asset) continue;
      const offset = asset.code.indexOf(step.full.needle);
      check(offset >= 0, `${id}: 完整代码找不到 needle ${step.full.needle}`);
      check(offset === asset.code.lastIndexOf(step.full.needle), `${id}: needle 不唯一 ${step.full.needle}`);
      if (offset >= 0) {
        const highlight = asset.startLine + asset.code.slice(0, offset).split("\n").length - 1;
        check(highlight === step.line, `${id}: 完整代码高亮 ${highlight} 与步骤行 ${step.line} 不一致`);
      }
    }
  }
}

for (const [key, asset] of Object.entries(fullCode)) {
  const displayPath = asset.path.includes("drivers/spi/spi-rockchip.c")
    ? "drivers/spi/spi-rockchip.c"
    : asset.path.includes("drivers/spi/spi.c")
      ? "drivers/spi/spi.c"
      : "code/B-B.4.3/spi_frame_observer.c";
  const sourcePath = sourceForDisplay(displayPath);
  const source = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
  const offset = source.indexOf(asset.code);
  check(offset >= 0, `${key}: 生成代码不是源文件的逐字连续区间`);
  if (offset >= 0) {
    const actualStart = source.slice(0, offset).split("\n").length;
    check(actualStart === asset.startLine, `${key}: startLine=${asset.startLine}，实际为 ${actualStart}`);
  }
}

for (const file of config.sourceFiles) {
  const filePath = path.resolve(htmlDir, file.url);
  check(fs.existsSync(filePath), `源码工作台文件不存在：${file.url}`);
  check(file.context.includes("未"), `${file.name}: 未明确验证边界`);
}

const html = fs.readFileSync(path.join(htmlDir, "spi-framework-lab.html"), "utf8");
check(html.includes('src="spi-framework-fullcode.js"') && html.includes('src="spi-framework-lab.js"'),
  "HTML 未按顺序加载本章完整代码与交互脚本");
check(!html.includes("占位"), "HTML 仍含模板占位内容");
check(!script.includes("EXAMPLE_") && !script.includes("占位："), "JS 仍含模板占位内容");
const article = fs.readFileSync(path.join(chapter, "B-B.4.3_SPI Linux驱动框架.md"), "utf8");
check(article.includes('src="../html/spi-framework-lab.html"'), "正文 iframe 路径缺失");
check(article.includes('[在新窗口打开 SPI Framework Lab](./html/spi-framework-lab.html){: target="_blank" rel="noopener noreferrer" }'),
  "正文新标签链接或安全属性缺失");
check(article.includes('## <span class="blue"> 本节自查'), "Q&A 二级标题未统一");

if (errors.length) {
  console.error(errors.map((error) => `FAIL ${error}`).join("\n"));
  process.exit(1);
}
console.log(`PASS ${stepCount} 个场景步骤：片段原文与绝对行号一致`);
console.log(`PASS ${fullViewCount} 个完整代码切换：key、needle 唯一性与高亮行一致`);
console.log(`PASS ${Object.keys(fullCode).length} 份生成代码：逐字连续区间与起始行一致`);
console.log(`PASS ${config.sourceFiles.length} 份源码工作台文件、正文 iframe、新标签链接与 Q&A 标题`);
