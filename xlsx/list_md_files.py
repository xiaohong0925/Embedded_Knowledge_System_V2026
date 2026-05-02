import os

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
files = []

for root, dirs, filenames in os.walk(base):
    for f in filenames:
        if f.endswith('.md'):
            full = os.path.join(root, f)
            rel = os.path.relpath(full, base)
            files.append(rel)

files.sort()

with open('file_list.txt', 'w', encoding='utf-8') as out:
    out.write(f'Total: {len(files)} md files\n')
    out.write('='*60 + '\n\n')
    for f in files:
        out.write(f + '\n')

print(f'Saved file_list.txt with {len(files)} entries')
