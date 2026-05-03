import os, re, glob

base_dir = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\07-应用层开发'
mkdocs_path = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\mkdocs.yml'
index_path = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\index.md'

# Collect all .md files
md_files = []
for root, dirs, files in os.walk(base_dir):
    for f in sorted(files):
        if f.endswith('.md'):
            md_files.append(os.path.join(root, f))

print('=== 07-应用层开发 5轮自检 ===')
print('Total .md files:', len(md_files))

# === ROUND 1: Format Hard Standards ===
print('\n=== ROUND 1: 格式硬标准 ===')
r1_issues = 0
for path in md_files:
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    rel = os.path.relpath(path, base_dir)
    lines = content.split('\n')
    
    # Paragraph length > 6 lines (treat <br> as paragraph break too)
    para_lines = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped == '' or stripped == '---' or '<br>' in stripped.lower():
            if para_lines > 6:
                print('  %s: Paragraph too long (%d lines at line %d)' % (rel, para_lines, i-para_lines+1))
                r1_issues += 1
            para_lines = 0
        else:
            para_lines += 1
    
    # Table with <span>
    table_blocks = re.findall(r'\|.*\|', content, re.MULTILINE)
    for tbl in table_blocks:
        if '<span' in tbl:
            print('  %s: Table contains <span>' % rel)
            r1_issues += 1
            break
    
    # Title numbering
    if re.search(r'^#{1,3}\s+\d+[\.\)\s]', content, re.MULTILINE):
        print('  %s: Title has numbering' % rel)
        r1_issues += 1
    
    # ASCII art blocks (non-mermaid code blocks with box chars)
    code_blocks = re.findall(r'```[\s\S]*?```', content)
    for block in code_blocks:
        lang = block.split('\n')[0].strip().replace('```', '')
        if lang not in ['mermaid', ''] and ('┌' in block or '┐' in block or '└' in block or '┘' in block or '│' in block or '─' in block):
            print('  %s: ASCII box art in code block' % rel)
            r1_issues += 1
            break

if r1_issues == 0:
    print('  OK - No issues found!')
else:
    print('  Issues found:', r1_issues)

# === ROUND 2: Color Tag + BIEM + Mermaid ===
print('\n=== ROUND 2: 四色标记 + BIEM + Mermaid ===')
r2_issues = 0
for path in md_files:
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    rel = os.path.relpath(path, base_dir)
    
    # Multiple red spans in same paragraph
    paragraphs = content.split('\n\n')
    for para in paragraphs:
        red_count = para.count('class="red"')
        if red_count > 1:
            print('  %s: Multiple red spans (%d)' % (rel, red_count))
            r2_issues += 1
            break
    
    # No Mermaid
    if '```mermaid' not in content:
        print('  %s: No Mermaid diagram' % rel)
        r2_issues += 1
    
    # No BIEM badge
    if not any(b in content for b in ['badge-b', 'badge-i', 'badge-e', 'badge-m']):
        print('  %s: No BIEM badge' % rel)
        r2_issues += 1

if r2_issues == 0:
    print('  OK - No issues found!')
else:
    print('  Issues found:', r2_issues)

# === ROUND 3: Content Quality Red Lines ===
print('\n=== ROUND 3: 内容质量红线 ===')
r3_issues = 0
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
            # Skip empty and language declaration
            code_lines = [l for l in lines_in_block if l.strip() and not l.strip().startswith('```')]
            if len(code_lines) > 3:
                comment_lines = sum(1 for l in lines_in_block if l.strip().startswith('//') or l.strip().startswith('#') or l.strip().startswith('*'))
                if comment_lines == 0:
                    print('  %s: Code block (%s) lacks comments' % (rel, lang))
                    r3_issues += 1
                    break
    
    # History/evolution
    has_history = any(h in content for h in ['历史演进', '演进', '发展历史', '起源'])
    if not has_history:
        print('  %s: No history/evolution' % rel)
        r3_issues += 1
    
    # Summary/exercise
    has_summary = any(s in content for s in ['小结', '总结', '练习'])
    if not has_summary:
        print('  %s: No summary/exercise' % rel)
        r3_issues += 1
    
    # Why needed derivation
    has_why = any(w in content for w in ['为什么', '为何', '痛点', '需求', '要解决'])
    if not has_why:
        print('  %s: No "why" derivation' % rel)
        r3_issues += 1

if r3_issues == 0:
    print('  OK - No issues found!')
else:
    print('  Issues found:', r3_issues)

# === ROUND 4: Nav Consistency ===
print('\n=== ROUND 4: 导航一致性 ===')
r4_issues = 0

with open(mkdocs_path, 'r', encoding='utf-8', errors='replace') as f:
    mkdocs_content = f.read()

for path in md_files:
    rel = os.path.relpath(path, r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs')
    if rel.replace('/', '\\') not in mkdocs_content and rel.replace('\\', '/') not in mkdocs_content:
        print('  %s: Not in mkdocs.yml nav' % rel)
        r4_issues += 1

if r4_issues == 0:
    print('  OK - All files in nav!')
else:
    print('  Issues found:', r4_issues)

# === ROUND 5: Index Status Consistency ===
print('\n=== ROUND 5: 首页状态一致性 ===')
r5_issues = 0

with open(index_path, 'r', encoding='utf-8', errors='replace') as f:
    index_content = f.read()

# Check 07- section has date
if '2026-05-04' not in index_content:
    # Check if 07- section exists with any date
    idx_07 = index_content.find('7. 应用层开发')
    if idx_07 != -1:
        section_end = index_content.find('</details>', idx_07)
        section = index_content[idx_07:section_end]
        if '2026-05-04' not in section:
            print('  07-应用层开发: Date not updated to 2026-05-04')
            r5_issues += 1
    else:
        print('  07-应用层开发: Section not found in index')
        r5_issues += 1

# Check all 8 sub-items are present
sub_items = ['多线程编程', '进程间通信', '网络编程', '开发工具链', '容器化', '低功耗', '性能分析', '系统服务化']
idx_07 = index_content.find('7. 应用层开发')
if idx_07 != -1:
    section_end = index_content.find('</details>', idx_07)
    section = index_content[idx_07:section_end]
    for item in sub_items:
        if item not in section:
            print('  Missing sub-item in index: %s' % item)
            r5_issues += 1

if r5_issues == 0:
    print('  OK - Index status consistent!')
else:
    print('  Issues found:', r5_issues)

# === SUMMARY ===
print('\n========================================')
print('SUMMARY')
print('  Round 1 (Format):     %d issues' % r1_issues)
print('  Round 2 (Color/BIEM): %d issues' % r2_issues)
print('  Round 3 (Quality):    %d issues' % r3_issues)
print('  Round 4 (Nav):        %d issues' % r4_issues)
print('  Round 5 (Index):      %d issues' % r5_issues)
print('  TOTAL: %d issues / %d files' % (r1_issues + r2_issues + r3_issues + r4_issues + r5_issues, len(md_files)))
