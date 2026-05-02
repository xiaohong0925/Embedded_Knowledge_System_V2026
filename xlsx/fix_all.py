import os
import re

def fix_file(filepath):
    """Fix <br> and <span> tags in a markdown file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Count before
    br_count = content.count('<br>') + content.count('<br/>') + content.count('<br />')
    span_count = content.count('<span')
    
    # Replace <br> variants with actual newlines (anywhere, including code blocks)
    content = re.sub(r'<br>\s*', '\n', content)
    content = re.sub(r'<br/>\s*', '\n', content)
    content = re.sub(r'<br />\s*', '\n', content)
    
    # Replace <span class="xxx">text</span> patterns
    # In code blocks: replace with comments
    # Outside code blocks: replace with emoji markers or just the text
    
    def replace_span(match):
        color_class = match.group(1)
        text = match.group(2)
        
        # Map color classes to emoji markers
        color_map = {
            'red': '/* 🔴 核心API */',
            'green': '/* 🟢 功能实现 */',
            'blue': '/* 🔵 定义 */',
            'orange': '/* 🟠 指标 */',
        }
        
        marker = color_map.get(color_class, '/* 📌 */')
        
        # If the span is wrapping code/API names, put marker before
        if text.strip().startswith('ioctl') or text.strip().startswith('open') or text.strip().startswith('write') or text.strip().startswith('read'):
            return f"{marker} {text}"
        elif text.strip().startswith('gpio_base') or text.strip().startswith('ioremap') or text.strip().startswith('writel'):
            return f"{marker} {text}"
        else:
            return f"{marker} {text}"
    
    # Pattern for <span class="xxx">text</span>
    content = re.sub(r'<span class="(red|green|blue|orange)">(.*?)</span>', replace_span, content, flags=re.DOTALL)
    
    # Clean up multiple blank lines
    content = re.sub(r'\n{3,}', '\n\n', content)
    
    # Count after
    br_count_after = content.count('<br>') + content.count('<br/>') + content.count('<br />')
    span_count_after = content.count('<span')
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return br_count, br_count_after, span_count, span_count_after

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
        br_before, br_after, span_before, span_after = fix_file(target_file)
        print(f"  <br> before: {br_before}, after: {br_after}")
        print(f"  <span> before: {span_before}, after: {span_after}")
    else:
        print("File 01 not found")

if __name__ == '__main__':
    main()
