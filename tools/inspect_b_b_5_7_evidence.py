from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口" / "images"


def show_pages(filename: str, phrases: tuple[str, ...]) -> None:
    path = IMAGES / filename
    reader = PdfReader(path)
    print(f"\n===== {filename}: {len(reader.pages)} pages =====")
    for page_number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        if any(phrase.lower() in text.lower() for phrase in phrases):
            print(f"\n--- PDF page {page_number} ---\n{text}")


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc


show_pages(
    "HMP60_HMP110_M211060EN-N.pdf",
    (
        "Default Modbus communication settings",
        "Interpretation of 16-bit signed integer values",
        "Modbus measurement data registers",
        "Integer values",
        "HMP110 measurement performance",
        "Response delay",
    ),
)
show_pages(
    "Modbus_Application_Protocol_V1_1b3.pdf",
    ("03 (0x03) Read Holding Registers",),
)
show_pages(
    "Modbus_Serial_Line_V1_02.pdf",
    ("MODBUS Message RTU Framing", "CRC Checking"),
)

for label, data in (
    ("request", bytes.fromhex("F0 03 01 01 00 01")),
    ("response", bytes.fromhex("F0 03 02 00 EB")),
    ("exception", bytes.fromhex("F0 83 02")),
    ("wrong_register_response", bytes.fromhex("F0 03 02 00 00")),
    ("wrong_slave_response", bytes.fromhex("F1 03 02 00 EB")),
    ("wrong_function_response", bytes.fromhex("F0 04 02 00 EB")),
    ("wrong_byte_count_response", bytes.fromhex("F0 03 04 00 EB 00 00")),
    ("negative_response", bytes.fromhex("F0 03 02 FF C9")),
):
    crc = crc16_modbus(data)
    print(f"{label}: {data.hex(' ').upper()} {crc & 0xFF:02X} {crc >> 8:02X} (CRC=0x{crc:04X})")
