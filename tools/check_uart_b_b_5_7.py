from pathlib import Path
import re
import xml.etree.ElementTree as ET

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SECTION_DIR = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口"
ARTICLE = SECTION_DIR / "B-B.5.7_Modbus RTU协议与传感器采集.md"
CODE = SECTION_DIR / "code" / "B-B.5.7"
LIB = CODE / "libmodbus-v3.2.0"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def normalized(text: str) -> str:
    return " ".join(text.split())


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0xA001 if crc & 1 else 0)
    return crc


required = [
    ARTICLE,
    CODE / "modbus_sensor.c",
    CODE / "hmp110_temperature.c",
    CODE / "hmp110_temperature.h",
    CODE / "test_modbus_sensor.c",
    CODE / "Makefile",
    LIB / "src" / "modbus.c",
    LIB / "src" / "modbus.h",
    LIB / "src" / "modbus-rtu.c",
]
for path in required:
    require(path.is_file() and path.stat().st_size > 0, f"missing or empty: {path}")

article = ARTICLE.read_text(encoding="utf-8")
program = (CODE / "modbus_sensor.c").read_text(encoding="utf-8")
decoder = (CODE / "hmp110_temperature.c").read_text(encoding="utf-8")
tests = (CODE / "test_modbus_sensor.c").read_text(encoding="utf-8")
lib_modbus = (LIB / "src" / "modbus.c").read_text(encoding="utf-8")
lib_rtu = (LIB / "src" / "modbus-rtu.c").read_text(encoding="utf-8")

vectors = {
    "request": ("F0 03 01 01 00 01", 0x17C1),
    "response": ("F0 03 02 00 EB", 0xDE85),
    "exception": ("F0 83 02", 0x0291),
    "wrong_slave": ("F1 03 02 00 EB", 0x1EB8),
    "wrong_function": ("F0 04 02 00 EB", 0xAA84),
    "wrong_byte_count": ("F0 03 04 00 EB 00 00", 0xC86A),
    "valid_other_value": ("F0 03 02 00 00", 0x91C5),
    "negative": ("F0 03 02 FF C9", 0x3744),
}
for name, (hex_data, expected) in vectors.items():
    require(crc16_modbus(bytes.fromhex(hex_data)) == expected, f"CRC mismatch: {name}")

for text in (
    "F0 03 01 01 00 01 C1 17",
    "F0 03 02 00 EB 85 DE",
    "F0 83 02 91 02",
    "t1.5 ≈ 859.375 µs",
    "t3.5 ≈ 2.005 ms",
    "23.5 °C",
    "−5.5 °C",
    "rs485_config",
    "rs485_supported",
    "EMBBADCRC",
    "EMBXILADD",
    "EMBBADSLAVE",
    "MODBUS_ERROR_RECOVERY_NONE",
):
    require(text in article, f"article missing: {text}")

for snippet, source, label in (
    (
        """dest[i] = (rsp[offset + 2 + (i << 1)] << 8) |
          rsp[offset + 3 + (i << 1)];""",
        lib_modbus,
        "libmodbus register conversion excerpt",
    ),
    (
        """signed_value = (raw & 0x8000u) ? (int32_t)raw - 65536 : (int32_t)raw;
if (signed_value < -400 || signed_value > 800)
    return HMP110_TEMPERATURE_OUTSIDE_MEASUREMENT_RANGE;
*tenths_c = (int)signed_value;""",
        decoder,
        "decoder excerpt",
    ),
):
    require(normalized(snippet) in normalized(source), f"source excerpt drift: {label}")

for call in (
    "modbus_new_rtu",
    "modbus_set_slave",
    "modbus_set_response_timeout",
    "modbus_set_byte_timeout",
    "modbus_connect",
    "modbus_read_registers",
    "modbus_close",
    "modbus_free",
):
    require(call in program, f"program missing API: {call}")
require("modbus_rtu_set_serial_mode(" not in program, "program must not hide the RS-485 support gate")
require("libmodbus_version_micro != 0" in program, "program does not enforce v3.2.0")
require("PASS: 9 semantic groups" in tests, "semantic group count drift")
require("PASS: %d PTY integration groups" in tests, "PTY group summary missing")
require("PASS: 23 deterministic groups" in tests, "total test count drift")
require("0xF0, 0x03, 0x01, 0x01, 0x00, 0x01, 0xC1, 0x17" in tests, "request fixture drift")

for evidence in (
    "int _modbus_receive_msg(",
    "static int check_confirmation(",
    "static int read_registers(",
    "ctx->error_recovery = MODBUS_ERROR_RECOVERY_NONE;",
):
    require(evidence in lib_modbus, f"libmodbus source evidence missing: {evidence}")
for evidence in (
    "static int _modbus_rtu_check_integrity(",
    "errno = EMBBADCRC;",
    "errno = EMBBADSLAVE;",
    "static void _modbus_rtu_close(",
):
    require(evidence in lib_rtu, f"libmodbus RTU evidence missing: {evidence}")

svg_blocks = re.findall(r"<svg\b.*?</svg>", article, flags=re.DOTALL)
require(len(svg_blocks) == 2, f"expected two SVG figures, found {len(svg_blocks)}")
for index, svg in enumerate(svg_blocks, 1):
    ET.fromstring(svg)
    require('stroke="currentColor"' in svg, f"SVG {index} lacks theme stroke")

for target in re.findall(r"\]\(([^)]+)\)", article):
    if "://" in target or target.startswith("#"):
        continue
    path = (ARTICLE.parent / target).resolve()
    require(path.is_file(), f"broken article link: {target}")

mkdocs = (ROOT / "mkdocs.yml").read_text(encoding="utf-8")
readme = (SECTION_DIR / "README.md").read_text(encoding="utf-8")
require("B-B.5.7_Modbus RTU协议与传感器采集.md" in mkdocs, "mkdocs navigation missing")
require("B-B.5.7_Modbus RTU协议与传感器采集.md" in readme, "section README link missing")

pdf_checks = (
    ("Modbus_Application_Protocol_V1_1b3.pdf", 15, "03 (0x03) Read Holding Registers"),
    ("Modbus_Serial_Line_V1_02.pdf", 13, "MODBUS Message RTU Framing"),
    ("HMP60_HMP110_M211060EN-N.pdf", 39, "Default Modbus communication settings"),
    ("HMP60_HMP110_M211060EN-N.pdf", 128, "Interpretation of 16-bit signed integer values"),
    ("HMP60_HMP110_M211060EN-N.pdf", 129, "0x0101 Temperature"),
)
for filename, page_number, phrase in pdf_checks:
    reader = PdfReader(SECTION_DIR / "images" / filename)
    text = reader.pages[page_number - 1].extract_text() or ""
    require(phrase.lower() in text.lower(), f"PDF evidence missing: {filename} page {page_number}: {phrase}")

print("PASS: B-B.5.7 resources, links, SVG, CRC fixtures, source excerpts and manual evidence")
print("STATIC_ONLY: no C compilation, PTY execution, target run or instrument measurement")
