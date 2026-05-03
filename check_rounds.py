import os, re

base_dir = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\08-总线协议'

md_files = []
for root, dirs, files in os.walk(base_dir):
    for f in files:
        if f.endswith('.md') and f != 'README.md':
            md_files.append(os.path.join(root, f))

md_files.sort()
print('Total .md files in 08-总线协议:', len(md_files))

# ROUND 1: Format Hard Standards
round1_issues = []

for path in md_files:
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    lines = content.split('\n')
    rel = os.path.relpath(path, base_dir)

    # ASCII box: exclude markdown table lines
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith('|') and s.endswith('|'):
            continue
        if re.search(r'\+[\-\+]{2,}\+', line):
            round1_issues.append(f'{rel}:{i+1} ASCII box: {line[:50]}')

    # Emoji check
    for i, line in enumerate(lines):
        if line.strip().startswith('```'):
            continue
        if any(0x1F300 <= ord(c) <= 0x1F9FF or 0x2600 <= ord(c) <= 0x26FF for c in line):
            round1_issues.append(f'{rel}:{i+1} Emoji: {line[:60]}')
            break

    # Table with <span>
    for i, line in enumerate(lines):
        if line.strip().startswith('|') and '<span' in line:
            round1_issues.append(f'{rel}:{i+1} Table has <span>: {line[:80]}')

    # Code block missing language identifier
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith('```') and s != '```' and s != '```mermaid':
            if not re.match(r'```[a-zA-Z0-9\-]+', s):
                round1_issues.append(f'{rel}:{i+1} Code no lang: {s}')

    # Title numbering
    for i, line in enumerate(lines):
        if re.match(r'^##\s+\d+\.', line) or re.match(r'^###\s+\d+\.', line):
            round1_issues.append(f'{rel}:{i+1} Title numbering: {line[:50]}')

    # Colloquial expressions
    colloquial = ['说白了', '你可能会问', '咱们', '咱们来', '来聊聊', '说到底', '讲真', '其实吧']
    for i, line in enumerate(lines):
        for expr in colloquial:
            if expr in line:
                round1_issues.append(f'{rel}:{i+1} Colloquial "{expr}": {line[:80]}')
                break

print()
print('=== ROUND 1: Format Hard Standards ===')
print(f'Files checked: {len(md_files)}')
print(f'Issues found: {len(round1_issues)}')
if round1_issues:
    for issue in round1_issues[:40]:
        print('  ', issue)
    if len(round1_issues) > 40:
        print(f'  ... and {len(round1_issues) - 40} more')
else:
    print('  OK - No issues found!')

# ROUND 2: Color Tag + BIEM + Mermaid
round2_issues = []

for path in md_files:
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    rel = os.path.relpath(path, base_dir)

    # Multiple red spans per paragraph
    paragraphs = content.split('\n\n')
    for para in paragraphs:
        red_count = para.count('<span class="red">')
        if red_count > 1:
            para_start = content.find(para)
            line_num = content[:para_start].count('\n') + 1
            round2_issues.append(f'{rel}:{line_num} Multiple red ({red_count})')

    # Span in code blocks
    code_blocks = re.findall(r'```[\s\S]*?```', content)
    for block in code_blocks:
        if '<span' in block:
            round2_issues.append(f'{rel}: <span> in code block')
            break

    # BIEM badge
    has_badge = any(x in content for x in ['badge-b', 'badge-i', 'badge-e', 'badge-m'])
    if not has_badge:
        round2_issues.append(f'{rel}: No BIEM badge')

    # Mermaid
    has_mermaid = '```mermaid' in content
    if not has_mermaid:
        round2_issues.append(f'{rel}: No Mermaid diagram')

print()
print('=== ROUND 2: Color Tag + BIEM + Mermaid ===')
print(f'Issues found: {len(round2_issues)}')
if round2_issues:
    for issue in round2_issues[:40]:
        print('  ', issue)
    if len(round2_issues) > 40:
        print(f'  ... and {len(round2_issues) - 40} more')
else:
    print('  OK - No issues found!')

# ROUND 3: Content Quality Red Lines
round3_issues = []

for path in md_files:
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    rel = os.path.relpath(path, base_dir)

    # Code block comments
    code_blocks = re.findall(r'```[\s\S]*?```', content)
    for block in code_blocks:
        lang = block.split('\n')[0].strip().replace('```', '')
        if lang in ['c', 'cpp', 'bash', 'python', 'rust']:
            lines_in_block = block.split('\n')
            comment_lines = sum(1 for l in lines_in_block if l.strip().startswith('//') or l.strip().startswith('#') or l.strip().startswith('/*'))
            total_lines = len([l for l in lines_in_block if l.strip()])
            if total_lines > 3 and comment_lines < 1:
                round3_issues.append(f'{rel}: Code block ({lang}) lacks comments')
                break

    # Too many analogies
    analogy_count = sum(content.count(m) for m in ['类比：', '类比:', '如同', '相当于', '好比'])
    if analogy_count > 5:
        round3_issues.append(f'{rel}: Too many analogies ({analogy_count})')

    # History/evolution
    has_history = any(h in content for h in ['历史演进', '演进', '发展历史', '起源'])
    if not has_history:
        round3_issues.append(f'{rel}: No history/evolution')

    # Summary/exercise
    has_summary = any(s in content for s in ['小结', '总结', '练习'])
    if not has_summary:
        round3_issues.append(f'{rel}: No summary/exercise')

    # Why needed derivation
    has_why = any(w in content for w in ['为什么', '为何', '痛点', '需求'])
    if not has_why:
        round3_issues.append(f'{rel}: No "why" derivation')

print()
print('=== ROUND 3: Content Quality Red Lines ===')
print(f'Issues found: {len(round3_issues)}')
if round3_issues:
    for issue in round3_issues[:40]:
        print('  ', issue)
    if len(round3_issues) > 40:
        print(f'  ... and {len(round3_issues) - 40} more')
else:
    print('  OK - No issues found!')

print()
print('========================================')
print('SUMMARY')
print(f'  Round 1 (Format):     {len(round1_issues)} issues')
print(f'  Round 2 (Color/BIEM): {len(round2_issues)} issues')
print(f'  Round 3 (Quality):    {len(round3_issues)} issues')
print(f'  TOTAL: {len(round1_issues) + len(round2_issues) + len(round3_issues)} issues / {len(md_files)} files')
