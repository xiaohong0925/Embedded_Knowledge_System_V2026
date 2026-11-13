from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "help-docs" / "uart-b-b-5-2"

for pdf_path in sorted(SOURCE.glob("*.pdf")):
    reader = PdfReader(pdf_path)
    chunks = []
    for number, page in enumerate(reader.pages, start=1):
        chunks.append(f"\n===== PDF PAGE {number} =====\n")
        chunks.append(page.extract_text() or "")
    output = pdf_path.with_suffix(".utf8.txt")
    output.write_text("\n".join(chunks), encoding="utf-8")
    print(f"{pdf_path.name}: {len(reader.pages)} pages -> {output.name}")
