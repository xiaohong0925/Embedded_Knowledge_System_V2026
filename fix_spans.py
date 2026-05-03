import os, re

# Fix TSN table span
path = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\08-总线协议\第四部分-车载与网络互联总线\TSN（时间敏感网络）\01-TSN时间敏感网络基础认知.md'
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Replace span in table
old = '<span class="blue">毫秒级</span>'
new = '毫秒级'
if old in content:
    content = content.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed TSN table span')
else:
    print('Pattern not found')
    idx = content.find('毫秒级')
    if idx != -1:
        print('Context:', repr(content[max(0,idx-30):idx+30]))

# Fix multiple red spans per paragraph
base_dir = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\08-总线协议'
fixed_red = 0
for root, dirs, files in os.walk(base_dir):
    for f in files:
        if not f.endswith('.md'):
            continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8', errors='replace') as fh:
            content = fh.read()
        
        paragraphs = content.split('\n\n')
        modified = False
        new_paras = []
        for para in paragraphs:
            red_count = para.count('<span class="red">')
            if red_count > 1:
                # Keep only the first <span class="red">, replace subsequent ones with plain text
                # Strategy: replace all but the first <span class="red">...</span> with just the inner text
                parts = para.split('<span class="red">')
                if len(parts) > 2:
                    result = parts[0] + '<span class="red">' + parts[1]
                    for part in parts[2:]:
                        # Remove the closing </span> and keep inner text as plain
                        if '</span>' in part:
                            inner, rest = part.split('</span>', 1)
                            result += inner + rest
                        else:
                            result += part
                    para = result
                    modified = True
            new_paras.append(para)
        
        if modified:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write('\n\n'.join(new_paras))
            rel = os.path.relpath(path, base_dir)
            print('Fixed multi-red: %s' % rel)
            fixed_red += 1

print('\nFixed %d files with multi-red spans' % fixed_red)
