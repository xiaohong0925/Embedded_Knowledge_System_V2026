#!/usr/bin/env python3
"""Check B-B.4.4 current pages and real-task candidates."""

from __future__ import annotations

import re
import sys
from pathlib import Path

from check_static import ROOT, check_links, finding

DOC_DIR = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口"
CANDIDATE_DIR = ROOT / "evals" / "writing" / "runs" / "real-b-b-4-4"
PAGES = [
    "B-B.4.4_SPI调试与选型.md",
    "B-B.4.4_SPI调试与选型_selection.md",
]


def check_jedec(scope: str, path: Path, text: str) -> list[dict]:
    findings = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        match = re.search(r"(?<![\w])9F((?:\s+00)+)(?![\w])", line)
        if match and len(re.findall(r"(?<![\w])00(?![\w])", match.group(1))) != 3:
            findings.append(
                finding(scope, path, line_no, "jedec-command-length", "9F 命令序列应包含三个 00 时钟填充字节。")
            )
        if "EF 40 18" in line and "70 18" in line and "IQ/JQ" in line and "IM/JM" not in line:
            findings.append(
                finding(scope, path, line_no, "jedec-device-id", "IQ/JQ 与 IM/JM 的 Device ID 不应混用。")
            )
    return findings


def main() -> int:
    findings = []
    for page in PAGES:
        original = DOC_DIR / page
        candidate = CANDIDATE_DIR / page
        sources = [
            ("current", original, original),
            ("candidate", candidate, original),
        ]
        redesigned = ROOT / "evals" / "writing" / "runs" / "redesign-b-b-4-4" / page
        if redesigned.exists():
            sources.append(("redesign", redesigned, original))
        for scope, source, virtual in sources:
            text = source.read_text(encoding="utf-8")
            findings.extend(check_links(scope, source, virtual, text))
            findings.extend(check_jedec(scope, source, text))
    interactive = ROOT / "evals" / "writing" / "runs" / "redesign-b-b-4-4" / "spi-debug-path.html"
    if not interactive.is_file():
        findings.append(finding("redesign", interactive, 0, "interactive-asset", "交互故障路径图文件不存在。"))
    for item in findings:
        print(f"{item['scope']} | {item['path'].relative_to(ROOT)}:{item['line']} | {item['rule']} | {item['message']}")
    print(f"SUMMARY: {len(findings)} 个 4.4 静态检查发现。")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
