import os

base_dir = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\08-总线协议'

part_difficulty = {
    '第零部分': ('B', 'I'),
    '第一部分': ('B', 'I'),
    '第二部分': ('I', 'E'),
    '第三部分': ('I', 'E'),
    '第四部分': ('I', 'E'),
    '第五部分': ('I', 'E'),
    '第六部分': ('I', 'E'),
    '第七部分': ('I', 'M'),
}

fixed = 0
for root, dirs, files in os.walk(base_dir):
    for f in files:
        if not f.endswith('.md'):
            continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8', errors='replace') as fh:
            content = fh.read()
        
        if any(b in content for b in ['badge-b', 'badge-i', 'badge-e', 'badge-m']):
            continue
        
        rel = os.path.relpath(path, base_dir)
        part = rel.split(os.sep)[0] if os.sep in rel else ''
        
        b_level, i_level = 'I', 'E'
        for key, val in part_difficulty.items():
            if key in part:
                b_level, i_level = val
                break
        
        lines = content.split('\n')
        new_lines = []
        inserted = False
        for i, line in enumerate(lines):
            new_lines.append(line)
            if not inserted and line.startswith('# ') and i < len(lines) - 1:
                new_lines.append('')
                badge1 = '<span class="badge-%s">[%s]</span>' % (b_level.lower(), b_level)
                badge2 = '<span class="badge-%s">[%s]</span>' % (i_level.lower(), i_level)
                new_lines.append('%s %s' % (badge1, badge2))
                new_lines.append('')
                inserted = True
        
        if inserted:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write('\n'.join(new_lines))
            fixed += 1
            print('Fixed BIEM: %s -> [%s]->[%s]' % (rel, b_level, i_level))

print('\nTotal BIEM badges added: %d' % fixed)
