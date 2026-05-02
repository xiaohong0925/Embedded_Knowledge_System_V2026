import os

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'

# Find file 06
target_file = None
for root, dirs, files in os.walk(base):
    for f in files:
        if f.endswith('.md') and '06-' in f:
            path = os.path.join(root, f)
            if '驱动' in path or 'driver' in path.lower():
                target_file = path
                break
    if target_file:
        break

if target_file:
    with open(target_file, 'r', encoding='utf-8') as f:
        content = f.read()
    print(f"File: {target_file}")
    print(f"Size: {len(content)} bytes")
    print(f"Content preview:")
    print(content[:2000])
else:
    print("File 06 not found")
