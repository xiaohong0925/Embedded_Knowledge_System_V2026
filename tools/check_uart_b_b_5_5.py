from __future__ import annotations

import codecs
import functools
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECTION = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口"
ARTICLE = SECTION / "B-B.5.5_实战NEO-6M_GPS数据读取与NMEA解析.md"
CODE = SECTION / "code" / "B-B.5.5"

article = ARTICLE.read_text(encoding="utf-8")
parser = (CODE / "nmea_stream.c").read_text(encoding="utf-8")
tests = (CODE / "test_nmea_stream.c").read_text(encoding="utf-8")
mkdocs = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")
section_readme = (SECTION / "README.md").read_text(encoding="utf-8")
assert ARTICLE.name in mkdocs
assert ARTICLE.name in section_readme

required = [
    "neo6m_nmea.c",
    "nmea_stream.c",
    "nmea_stream.h",
    "test_nmea_stream.c",
    "Makefile",
]
for name in required:
    assert (CODE / name).is_file(), name
    assert f"code/B-B.5.5/{name}" in article, f"missing article link: {name}"

sample = (
    "$GPGGA,092725.00,4717.11399,N,00833.91590,E,1,8,1.01,"
    "499.6,M,48.0,M,,0*5B\\r\\n"
)
assert sample in article

fixture_names = [
    "valid",
    "valid_south_west",
    "ignored",
    "no_fix_empty",
    "no_fix_with_coordinates",
    "fix_with_empty_coordinates",
    "bad_checksum",
]
for name in fixture_names:
    match = re.search(
        rf"static const char {name}\[\]\s*=\s*(.*?);", tests, re.DOTALL
    )
    assert match, name
    parts = re.findall(r'"((?:\\.|[^"\\])*)"', match.group(1))
    value = codecs.decode("".join(parts), "unicode_escape")
    if name == "valid":
        assert value == codecs.decode(sample, "unicode_escape")
    assert value.endswith("\r\n"), name
    body, declared = value[1:-2].split("*")
    actual = functools.reduce(lambda a, b: a ^ b, body.encode("ascii"), 0)
    if name == "bad_checksum":
        assert declared != f"{actual:02X}", name
    else:
        assert declared == f"{actual:02X}", (name, declared, f"{actual:02X}")

for svg in re.findall(r"<svg\b.*?</svg>", article, re.DOTALL):
    root = ET.fromstring(svg)
    assert root.attrib.get("stroke") == "currentColor"
    assert "\n\n" not in svg
assert len(re.findall(r"<svg\b", article)) == 2


def function_source(signature: str) -> str:
    start = parser.index(signature)
    opening = parser.index("{", start)
    depth = 0
    for index in range(opening, len(parser)):
        if parser[index] == "{":
            depth += 1
        elif parser[index] == "}":
            depth -= 1
            if depth == 0:
                return parser[start : index + 1]
    raise AssertionError(f"unterminated function: {signature}")


assert function_source("void nmea_stream_feed(") in article
assert function_source("static size_t split_fields(") in article
main_test_list = tests.split("static int (*const tests[])(void) = {", 1)[1].split("};", 1)[0]
assert len(re.findall(r"\btest_[a-z_]+\b", main_test_list)) == 10
assert "PASS: 10 deterministic test groups" in article

print("PASS: B-B.5.5 resources, fixture checksums, SVG and source excerpts")
