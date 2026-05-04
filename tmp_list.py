import os
import json

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\08-总线协议\片内SoC总线'

skeletons = []
for root, dirs, files in os.walk(base):
    for f in files:
        if f.endswith('.md'):
            p = os.path.join(root, f)
            sz = os.path.getsize(p)
            if sz < 3000 and f != 'README.md':
                skeletons.append({
                    'dir': os.path.basename(root),
                    'file': f,
                    'path': p,
                    'size': sz
                })

for s in skeletons:
    print(f"{s['size']} | {s['dir']} | {s['file']}")
    print(f"  FULL: {s['path']}")
