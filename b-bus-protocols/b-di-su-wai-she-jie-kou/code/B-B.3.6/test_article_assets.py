"""B-B.3.6 静态读者代理检查；不编译模块、不访问硬件。"""
from pathlib import Path
import hashlib
import json
import re

HERE = Path(__file__).resolve().parent
ARTICLE = HERE.parent.parent / "B-B.3.6_SMBus与PMBus.md"
HTML = HERE.parent.parent / "html" / "pmbus-lab.html"
JS = HERE.parent.parent / "html" / "pmbus-lab.js"
ROOT = HERE.parents[4]
text = ARTICLE.read_text(encoding="utf-8")
code = (HERE / "pmbus_vout_demo.c").read_text(encoding="utf-8")


def require(condition, message):
    if not condition:
        raise AssertionError(message)


# 主线：A 先于 B，B 先于 C；PAGE 与解码在第一次完整使用时解释。
a = text.index("三、路径 A")
b = text.index("四、路径 B")
c = text.index("六、路径 C")
require(a < b < c, "路径顺序不是 A → B → C")
require(text.index("### 一条 Word Data Read") < text.index("### 完整读取") < text.index("### `old_page`") < b, "PAGE 副本与共享状态的讲解顺序错误")
require(text.index("五位补码指数") < text.index("demo_decode_mv()"), "指数未在解码前解释")

# 依赖与关键术语：正文而非仅 Q&A 中应有定义。
for phrase in [
    "System Management Bus", "Power Management Bus", "Byte Data", "Word Data",
    "PAGE=2", "PAGE=3", "远程检测放大器", "LINEAR11", "LINEAR16",
    "pmbus_data", "pmbus_sensor", "currpage=-1", "update_lock", "sensor->data",
    "I2C_CLIENT_PEC", "不是上板实录", "预期形式，不是实测日志",
]:
    require(phrase in text, f"缺少就地解释或验证边界：{phrase}")

# 跟随：完整资产、分路径运行、恢复与错误路径均存在。
for name in ["pmbus_vout_demo.c", "rk3568-tps40422.dts", "Makefile", "SOURCES.md"]:
    require((HERE / name).is_file(), f"缺少跟随资产：{name}")
for command in ["mode=0", "mode=1", "/unbind", "/bind", "in2_label", "in2_input"]:
    require(command in text, f"缺少实操或观察入口：{command}")
require("demo_mode == DEMO_MODE_RAW" in code, "模块没有 raw 分支")
require("ret = demo_read_vout_smbus(client, &reading);" in code, "模块没有 SMBus 分支")
require("saved_flags = client->flags" in code and "client->flags = saved_flags" in code, "PEC 标志未保存恢复")
require(code.count("restore_ret = demo_select_page_") == 2, "两条路径没有都用写入＋读回恢复 PAGE")
require("if (ret == 0)\n\t\t\tret = restore_ret;" in code, "恢复失败未向成功读取传播")

# 本地链接全部有效。
links = re.findall(r"\]\((\./[^)]+)\)", text)
for link in links:
    target = link.split()[0]
    require((ARTICLE.parent / target).resolve().exists(), f"正文链接失效：{target}")
require(HTML.is_file() and JS.is_file(), "实验室文件缺失")

# 盲删：移除 fenced code、HTML 和实验室章节后，正文仍须独立回答核心问题。
prose = re.sub(r"```.*?```", "", text, flags=re.S)
prose = re.sub(r"<[^>]+>", "", prose)
prose = prose[:prose.index("八、交互实验室")] + prose[prose.index("九、怎样选择路径"):]
for phrase in [
    "00 03", "0x0300", "768 / 512 = 1.5 V", "1500",
    "old_page", "共享状态", "in2_input", "page=1", "READ_VOUT",
    "update_lock", "currpage", "负错误", "重复 START", "低字节",
]:
    require(phrase in prose, f"盲删后正文无法独立回答：{phrase}")

# 内核快照必须与已核验的工作区副本逐字节一致。
snapshot_pairs = {
    HERE / "linux-v6.6/drivers/i2c/i2c-core-smbus.c": ROOT / "help-docs/kernel-src-v6.6/drivers_i2c_i2c-core-smbus.c",
    HERE / "linux-v6.6/drivers/hwmon/pmbus/pmbus_core.c": ROOT / "help-docs/kernel-src-v6.6/drivers_hwmon_pmbus_pmbus_core.c",
    HERE / "linux-v6.6/drivers/hwmon/pmbus/tps40422.c": ROOT / "help-docs/kernel-src-v6.6/drivers_hwmon_pmbus_tps40422.c",
}
for copied, original in snapshot_pairs.items():
    require(hashlib.sha256(copied.read_bytes()).digest() == hashlib.sha256(original.read_bytes()).digest(), f"源码快照不一致：{copied}")

browser = json.loads((HERE / "browser-test-result.json").read_text(encoding="utf-8"))
require(browser["passed"] is True, "浏览器验收未通过")
require(len(browser["scenarios"]) == 7 and len(browser["sources"]) == 6, "浏览器覆盖不完整")
require(browser["runtimeExceptions"] == browser["consoleErrors"] == browser["failedResponses"] == 0, "浏览器仍有错误")

questions = re.findall(r'^\?\?\? details "Q(\d+)\.', text, flags=re.M)
require(questions == [str(i) for i in range(1, 9)], "Q&A 编号或覆盖不完整")

print(json.dumps({
    "passed": True,
    "checks": ["dependency", "mainline", "blind-delete", "follow"],
    "article_lines": len(text.splitlines()),
    "local_links": len(links),
    "qa": len(questions),
    "kernel_snapshots": len(snapshot_pairs),
    "browser_scenarios": len(browser["scenarios"]),
    "scope": "静态文档、源码与浏览器模型检查；未编译模块、未运行模块、未上板。",
}, ensure_ascii=False, indent=2))
