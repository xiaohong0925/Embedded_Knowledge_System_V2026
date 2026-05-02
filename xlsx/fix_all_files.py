import os
import re

def check_and_fix_file(filepath, fix=False):
    """Check and optionally fix a markdown file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    issues = []
    br_count = content.count('<br>') + content.count('<br/>') + content.count('<br />')
    span_count = content.count('<span')
    
    if br_count > 0:
        issues.append(f"<br> tags: {br_count}")
    if span_count > 0:
        issues.append(f"<span> tags: {span_count}")
    
    # Check for broken table rows (inconsistent column counts)
    lines = content.split('\n')
    table_lines = [l for l in lines if '|' in l and not l.strip().startswith('```') and not l.strip().startswith('#')]
    
    if fix:
        # Fix <br> tags anywhere
        content = re.sub(r'<br>\s*', '\n', content)
        content = re.sub(r'<br/>\s*', '\n', content)
        content = re.sub(r'<br />\s*', '\n', content)
        
        # Fix <span> tags in code blocks
        def replace_span(match):
            color_class = match.group(1)
            text = match.group(2)
            
            color_map = {
                'red': '/* 🔴 核心API */',
                'green': '/* 🟢 功能实现 */',
                'blue': '/* 🔵 定义 */',
                'orange': '/* 🟠 指标 */',
            }
            marker = color_map.get(color_class, '/* 📌 */')
            return f"{marker} {text}"
        
        content = re.sub(r'<span class="(red|green|blue|orange)">(.*?)</span>', replace_span, content, flags=re.DOTALL)
        
        # Clean up multiple blank lines
        content = re.sub(r'\n{3,}', '\n\n', content)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Re-check
        br_after = content.count('<br>') + content.count('<br/>') + content.count('<br />')
        span_after = content.count('<span')
        issues.append(f"After fix: <br>={br_after}, <span>={span_after}")
    
    return issues

def main():
    base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
    
    # Find all driver model files
    target_files = []
    for root, dirs, files in os.walk(base):
        for f in files:
            if f.endswith('.md') and ('驱动' in f or 'driver' in f.lower()):
                path = os.path.join(root, f)
                target_files.append(path)
    
    print(f"Found {len(target_files)} files:\n")
    
    for path in sorted(target_files):
        size = os.path.getsize(path)
        print(f"File: {os.path.basename(path)} ({size:,} bytes)")
        
        issues = check_and_fix_file(path, fix=True)
        if issues:
            for issue in issues:
                print(f"  - {issue}")
        else:
            print("  - Clean")
        print()

if __name__ == '__main__':
    main()
