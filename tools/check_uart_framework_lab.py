from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口"
CODE = DOCS / "code" / "B-B.5.3"
HTML = DOCS / "html"
MANIFEST = json.loads((CODE / "fullcode.manifest.json").read_text(encoding="utf-8"))


def load_config():
    text = (HTML / "uart-framework-lab.js").read_text(encoding="utf-8")
    start = text.index("  const LAB_CONFIG = ") + len("  const LAB_CONFIG = ")
    end = text.index(";\n\n  const $ =", start)
    return json.loads(text[start:end])


def load_fullcode():
    text = (HTML / "uart-framework-lab-fullcode.js").read_text(encoding="utf-8")
    start = text.index("window.LAB_FULL_CODE = ") + len("window.LAB_FULL_CODE = ")
    end = text.rindex("};")
    return json.loads(text[start:end + 1])


config = load_config()
fullcode = load_fullcode()
steps = [step for group in config["scenarios"].values() for step in group]
assert len(steps) == 14

for step in steps:
    full = step["full"]
    key = full["key"]
    spec = MANIFEST["entries"][key]
    source = CODE / spec["source"]
    source_lines = source.read_text(encoding="utf-8").splitlines()
    snippet_lines = step["code"].splitlines()
    start = step["startLine"]
    actual = "\n".join(source_lines[start - 1:start - 1 + len(snippet_lines)])
    if actual != step["code"]:
        raise AssertionError(f"snippet mismatch: {step['label']}\nEXPECTED:\n{step['code']}\nACTUAL:\n{actual}")
    assert start <= step["line"] < start + len(snippet_lines), step["label"]

    asset = fullcode[key]
    assert asset["code"].count(full["needle"]) == 1, f"needle not unique: {key}"
    offset = asset["code"].index(full["needle"])
    highlight = asset["startLine"] + asset["code"][:offset].count("\n")
    assert highlight == step["line"], f"highlight mismatch: {step['label']} ({highlight} != {step['line']})"
    asset_lines = asset["code"].splitlines()
    source_start = asset["startLine"]
    expected = "\n".join(source_lines[source_start - 1:source_start - 1 + len(asset_lines)])
    assert expected == asset["code"], f"full code mismatch: {key}"

for source in config["sourceFiles"]:
    target = (HTML / source["url"]).resolve()
    assert target.is_file(), target

for name in (
    "uart-framework-lab.html",
    "uart-framework-lab.css",
    "uart-framework-lab.js",
    "uart-framework-lab-fullcode.js",
):
    assert (HTML / name).is_file(), name

from bs4 import BeautifulSoup
soup = BeautifulSoup((HTML / "uart-framework-lab.html").read_text(encoding="utf-8"), "html.parser")
scenario_values = {option.get("value") for option in soup.select("#scenario-mode option")}
assert scenario_values == set(config["scenarios"]), (scenario_values, set(config["scenarios"]))

article = DOCS / "B-B.5.3_UART Linux驱动框架与TTY路径.md"
assert (DOCS / "html" / "uart-framework-lab.html").is_file()
assert "../html/uart-framework-lab.html" in article.read_text(encoding="utf-8")
print(f"UART Framework Lab static checks: PASS ({len(steps)} steps, {len(config['sourceFiles'])} source files)")
print("All snippets match absolute source lines; full-code needles are unique and verbatim.")
