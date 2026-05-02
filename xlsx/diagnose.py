import os
import re

def diagnose():
    base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\03-Linux内核深度解析\05-驱动模型'
    print("=== 文件诊断 ===\n")
    
    for f in sorted(os.listdir(base)):
        if not f.endswith('.md'):
            continue
        path = os.path.join(base, f)
        size = os.path.getsize(path)
        
        with open(path, 'r', encoding='utf-8') as fh:
            content = fh.read()
        
        br = content.count('<br>') + content.count('<br/>') + content.count('<br />')
        span = content.count('<span')
        lines = content.count('\n')
        
        # Check first heading
        first_heading = ""
        for line in content.split('\n')[:10]:
            if line.startswith('# '):
                first_heading = line
                break
        
        print(f"{f}")
        print(f"  大小: {size} bytes, {lines} 行")
        print(f"  <br>残留: {br}, <span>残留: {span}")
        print(f"  首标题: {first_heading[:60]}")
        print()

diagnose()
