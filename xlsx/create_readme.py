import os

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'

# Get actual directory names by walking
dirs = []
for item in os.listdir(base):
    full = os.path.join(base, item)
    if os.path.isdir(full) and not item.startswith('.') and not item.startswith('stylesheets'):
        dirs.append(item)

print('Found dirs:', dirs)

for d in dirs:
    readme = os.path.join(base, d, 'README.md')
    if not os.path.exists(readme):
        with open(readme, 'w', encoding='utf-8') as f:
            f.write(f'# {d}\n\n模块概览待补充。\n')
        print(f'Created: {readme}')
    else:
        print(f'Exists: {readme}')

print('Done.')
