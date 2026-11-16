#!/usr/bin/env python3
"""Static consistency checks for B-B.5.6; not a C compiler or hardware test."""

from pathlib import Path
import difflib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SECTION = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口"
ARTICLE = SECTION / "B-B.5.6_RS-485电气机制与Linux配置.md"
CODE = SECTION / "code" / "B-B.5.6" / "rs485_xfer.c"
MAKEFILE = SECTION / "code" / "B-B.5.6" / "Makefile"
KERNEL = ROOT / "help-docs" / "kernel-src-v6.6"

errors = []


def require(condition, message):
    if not condition:
        errors.append(message)


def read(path):
    require(path.is_file(), f"missing file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8") if path.is_file() else ""


article = read(ARTICLE)
code = read(CODE)
makefile = read(MAKEFILE)
mkdocs = read(ROOT / "mkdocs.yml")
readme = read(SECTION / "README.md")

for text, label in ((article, "article"), (code, "C source")):
    require("55 00 FF 3C" in article if label == "article" else
            "{0x55, 0x00, 0xff, 0x3c}" in text,
            f"request fixture mismatch in {label}")
    require("C3 7E" in article if label == "article" else
            "{0xc3, 0x7e}" in text,
            f"response fixture mismatch in {label}")

require(mkdocs.count("B-B.5.6_RS-485电气机制与Linux配置.md") == 1,
        "mkdocs navigation must contain B-B.5.6 exactly once")
require(readme.count("B-B.5.6_RS-485电气机制与Linux配置.md") == 1,
        "section README must link B-B.5.6 exactly once")
require("B.5.3 的差分" not in readme and "B.5.3 RS-485" not in readme,
        "stale README RS-485 pointers remain")

for resource in ("rs485_xfer.c", "Makefile"):
    require(f"code/B-B.5.6/{resource}" in article,
            f"article does not link {resource}")

svgs = re.findall(r"<svg\b.*?</svg>", article, flags=re.DOTALL)
require(len(svgs) == 3, f"expected 3 inline SVGs, found {len(svgs)}")
for index, svg in enumerate(svgs, 1):
    try:
        ET.fromstring(svg)
    except ET.ParseError as exc:
        errors.append(f"SVG {index} XML parse failed: {exc}")
    require("\n\n" not in svg, f"SVG {index} contains a blank line")
    require('stroke="currentColor"' in svg, f"SVG {index} lacks theme stroke")
    require("viewBox=" in svg, f"SVG {index} lacks viewBox")

excerpt_match = re.search(
    r"```c\n(/\* code/B-B\.5\.6/rs485_xfer\.c，配置片段 \*/\n.*?)```",
    article,
    flags=re.DOTALL,
)
require(excerpt_match is not None, "article RS-485 C excerpt not found")
if excerpt_match:
    excerpt_body = excerpt_match.group(1).split("\n", 1)[1]
    if excerpt_body not in code:
        start = code.find("make_rs485_request(&options, &wanted_rs485);")
        actual = code[start:start + len(excerpt_body)] if start >= 0 else ""
        for line in difflib.unified_diff(excerpt_body.splitlines(),
                                         actual.splitlines(),
                                         fromfile="article", tofile="source",
                                         lineterm=""):
            print(line)
        errors.append("article RS-485 C excerpt differs from the complete source")

for token in (
    "wanted_rs485",
    "requested_rs485 = wanted_rs485",
    "rs485_matches_request(&actual_rs485, &wanted_rs485)",
    "restore_rs485 = saved_rs485",
    "tcsetattr(fd, TCSANOW, &saved_termios)",
    "tcdrain(fd)",
):
    require(token in code, f"complete C source lacks required path: {token}")

require("\n\t$(CC) " in makefile and "\n\trm -f rs485_xfer" in makefile,
        "Makefile recipe indentation or clean target is incorrect")

for forbidden in ("排障速查", "方案对比（Trade-off）", "## 下一步"):
    require(forbidden not in article, f"forbidden template section: {forbidden}")
require(article.count("??? details \"Q") == 9,
        "expected nine expandable Q&A checks")
require("不是当前板卡的运行记录" in article and "未实际执行" in article,
        "teaching output and unexecuted verification must be explicit")

serial_h = read(KERNEL / "include_uapi_linux_serial.h")
rs485_yaml = read(KERNEL / "Documentation_devicetree_bindings_serial_rs485.yaml")
serial_core = read(KERNEL / "drivers_tty_serial_serial_core.c")
dw = read(KERNEL / "drivers_tty_serial_8250_8250_dw.c")
core_8250 = read(KERNEL / "drivers_tty_serial_8250_8250_core.c")

for token in ("SER_RS485_ENABLED", "SER_RS485_RTS_ON_SEND",
              "SER_RS485_RTS_AFTER_SEND", "SER_RS485_RX_DURING_TX",
              "SER_RS485_TERMINATE_BUS"):
    require(token in serial_h, f"UAPI lacks {token}")
for token in ("rs485-rts-delay", "rs485-rts-active-low",
              "linux,rs485-enabled-at-boot-time", "rs485-rx-during-tx",
              "rs485-term-gpios", "rs485-rx-during-tx-gpios"):
    require(token in rs485_yaml, f"DT binding lacks {token}")
require("if (!port->rs485_config)" in serial_core and
        "return -ENOTTY;" in serial_core,
        "serial core missing-callback evidence changed")
require("rs485_config" not in dw and "rs485_supported" not in dw,
        "8250_dw RS-485 capability evidence changed; recheck the article")
require("uart->port.rs485_config\t= up->port.rs485_config;" in core_8250,
        "8250 registration callback-copy evidence changed")

if errors:
    for error in errors:
        print(f"FAIL: {error}")
    sys.exit(1)
print("PASS: B-B.5.6 resources, fixtures, SVG, source excerpt and kernel evidence")
