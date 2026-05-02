import openpyxl
from openpyxl.styles import Color

# Read first 20 rows of the 驱动模型 sheet to understand structure
wb = openpyxl.load_workbook('D:\\MyCodeSpace\\Linux_Knowledge\\Embedded_Knowledge_System_V2026\\xlsx\\Linux知识体系.xlsx', read_only=True, data_only=True)
ws = wb['驱动模型']

with open('driver_model_preview.txt', 'w', encoding='utf-8') as f:
    for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=25, values_only=False), 1):
        f.write(f"Row {row_idx}:\n")
        for col_idx, cell in enumerate(row, 1):
            val = cell.value
            if val is not None:
                # Try to get color info
                fill_color = None
                if cell.fill and cell.fill.fgColor and cell.fill.fgColor.rgb and cell.fill.fgColor.rgb != '00000000':
                    fill_color = cell.fill.fgColor.rgb
                font_color = None
                if cell.font and cell.font.color and cell.font.color.rgb and cell.font.color.rgb != '00000000':
                    font_color = cell.font.color.rgb
                f.write(f"  Col{col_idx}: {str(val)[:100]}")
                if fill_color:
                    f.write(f" [fill={fill_color}]")
                if font_color:
                    f.write(f" [font={font_color}]")
                f.write("\n")
        f.write("\n")

print("Preview written to driver_model_preview.txt")
