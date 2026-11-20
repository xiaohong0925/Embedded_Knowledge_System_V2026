#!/usr/bin/env python3
"""Validate the writing-evaluation data against rubric and Git objects."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def load_json(name: str):
    with (HERE / name).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def git_object_exists(commit: str, path: str) -> bool:
    result = subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{path}"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def main() -> int:
    errors: list[str] = []
    suite = load_json("cases.json")
    rubric = load_json("rubric.json")

    base_commit = suite["base_commit"]
    reference_commit = suite["reference_commit"]
    cases = suite["cases"]
    dimension_ids = {item["id"] for item in rubric["dimensions"]}
    expected_case_ids = {f"C{number:02d}" for number in range(1, 7)}
    actual_case_ids = [case["case_id"] for case in cases]

    require(len(cases) == 6, "必须恰好包含 6 个用例", errors)
    require(set(actual_case_ids) == expected_case_ids, "用例编号必须为 C01～C06", errors)
    require(len(actual_case_ids) == len(set(actual_case_ids)), "用例编号不能重复", errors)
    require(len(dimension_ids) == len(rubric["dimensions"]), "评测维度编号不能重复", errors)

    for rule_path in suite["rule_set"]["paths"]:
        require(
            git_object_exists(suite["rule_set"]["commit"], rule_path),
            f"规则版本缺少文件：{rule_path}",
            errors,
        )

    checked_paths = 0
    for case in cases:
        case_id = case["case_id"]
        for side, commit in (("base", base_commit), ("reference", reference_commit)):
            path = case[side]["path"]
            require(
                git_object_exists(commit, path),
                f"{case_id} 的 {side} 文件不存在于 {commit}：{path}",
                errors,
            )
            checked_paths += 1

        require(
            case["reference"]["role"] == "human_preference_reference",
            f"{case_id} 的参考稿角色必须为 human_preference_reference",
            errors,
        )
        require(bool(case["task_instruction"].strip()), f"{case_id} 缺少任务说明", errors)
        require(bool(case["human_change_intent"]), f"{case_id} 缺少人工修改意图", errors)
        require(bool(case["evaluation_focus"]), f"{case_id} 缺少评测维度", errors)
        require(bool(case["required_preservation"]), f"{case_id} 缺少必须保留项", errors)
        require(bool(case["not_required"]), f"{case_id} 缺少非必要项", errors)

        unknown_dimensions = set(case["evaluation_focus"]) - dimension_ids
        require(
            not unknown_dimensions,
            f"{case_id} 引用了未定义维度：{sorted(unknown_dimensions)}",
            errors,
        )

        for path in case["input_context"]:
            require(
                git_object_exists(base_commit, path),
                f"{case_id} 的输入上下文不存在于基线提交：{path}",
                errors,
            )
            checked_paths += 1

    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1

    print(
        f"PASS: {len(cases)} 个用例、{len(dimension_ids)} 个阅读维度、"
        f"{len(rubric['hard_gates'])} 个硬性门槛；已核验 {checked_paths} 个 Git 文件引用。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
