#!/usr/bin/env python3
"""Extract verbatim C functions or whole files into a Framework Lab JS asset.

Usage:
    python extract_fullcode.py fullcode.manifest.json

The extractor is intentionally small and dependency-free. It supports ordinary
C definitions whose return type and function name begin at column zero. Always
inspect the generated first/last lines before using a new source family.
"""

import argparse
import json
import re
from pathlib import Path


def extract_function(text, name):
    match = re.search(
        r"(?m)^[A-Za-z_][^\n;]*\b" + re.escape(name) + r"\s*\(", text
    )
    if not match:
        raise RuntimeError(f"Definition not found: {name}")

    start = match.start()
    line_end = text.find("\n", start)
    if line_end < 0:
        line_end = len(text)
    signature_line = text[start:line_end]
    name_column = signature_line.find(name)
    if name_column >= 0 and not signature_line[:name_column].strip(" *\t"):
        previous_end = start - 1
        if previous_end > 0:
            previous_start = text.rfind("\n", 0, previous_end) + 1
            previous = text[previous_start:previous_end]
            if (
                previous.strip()
                and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_\s*]*", previous)
                and not previous.rstrip().endswith((";", "{", "}"))
            ):
                start = previous_start

    brace = text.find("{", match.end())
    semicolon = text.find(";", match.end())
    if brace < 0 or (0 <= semicolon < brace):
        raise RuntimeError(f"Function body not found: {name}")

    depth = 0
    state = "code"
    index = brace
    while index < len(text):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if state == "code":
            if char == '"':
                state = "string"
            elif char == "'":
                state = "char"
            elif char == "/" and following == "*":
                state = "block_comment"
                index += 1
            elif char == "/" and following == "/":
                state = "line_comment"
                index += 1
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    return {
                        "code": text[start:end],
                        "startLine": text.count("\n", 0, start) + 1,
                        "startOffset": start,
                        "endOffset": end,
                    }
        elif state == "string":
            if char == "\\":
                index += 1
            elif char == '"':
                state = "code"
        elif state == "char":
            if char == "\\":
                index += 1
            elif char == "'":
                state = "code"
        elif state == "block_comment":
            if char == "*" and following == "/":
                state = "code"
                index += 1
        elif state == "line_comment" and char == "\n":
            state = "code"
        index += 1
    raise RuntimeError(f"Closing brace not found: {name}")


def build_entry(manifest_dir, key, spec):
    if "source" not in spec or "displayPath" not in spec:
        raise RuntimeError(f"{key}: source and displayPath are required")
    source_path = (manifest_dir / spec["source"]).resolve()
    text = source_path.read_text(encoding="utf-8")
    origin = spec.get("origin", "已核验源码")
    whole_file = spec.get("wholeFile", False)
    functions = spec.get("functions", [])
    if "function" in spec:
        functions = [spec["function"]]
    if whole_file and functions:
        raise RuntimeError(f"{key}: wholeFile cannot be combined with function(s)")
    if not whole_file and not functions:
        raise RuntimeError(f"{key}: specify wholeFile or function(s)")

    if whole_file:
        code = text.rstrip("\n")
        start_line = 1
        suffix = ""
    else:
        extracted = [extract_function(text, name) for name in functions]
        if any(item["startOffset"] < extracted[0]["startOffset"] for item in extracted[1:]):
            raise RuntimeError(f"{key}: functions must follow source order")
        start = extracted[0]["startOffset"]
        end = extracted[-1]["endOffset"]
        if any(
            later["startOffset"] < earlier["endOffset"]
            for earlier, later in zip(extracted, extracted[1:])
        ):
            raise RuntimeError(f"{key}: function ranges overlap")
        code = text[start:end]
        start_line = extracted[0]["startLine"]
        suffix = " · " + " + ".join(f"{name}()" for name in functions)

    return {
        "path": f"{origin} · {spec['displayPath']}{suffix}",
        "startLine": start_line,
        "code": code,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    manifest_dir = manifest_path.parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    global_name = manifest.get("globalName", "LAB_FULL_CODE")
    if not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", global_name):
        raise RuntimeError("globalName must be a valid JavaScript identifier")

    entries = manifest.get("entries", {})
    if not entries:
        raise RuntimeError("entries must not be empty")
    result = {
        key: build_entry(manifest_dir, key, spec)
        for key, spec in entries.items()
    }
    header = (
        "/* Generated by extract_fullcode.py. Do not hand-edit code excerpts.\n"
        " * Reading aid only; generation does not compile or run the source. */\n"
    )
    output_path = manifest_dir / manifest.get("output", "fullcode.js")
    output_path.write_text(
        header
        + f"window.{global_name} = "
        + json.dumps(result, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    for key, item in result.items():
        print(
            f"{key}: {item['path']} : {item['startLine']} "
            f"({len(item['code'].splitlines())} lines)"
        )
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
