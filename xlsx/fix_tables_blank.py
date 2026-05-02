import os
import re

def fix_tables(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    new_lines = []
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        
        # Check if this is a table row (starts with | but not |---)
        if stripped.startswith('|') and not re.match(r'^\|[-\s|]+\|$', stripped):
            # Check previous non-empty line
            if new_lines and new_lines[-1].strip():
                prev = new_lines[-1].strip()
                # If previous is not a table separator, not empty, not code fence, not heading
                if not prev.startswith('|') and not prev.startswith('#') and not prev.startswith('```'):
                    new_lines.append('')
        
        new_lines.append(line)
    
    new_content = '\n'.join(new_lines)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    return new_content != content

def main():
    base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\03-Linux内核深度解析\05-驱动模型'
    
    for f in sorted(os.listdir(base)):
        if f.endswith('.md'):
            path = os.path.join(base, f)
            changed = fix_tables(path)
            print(f"{f}: {'fixed' if changed else 'no change'}")

if __name__ == '__main__':
    main()
