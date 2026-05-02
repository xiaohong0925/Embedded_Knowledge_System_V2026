import os
import re

def fix_all_spans(filepath):
    """Fix ALL remaining <span> tags in a markdown file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    span_count_before = content.count('<span')
    
    # Match <span class="xxx">...text...</span> with any content including newlines
    def replace_span(match):
        full_match = match.group(0)
        # Extract class name
        class_match = re.search(r'class="([^"]+)"', full_match)
        color_class = class_match.group(1) if class_match else 'unknown'
        
        # Extract text between <span...> and </span>
        text = re.sub(r'<span[^\u003e]*\u003e', '', full_match)
        text = re.sub(r'</span\u003e', '', text)
        
        color_map = {
            'red': '/* red */',
            'green': '/* green */',
            'blue': '/* blue */',
            'orange': '/* orange */',
        }
        
        marker = color_map.get(color_class, '/* span */')
        return f"{marker} {text}"
    
    # This pattern handles <span with class and content up to </span>
    # Using a non-greedy approach to avoid matching across multiple spans
    content = re.sub(r'<span[^\u003e]*class="([^"]+)"[^\u003e]*\u003e(.*?)\u003c/span\u003e', replace_span, content, flags=re.DOTALL)
    
    # Also handle spans without class attribute
    content = re.sub(r'<span[^\u003e]*\u003e(.*?)\u003c/span\u003e', r'\1', content, flags=re.DOTALL)
    
    span_count_after = content.count('<span')
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return span_count_before, span_count_after

def main():
    base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
    
    # Find all driver model files
    target_files = []
    for root, dirs, files in os.walk(base):
        for f in files:
            if f.endswith('.md'):
                path = os.path.join(root, f)
                if '05-' in path:
                    target_files.append(path)
    
    for path in sorted(target_files):
        print(f"Fixing: {os.path.basename(path)}")
        before, after = fix_all_spans(path)
        print(f"  Spans: {before} -> {after}")

if __name__ == '__main__':
    main()
