import os
import re

def quick_check(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    br = content.count('<br>') + content.count('<br/>') + content.count('<br />')
    span_class = len(re.findall(r'<span\s+class=', content))
    span_style = len(re.findall(r'<span\s+style=', content))
    
    return br, span_class, span_style, len(content)

# Check coordinator's file 06
path = r'C:\Users\15314\.openclaw\workspace\downloads\19de365b-2ed2-85b3-8000-00008419595a_03-05-06-驱动模型历史演进与生态.md'
br, sc, ss, size = quick_check(path)
print(f"Coordinator file 06: br={br}, span_class={sc}, span_style={ss}, size={size} bytes")

# Check all coordinator files
for f in os.listdir(r'C:\Users\15314\.openclaw\workspace\downloads'):
    if f.endswith('.md') and '03-05' in f:
        path = os.path.join(r'C:\Users\15314\.openclaw\workspace\downloads', f)
        br, sc, ss, size = quick_check(path)
        print(f"{f.split('_')[-1]}: br={br}, span_class={sc}, span_style={ss}, size={size}")
