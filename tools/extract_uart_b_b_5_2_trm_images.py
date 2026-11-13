from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "help-docs" / "uart-b-b-5-2"
reader = PdfReader(SOURCE / "Rockchip_RK3568_TRM_Part1_V1.1-20210301.pdf")

for page_number in (785, 787):
    page = reader.pages[page_number - 1]
    for image in page.images:
        output = SOURCE / f"page-{page_number}-{image.name}"
        output.write_bytes(image.data)
        print(f"{output.name}: {output.stat().st_size} bytes")
