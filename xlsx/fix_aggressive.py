import os
import re

def aggressive_fix(filepath):
    """Aggressively fix ALL remaining <br> and <span> tags"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Step 1: Replace ALL <br> variants with newlines (anywhere in file)
    content = re.sub(r'<br>', '\n', content)
    content = re.sub(r'<br/>', '\n', content)
    content = re.sub(r'<br />', '\n', content)
    
    # Step 2: Replace ALL <span class="xxx">...text...</span> with markers
    # Handle multiline spans
    def replace_span_aggressive(match):
        full = match.group(0)
        # Extract class
        cm = re.search(r'class="([^"]+)"', full)
        cls = cm.group(1) if cm else 'unknown'
        
        # Extract text
        text = re.sub(r'<span[^\u003e]*\u003e', '', full)
        text = re.sub(r'</span\u003e', '', text)
        
        color_map = {
            'red': '/* red */',
            'green': '/* green */',
            'blue': '/* blue */',
            'orange': '/* orange */',
        }
        marker = color_map.get(cls, '/* span */')
        
        # If inside a code block, use C-style comment
        return f"{marker} {text}"
    
    # Match spans that may span multiple lines
    content = re.sub(r'<span[^\u003e]*class="([^"]+)"[^\u003e]*\u003e(.*?)\u003c/span\u003e', replace_span_aggressive, content, flags=re.DOTALL)
    
    # Step 3: Handle any remaining <span> without class
    content = re.sub(r'<span[^\u003e]*\u003e(.*?)\u003c/span\u003e', r'\1', content, flags=re.DOTALL)
    
    # Step 4: Clean up multiple newlines
    content = re.sub(r'\n{3,}', '\n\n', content)
    
    # Step 5: Clean up spaces at line ends
    content = re.sub(r' +\n', '\n', content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    # Verify
    br_remaining = content.count('<br>') + content.count('<br/>') + content.count('<br />')
    span_remaining = content.count('<span')
    return br_remaining, span_remaining

def main():
    base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
    
    target_files = []
    for root, dirs, files in os.walk(base):
        for f in files:
            if f.endswith('.md'):
                path = os.path.join(root, f)
                if '05-' in path:
                    target_files.append(path)
    
    for path in sorted(target_files):
        print(f"Fixing: {os.path.basename(path)}")
        br, span = aggressive_fix(path)
        print(f"  Remaining: br={br}, span={span}")

if __name__ == '__main__':
    main()
