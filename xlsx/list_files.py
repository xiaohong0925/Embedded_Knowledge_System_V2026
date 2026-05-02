import os

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
for root, dirs, files in os.walk(base):
    for f in files:
        path = os.path.join(root, f)
        size = os.path.getsize(path)
        print(f'{size:>8} | {path}')
