#!/usr/bin/env python3
"""校验章节验收记录的结构、证据路径与哈希；不判断教学质量。"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

STATUSES = {"pass", "fail", "stale", "not_applicable", "not_verified"}
READER_KEYS = ("dependency", "mainline", "blind_delete", "follow")
SCOPE_KEYS = ("outlines", "source_snapshots", "assets", "related_sections")
HASH_KEY_TO_FILE = {
    "article_sha256": "article",
    "agent_sha256": "agent.md",
    "plan_sha256": "plan.md",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_record(record_path: Path, root: Path) -> dict[str, Any]:
    root = root.resolve()
    record_path = record_path.resolve()
    result: dict[str, Any] = {
        "record": str(record_path),
        "record_state": "invalid",
        "errors": [],
        "stale_reasons": [],
        "checked_hashes": [],
    }
    errors: list[str] = result["errors"]
    stale: list[str] = result["stale_reasons"]

    try:
        record_path.relative_to(root)
    except ValueError:
        errors.append("验收记录必须位于项目根目录内")
        return result

    try:
        data = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        errors.append(f"无法读取 JSON：{exc}")
        return result

    if not isinstance(data, dict):
        errors.append("记录顶层必须是对象")
        return result

    for key in ("section", "article", "main_question"):
        if not isinstance(data.get(key), str) or not data.get(key, "").strip():
            errors.append(f"{key} 必须是非空字符串")

    resolved_files: dict[str, Path] = {}

    def local_file(value: Any, label: str) -> Path | None:
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{label} 必须是非空的项目相对路径")
            return None
        candidate = (root / value).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            errors.append(f"{label} 越出项目根目录：{value}")
            return None
        if not candidate.is_file():
            errors.append(f"{label} 不存在或不是文件：{value}")
            return None
        return candidate

    article_path = local_file(data.get("article"), "article")
    if article_path is not None:
        resolved_files["article"] = article_path

    baseline = data.get("baseline")
    if not isinstance(baseline, dict):
        errors.append("baseline 必须是对象")
        baseline = {}

    try:
        dt.date.fromisoformat(baseline.get("reviewed_at", ""))
    except (TypeError, ValueError):
        errors.append("baseline.reviewed_at 必须是 YYYY-MM-DD")

    for hash_key, file_key in HASH_KEY_TO_FILE.items():
        expected = baseline.get(hash_key)
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            errors.append(f"baseline.{hash_key} 必须是 64 位小写 SHA-256")
            continue
        path = resolved_files.get(file_key)
        if path is None:
            path = local_file(file_key, file_key)
            if path is not None:
                resolved_files[file_key] = path
        if path is not None:
            actual = sha256(path)
            result["checked_hashes"].append({"file": file_key, "sha256": actual})
            if actual != expected:
                stale.append(f"{file_key} 已在验收基线后变化")

    scope = data.get("scope")
    if not isinstance(scope, dict):
        errors.append("scope 必须是对象")
        scope = {}
    for key in SCOPE_KEYS:
        values = scope.get(key)
        if not isinstance(values, list):
            errors.append(f"scope.{key} 必须是数组")
            continue
        for index, value in enumerate(values):
            local_file(value, f"scope.{key}[{index}]")

    checks = data.get("reader_checks")
    if not isinstance(checks, dict):
        errors.append("reader_checks 必须是对象")
        checks = {}
    for key in READER_KEYS:
        item = checks.get(key)
        if not isinstance(item, dict):
            errors.append(f"reader_checks.{key} 必须是对象")
            continue
        if item.get("status") not in STATUSES:
            errors.append(f"reader_checks.{key}.status 非法")
        if not isinstance(item.get("evidence"), str):
            errors.append(f"reader_checks.{key}.evidence 必须是字符串")

    verification = data.get("verification")
    if not isinstance(verification, dict):
        errors.append("verification 必须是对象")
        verification = {}

    strict_build = verification.get("strict_build")
    if not isinstance(strict_build, dict):
        errors.append("verification.strict_build 必须是对象")
    else:
        if strict_build.get("status") not in STATUSES:
            errors.append("verification.strict_build.status 非法")
        for key in ("command", "result"):
            if not isinstance(strict_build.get(key), str):
                errors.append(f"verification.strict_build.{key} 必须是字符串")
        if strict_build.get("status") == "pass" and "mkdocs build --strict" not in strict_build.get("command", ""):
            errors.append("严格构建标为 pass 时，command 必须包含 mkdocs build --strict")

    browser = verification.get("browser")
    if not isinstance(browser, dict):
        errors.append("verification.browser 必须是对象")
    else:
        if browser.get("status") not in STATUSES:
            errors.append("verification.browser.status 非法")
        if not isinstance(browser.get("result"), str):
            errors.append("verification.browser.result 必须是字符串")

    teaching = verification.get("teaching_code")
    if not isinstance(teaching, dict):
        errors.append("verification.teaching_code 必须是对象")
    else:
        for key in ("compile", "run", "hardware"):
            if teaching.get(key) not in STATUSES:
                errors.append(f"verification.teaching_code.{key} 状态非法")
        if not isinstance(teaching.get("note"), str):
            errors.append("verification.teaching_code.note 必须是字符串")

    if not isinstance(data.get("open_issues"), list) or not all(
        isinstance(item, str) for item in data.get("open_issues", [])
    ):
        errors.append("open_issues 必须是字符串数组")
    if not isinstance(data.get("next_action"), str):
        errors.append("next_action 必须是字符串")

    if not errors:
        result["record_state"] = "stale" if stale else "current"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record", type=Path, help="reviews/sections/<节号>.json")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help=argparse.SUPPRESS)
    args = parser.parse_args()
    result = validate_record(args.record, args.root)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["record_state"] == "invalid":
        return 2
    if result["record_state"] == "stale":
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
