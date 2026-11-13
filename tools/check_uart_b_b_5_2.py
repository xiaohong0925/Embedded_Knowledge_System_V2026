from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
ARTICLE = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口" / "B-B.5.2_UART帧、采样与波特率.md"
INTERACTIVE = ARTICLE.parent / "images" / "b-b-5-2-uart-sampling.html"

text = ARTICLE.read_text(encoding="utf-8")
html = INTERACTIVE.read_text(encoding="utf-8")

bits = [(0x24 >> index) & 1 for index in range(8)]
assert bits == [0, 0, 1, 0, 0, 1, 0, 0]
assert int(f"{0x24:08b}"[::-1], 2) == 0x24

expected_positions = {0: 9.500, 1: 9.406, -1: 9.596, 6: 8.962, -6: 10.106}
for percent, expected in expected_positions.items():
    actual = 9.5 / (1 + percent / 100)
    assert round(actual, 3) == expected, (percent, actual, expected)

assert round((153000 / 16 - 9600) / 9600 * 100, 4) == -0.3906
assert round(64 * 10 / 9600 * 1000, 2) == 66.67
assert "0x24` 是一个特殊的对称位图案" in text
assert "B-B.5.2_UART Linux驱动与调试" not in (ROOT / "mkdocs.yml").read_text(encoding="utf-8")

soup = BeautifulSoup(html, "html.parser")
ids = [node["id"] for node in soup.select("[id]")]
assert len(ids) == len(set(ids)), "interactive HTML has duplicate IDs"
assert soup.select_one("#errorRange")
assert soup.select_one("#errorNumber")
assert soup.select_one("#sampleRows")
assert soup.select_one("a[href]")

for relative in (
    "images/NEO-6_DataSheet_GPS.G6-HW-09005.pdf",
    "images/RK3568_datasheet_V2.4.pdf",
    "images/Rockchip_RK3568_TRM_Part1_V1.1-20210301.pdf",
    "images/b-b-5-2-uart-sampling.html",
):
    assert (ARTICLE.parent / relative).is_file(), relative

print("B-B.5.2 static checks: PASS")
print("stop positions:", ", ".join(f"{key}%={value:.3f}" for key, value in expected_positions.items()))
print("baud example error: -0.3906%; FIFO time: 66.67 ms")
print("interactive IDs, controls, article assets and navigation: OK")
