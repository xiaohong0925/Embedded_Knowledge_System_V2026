import os

# Fix TSN table span - read as text with replace, then write back
path = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\08-总线协议\第四部分-车载与网络互联总线\TSN（时间敏感网络）\01-TSN时间敏感网络基础认知.md'
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    lines = f.readlines()

fixed = False
for i, line in enumerate(lines):
    if line.strip().startswith('|') and '<span class="blue">' in line:
        # Remove span tags but keep inner text
        line = line.replace('<span class="blue">', '')
        line = line.replace('</span>', '')
        lines[i] = line
        fixed = True
        print('Fixed line %d' % (i+1))

if fixed:
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print('TSN table span fixed successfully')
else:
    print('No table span found')
