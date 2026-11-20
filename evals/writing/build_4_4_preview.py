#!/usr/bin/env python3
"""Build both redesigned B-B.4.4 pages for preview."""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

from mkdocs.commands.build import build
from mkdocs.config import load_config

ROOT = Path(__file__).resolve().parents[2]
CANDIDATES = ROOT / "evals" / "writing" / "runs" / "redesign-b-b-4-4"
PREVIEW_ROOT = ROOT / "evals" / "writing" / "preview"
SITE = PREVIEW_ROOT / "site"
TEMP_DOCS = ROOT / "docs" / "eval-preview"
ORIGINAL_DIR = "../B. 总线协议/B. 低速外设接口/"
LINK_RE = re.compile(r"(\[[^\]]*\]\()([^)]+)(\))")


def rewrite_links(text: str) -> str:
    def replace(match: re.Match) -> str:
        target = match.group(2).strip()
        if not target or target.startswith(("https://", "http://", "mailto:", "#")):
            return match.group(0)
        if target == "B-B.4.4_SPI调试与选型_selection.md":
            return f"{match.group(1)}selection.md{match.group(3)}"
        if target == "B-B.4.4_SPI调试与选型.md":
            return f"{match.group(1)}index.md{match.group(3)}"
        return f"{match.group(1)}{ORIGINAL_DIR}{target}{match.group(3)}"

    return LINK_RE.sub(replace, text)


def main() -> None:
    os.chdir(ROOT)
    if TEMP_DOCS.exists():
        raise RuntimeError(f"临时预览目录已存在，拒绝覆盖：{TEMP_DOCS}")

    TEMP_DOCS.mkdir()
    try:
        for source_name, target_name in (
            ("B-B.4.4_SPI调试与选型.md", "index.md"),
            ("B-B.4.4_SPI调试与选型_selection.md", "selection.md"),
        ):
            content = (CANDIDATES / source_name).read_text(encoding="utf-8")
            (TEMP_DOCS / target_name).write_text(rewrite_links(content), encoding="utf-8")
        shutil.copy2(CANDIDATES / "spi-debug-path.html", TEMP_DOCS / "spi-debug-path.html")

        config = load_config("mkdocs.yml")
        config["site_dir"] = str(SITE)
        config["strict"] = False
        config["nav"].append(
            {
                "【评测预览】B-B.4.4 重设计": [
                    {"第 1 页：正常基线与分层调试": "eval-preview/index.md"},
                    {"第 2 页：速率与接口选择": "eval-preview/selection.md"},
                ]
            }
        )
        build(config)
    finally:
        shutil.rmtree(TEMP_DOCS, ignore_errors=True)

    print(f"Preview site: {SITE}")
    print("Open /eval-preview/ after starting the preview server.")


if __name__ == "__main__":
    main()
