import openpyxl

wb = openpyxl.load_workbook(r'C:\Users\15314\.openclaw\workspace\downloads\19de3995-86a2-8846-8000-00004ea5fac3_Linux知识体系.xlsx', read_only=True, data_only=True)
ws = wb['驱动模型']

# Check which columns have content across all rows
content_counts = {}
for row in ws.iter_rows(min_row=1, max_row=263, values_only=True):
    for i, v in enumerate(row):
        if v and str(v).strip():
            if i not in content_counts:
                content_counts[i] = 0
            content_counts[i] += 1

print("Column content counts:")
for col, count in sorted(content_counts.items()):
    print(f"  Col {col}: {count} rows")
