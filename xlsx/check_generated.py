import os
import re

def check_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    issues = []
    br_count = content.count('<br>') + content.count('<br/>') + content.count('<br />')
    span_count = content.count('<span')
    
    if br_count > 0:
        issues.append(f"<br> tags: {br_count}")
    if span_count > 0:
        issues.append(f"<span> tags: {span_count}")
    
    # Check for tables without blank line before
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if line.strip().startswith('|') and not line.strip().startswith('|' + '-'):
            if i > 0 and lines[i-1].strip() and not lines[i-1].strip().startswith('|') and not lines[i-1].strip().startswith('#') and not lines[i-1].strip().startswith('```'):
                issues.append(f"Line {i+1}: table without blank line before")
                if len(issues) > 20:
                    break
    
    return issues

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\03-Linux内核深度解析\05-驱动模型'

for f in sorted(os.listdir(base)):
    if f.endswith('.md'):
        path = os.path.join(base, f)
        size = os.path.getsize(path)
        issues = check_file(path)
        print(f"{f}: {size} bytes")
        if issues:
            for issue in issues[:10]:
                print(f"  - {issue}")
            if len(issues) > 10:
                print(f"  ... and {len(issues)-10} more")
        else:
            print("  - Clean")
