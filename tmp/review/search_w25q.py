from pathlib import Path
from pypdf import PdfReader

pdf = Path('help-docs/W25Q128JV_RevF.pdf')
reader = PdfReader(pdf)
terms = [
    'Quad Enable', 'QE', '0x6B', '6Bh', 'Fast Read Quad',
    'Standard SPI', 'Dual SPI', 'Quad SPI', 'QPI',
    'SPI Modes', 'IO0', 'IO1', 'IO2', 'IO3',
]
for page_number, page in enumerate(reader.pages, start=1):
    text = page.extract_text() or ''
    matches = [term for term in terms if term.lower() in text.lower()]
    if matches:
        print(f'===== PDF page {page_number}: {", ".join(matches)} =====')
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        for i, line in enumerate(lines):
            if any(term.lower() in line.lower() for term in terms):
                start = max(0, i - 2)
                end = min(len(lines), i + 4)
                print('\n'.join(lines[start:end]))
        print()
