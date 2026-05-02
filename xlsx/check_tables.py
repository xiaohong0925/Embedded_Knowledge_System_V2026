import os, re

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\03-Linux内核深度解析\05-驱动模型'

for f in sorted(os.listdir(base)):
    if not f.endswith('.md'):
        continue
    path = os.path.join(base, f)
    with open(path, 'r', encoding='utf-8') as fh:
        content = fh.read()
    
    lines = content.split('\n')
    table_issues = []
    
    for i, line in enumerate(lines, 1):
        # Check if line is a table row (starts with |)
        if line.strip().startswith('|') and not line.strip().startswith('|' + '-'):
            # Check if previous non-empty line exists and is not a table/header/blank
            if i > 1:
                prev = lines[i-2].strip()
                # If previous line is not empty, not a table separator, not a heading, not a list marker, not a blockquote
                if prev and not prev.startswith('|') and not prev.startswith('#') and not prev.startswith('-') and not prev.startswith('*') and not prev.startswith('>') and not prev.startswith('```'):
                    # This might be a table without blank line before it
                    table_issues.append(f"Line {i}: table row after '{prev[:50]}'")
    
    if table_issues:
        print(f"\n{f}: {len(table_issues)} potential table issues")
        for issue in table_issues[:5]:
            print(f"  {issue}")
    else:
        print(f"{f}: no table issues")
