from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ARTICLE = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口" / "B-B.5.2_UART帧、采样与波特率.md"
OUT = ROOT / "reviews" / "sections" / "B-B.5.2-browser"
OUT.mkdir(parents=True, exist_ok=True)
text = ARTICLE.read_text(encoding="utf-8")
match = re.search(r"(<svg\b.*?</svg>)", text, flags=re.S)
if not match:
    raise SystemExit("inline SVG not found")
svg = match.group(1)
for name, background, foreground in [
    ("svg-light", "#ffffff", "#1f2937"),
    ("svg-dark", "#111827", "#f3f4f6"),
]:
    html = f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>B-B.5.2 SVG preview</title>
<style>html,body{{margin:0;background:{background};color:{foreground};font-family:sans-serif}}main{{width:900px;max-width:100%;margin:0 auto;padding:12px;box-sizing:border-box}}svg{{min-width:0!important}}</style>
<main>{svg}</main></html>"""
    (OUT / f"{name}.html").write_text(html, encoding="utf-8")
    print(OUT / f"{name}.html")
