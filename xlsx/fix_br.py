import os
import re

def fix_br_in_file(filepath):
    """Fix <br> tags in a markdown file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_count = content.count('<br>') + content.count('<br/>') + content.count('<br />')
    
    # Replace <br> variants with proper Markdown line breaks
    # Strategy: <br> between lines in a paragraph -> just keep as newline
    # <br> within a single line -> replace with space or newline depending on context
    
    # First, handle <br> at end of lines
    content = re.sub(r'<br>\s*\n', '\n', content)
    content = re.sub(r'<br/>\s*\n', '\n', content)
    content = re.sub(r'<br />\s*\n', '\n', content)
    
    # Handle <br> in the middle of lines
    # If it's within a paragraph (not in a table or list), replace with newline
    lines = content.split('\n')
    new_lines = []
    
    for line in lines:
        stripped = line.strip()
        # Skip code fences, tables, headers
        if stripped.startswith('```') or stripped.startswith('#') or stripped.startswith('|'):
            new_lines.append(line)
            continue
        
        # Replace <br> variants with spaces (they were forcing line breaks in paragraphs)
        line = re.sub(r'\s*<br>\s*', ' ', line)
        line = re.sub(r'\s*<br/>\s*', ' ', line)
        line = re.sub(r'\s*<br />\s*', ' ', line)
        new_lines.append(line)
    
    content = '\n'.join(new_lines)
    
    # Clean up multiple spaces
    content = re.sub(r'  +', ' ', content)
    # Clean up lines with only spaces
    content = re.sub(r'\n +\n', '\n\n', content)
    
    new_count = content.count('<br>') + content.count('<br/>') + content.count('<br />')
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return original_count, new_count

def main():
    # Find file 01
    base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
    
    target_file = None
    for root, dirs, files in os.walk(base):
        for f in files:
            if f.endswith('.md') and '01-' in f:
                path = os.path.join(root, f)
                if '驱动' in path or 'driver' in path.lower():
                    target_file = path
                    break
        if target_file:
            break
    
    if target_file:
        print(f"Fixing: {target_file}")
        original, remaining = fix_br_in_file(target_file)
        print(f"  Original <br> count: {original}")
        print(f"  Remaining <br> count: {remaining}")
        print(f"  Fixed: {original - remaining}")
    else:
        print("File 01 not found")

if __name__ == '__main__':
    main()
