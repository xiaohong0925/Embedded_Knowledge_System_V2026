#!/usr/bin/env python3
"""Static checks for B-B.4.3 writing evaluations and current pages."""

from __future__ import annotations

import argparse
import re
import sys
from collections import OrderedDict
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
DOC_DIR = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口"
RUNS = ROOT / "evals" / "writing" / "runs"

PAGES = OrderedDict(
    (case_id, f"B-B.4.3_SPI Linux驱动框架{suffix}")
    for case_id, suffix in (
        ("C01", ".md"),
        ("C02", "_startup.md"),
        ("C03", "_message.md"),
        ("C04", "_execution.md"),
        ("C05", "_api.md"),
        ("C06", "_practice.md"),
    )
)

LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]+)\)(?:\{([^}]*)\})?")
NAV_RE = re.compile(r"^\s*-\s*(.+?):\s*(B\.\s*总线协议/.*B-B\.4\.3.*\.md)\s*$")
LIST_RE = re.compile(r"^\d+\.\s+\*\*(.+?)\*\*", re.MULTILINE)
H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
CODE_LINES_RE = re.compile(r"\bdata-code-lines=\"([^\"]+)\"")
RANGE_RE = re.compile(r"(\d+)(?:-(\d+))?")
HEX_X_RE = re.compile(r"(?<![\w])0x0b((?:\s+0x[0-9a-fA-F]{2})+)")
HEX_PLAIN_RE = re.compile(r"(?<![\w])0B((?:\s+[0-9A-F]{2})+)")


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def finding(scope: str, path: Path, line: int, rule: str, message: str) -> dict:
    return {
        "scope": scope,
        "path": path,
        "line": line,
        "rule": rule,
        "message": message,
    }


def check_links(scope: str, source_path: Path, virtual_path: Path, text: str) -> list[dict]:
    findings = []
    for match in LINK_RE.finditer(text):
        target = match.group(2).strip()
        attrs = match.group(3) or ""
        line = line_number(text, match.start())
        if not target or target.startswith(("https://", "http://", "mailto:", "#")):
            continue
        relative_target = unquote(target.split("#", 1)[0])
        if not relative_target:
            continue
        resolved = (virtual_path.parent / relative_target).resolve()
        if not resolved.is_file():
            findings.append(
                finding(scope, source_path, line, "link-target", f"链接目标不存在：{target}")
            )
            continue
        code_lines = CODE_LINES_RE.search(attrs)
        if code_lines:
            line_count = len(resolved.read_text(encoding="utf-8", errors="replace").splitlines())
            for range_text in code_lines.group(1).split(","):
                range_match = RANGE_RE.fullmatch(range_text.strip())
                if not range_match:
                    findings.append(
                        finding(scope, source_path, line, "source-range-format", f"无法解析行号区间：{range_text}")
                    )
                    continue
                start = int(range_match.group(1))
                end = int(range_match.group(2) or start)
                if start < 1 or end < start or end > line_count:
                    findings.append(
                        finding(
                            scope,
                            source_path,
                            line,
                            "source-range",
                            f"行号 {start}-{end} 超出或不符合目标文件 1-{line_count}：{target}",
                        )
                    )
    return findings


def check_instance(scope: str, source_path: Path, text: str) -> list[dict]:
    findings = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        for pattern in (HEX_X_RE, HEX_PLAIN_RE):
            match = pattern.search(line)
            if not match:
                continue
            payload = re.findall(r"0x([0-9a-fA-F]{2})" if pattern is HEX_X_RE else r"(?<![\w])([0-9A-F]{2})", match.group(1))
            total = len(payload) + 1
            mentions_five = bool(re.search(r"(?:5\s*字节|长度\s*[=为]?\s*5)", line))
            if mentions_five and total != 5:
                findings.append(
                    finding(
                        scope,
                        source_path,
                        line_no,
                        "instance-command-length",
                        f"前导声称为 5 字节，但命令序列实际列出 {total} 字节。",
                    )
                )
            if total == 5 and [item.lower() for item in payload] != ["00", "12", "34", "00"]:
                findings.append(
                    finding(
                        scope,
                        source_path,
                        line_no,
                        "instance-command-value",
                        "5 字节前导应为 0B 00 12 34 00。",
                    )
                )
        whole_transaction_success = bool(
            re.search(r"全部成功|完整成功|两段.*成功|整笔.*成功|整个 message.*成功", line)
            or ("成功时" in line and not re.search(r"第一段|第二段|当前段|本段", line))
        )
        if "actual_length" in line and whole_transaction_success:
            numbers = [int(value) for value in re.findall(r"(?<![\w\d])\d+(?![\w\d])", line)]
            if numbers and "9" not in line:
                findings.append(
                    finding(
                        scope,
                        source_path,
                        line_no,
                        "instance-actual-length",
                        "完整成功时 actual_length 应为 9。",
                    )
                )
    return findings


def check_current_navigation() -> list[dict]:
    findings = []
    mkdocs_path = ROOT / "mkdocs.yml"
    nav = {}
    for line in mkdocs_path.read_text(encoding="utf-8").splitlines():
        match = NAV_RE.match(line)
        if match:
            nav[Path(match.group(2)).name] = match.group(1).strip()

    main_name = PAGES["C01"]
    main_path = DOC_DIR / main_name
    main_text = main_path.read_text(encoding="utf-8")
    listed = LIST_RE.findall(main_text)
    if len(listed) != 6:
        findings.append(finding("current", main_path, 0, "nav-list-count", f"首页分页列表应有 6 项，实际为 {len(listed)}。"))
    else:
        for (case_id, page_name), listed_title in zip(PAGES.items(), listed):
            nav_title = nav.get(page_name)
            if nav_title and listed_title.strip() != nav_title:
                findings.append(
                    finding("current", main_path, 0, "nav-list-title", f"{case_id} 首页标题“{listed_title}”与导航“{nav_title}”不一致。")
                )

    for case_id, page_name in PAGES.items():
        path = DOC_DIR / page_name
        text = path.read_text(encoding="utf-8")
        nav_title = nav.get(page_name)
        if not nav_title:
            findings.append(finding("current", path, 0, "nav-missing", "mkdocs.yml 中未找到该页面。"))
            continue
        h1 = H1_RE.search(text)
        allowed_h1_titles = {nav_title}
        if page_name == PAGES["C05"]:
            # 人工确认：目录允许短标题，正文保留完整标题。
            allowed_h1_titles.add("手工 message 与便捷封装")
        if case_id != "C01" and h1 and h1.group(1).strip() not in allowed_h1_titles:
            findings.append(
                finding("current", path, line_number(text, h1.start()), "nav-h1-title", f"H1“{h1.group(1)}”与导航“{nav_title}”不一致。")
            )
        for match in LINK_RE.finditer(text):
            label, target = match.group(1), match.group(2)
            if not label.startswith(("上一页", "下一页", "开始阅读", "回到")):
                continue
            target_name = Path(target.split("#", 1)[0]).name
            target_nav = nav.get(target_name)
            if not target_nav:
                continue
            link_title = label.split("：", 1)[1] if "：" in label else label.replace("回到", "", 1).strip()
            if link_title.strip() != target_nav:
                findings.append(
                    finding("current", path, line_number(text, match.start()), "nav-link-title", f"链接“{label}”与目标导航“{target_nav}”不一致。")
                )
    return findings


def current_findings() -> list[dict]:
    findings = []
    for case_id, page_name in PAGES.items():
        path = DOC_DIR / page_name
        text = path.read_text(encoding="utf-8")
        findings.extend(check_links("current", path, path, text))
        findings.extend(check_instance("current", path, text))
    findings.extend(check_current_navigation())
    return findings


def candidate_findings() -> list[dict]:
    findings = []
    if not RUNS.exists():
        return findings
    for path in sorted(RUNS.rglob("*.md")):
        case_id = path.stem
        if case_id not in PAGES:
            continue
        virtual_path = DOC_DIR / PAGES[case_id]
        text = path.read_text(encoding="utf-8")
        scope = f"candidate:{path.parent.name}"
        findings.extend(check_links(scope, path, virtual_path, text))
        findings.extend(check_instance(scope, path, text))
    return findings


def self_test() -> int:
    known_bad = RUNS / "old-rules-a61e" / "C04.md"
    findings = check_instance("self-test", known_bad, known_bad.read_text(encoding="utf-8"))
    matched = [item for item in findings if item["rule"] == "instance-command-length"]
    if not matched:
        print("FAIL: 未识别旧 C04 的 5 字节前导长度错误。")
        return 1
    for item in matched:
        print(f"PASS: 已知错误已识别：{item['path'].name}:{item['line']}，{item['message']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", action="store_true", help="同时检查评测候选稿")
    parser.add_argument("--self-test", action="store_true", help="验证已知 C04 实例错误能够被发现")
    args = parser.parse_args()
    if args.self_test:
        return self_test()

    findings = current_findings()
    if args.candidates:
        findings.extend(candidate_findings())
    for item in findings:
        print(f"{item['scope']} | {item['path'].relative_to(ROOT)}:{item['line']} | {item['rule']} | {item['message']}")
    print(f"SUMMARY: {len(findings)} 个静态检查发现。")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
