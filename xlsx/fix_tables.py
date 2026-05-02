import os, re

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\03-Linux内核深度解析\05-驱动模型'

def fix_tables(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    new_lines = []
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        
        # Check if this line is a table row (starts with | but not |---)
        if stripped.startswith('|') and not stripped.startswith('|' + '-' * 3):
            # Check if previous non-empty line exists
            if i > 0:
                prev_idx = i - 1
                while prev_idx >= 0 and not lines[prev_idx].strip():
                    prev_idx -= 1
                
                if prev_idx >= 0:
                    prev = lines[prev_idx].strip()
                    # If previous line is not a table separator, not a heading, not a list marker, not empty, not code fence
                    if not prev.startswith('|') and not prev.startswith('#') and not prev.startswith('-') and not prev.startswith('*') and not prev.startswith('>') and not prev.startswith('```') and not prev.startswith('1.') and not prev.startswith('2.') and not prev.startswith('3.') and not prev.startswith('4.') and not prev.startswith('5.') and not prev.startswith('6.') and not prev.startswith('7.') and not prev.startswith('8.') and not prev.startswith('9.'):
                        # Need to add blank line before this table
                        # But we can't modify new_lines retroactively easily
                        # So we check if there's already a blank line
                        if new_lines and new_lines[-1].strip():
                            new_lines.append('')
        
        new_lines.append(line)
    
    new_content = '\n'.join(new_lines)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    return len(new_lines) - len(lines)  # number of lines added

for f in sorted(os.listdir(base)):
    if f.endswith('.md'):
        path = os.path.join(base, f)
        added = fix_tables(path)
        print(f'{f}: added {added} blank lines')
