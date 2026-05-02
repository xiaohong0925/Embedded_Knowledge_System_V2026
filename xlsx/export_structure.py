import openpyxl

wb = openpyxl.load_workbook(r'C:\Users\15314\.openclaw\workspace\downloads\19de3995-86a2-8846-8000-00004ea5fac3_Linux知识体系.xlsx', read_only=True, data_only=True)
ws = wb['驱动模型']

with open(r'C:\Users\15314\.kimi_openclaw\workspace\xlsx_structure.txt', 'w', encoding='utf-8') as f:
    f.write('Row structure (showing Col0, Col2, and which content column has data):\n\n')
    
    for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=263, values_only=True), 1):
        col0 = str(row[0])[:60] if row[0] else ''
        col2 = str(row[2])[:60] if row[2] else ''
        col9 = str(row[9])[:60] if row[9] else ''
        col11 = str(row[11])[:60] if row[11] else ''
        col13 = str(row[13])[:60] if row[13] else ''
        
        # Determine which column has the main content
        content_col = ''
        if col9: content_col = 'Col9'
        elif col11: content_col = 'Col11'
        elif col13: content_col = 'Col13'
        
        if col0 or col2 or content_col:
            f.write(f'Row {row_idx:3d}: Col0="{col0}" | Col2="{col2}" | Content={content_col}\n')

print('done')
