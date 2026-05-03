import os
import re

bases = [
    'docs/08-总线协议/第三部分-存储设备专用总线',
    'docs/08-总线协议/第四部分-车载与网络互联总线',
    'docs/08-总线协议/第五部分-工业现场总线',
]

files = []
for base in bases:
    for root, dirs, filenames in os.walk(base):
        for f in filenames:
            if f.endswith('.md') and f != 'README.md':
                files.append(os.path.join(root, f))

out_lines = [f"Total files: {len(files)}", ""]

for fp in files:
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1. History evolution paragraph
    history_keywords = ['历史演进', '演进', '发展历史', '起源']
    has_history = any(kw in content for kw in history_keywords)
    
    # 2. Summary + exercises
    has_summary = '## 本章小结' in content
    has_exercises = '## 练习' in content
    
    # Count exercises (numbered list items after ## 练习)
    exercise_match = re.search(r'## 练习\n([\s\S]*?)(?=\n## |\Z)', content)
    exercise_count = 0
    if exercise_match:
        exercise_section = exercise_match.group(1)
        exercise_count = len(re.findall(r'^\d+\.', exercise_section, re.M))
    
    # 3. Why derivation
    why_keywords = ['为什么', '为何', '痛点', '需求']
    has_why = any(kw in content for kw in why_keywords)
    
    # 4. Mermaid diagrams
    mermaid_count = content.count('```mermaid')
    
    # 5. Code block comments
    code_blocks = re.findall(r'```(?:c|cpp|bash)\n([\s\S]*?)```', content)
    code_blocks_need_comment = []
    for block in code_blocks:
        lines = block.strip().split('\n')
        if len(lines) > 3:
            first_line = lines[0].strip()
            if not (first_line.startswith('//') or first_line.startswith('#') or first_line.startswith('/*') or first_line.startswith('*')):
                code_blocks_need_comment.append(lines[0][:50])
    
    issues = []
    if not has_history:
        issues.append('NO_HISTORY')
    if not has_summary:
        issues.append('NO_SUMMARY')
    if not has_exercises or exercise_count < 3:
        issues.append(f'EXERCISES_{exercise_count}')
    if not has_why:
        issues.append('NO_WHY')
    if mermaid_count == 0:
        issues.append('NO_MERMAID')
    if code_blocks_need_comment:
        issues.append(f'CODE_COMMENT({len(code_blocks_need_comment)})')
    
    rel = os.path.relpath(fp)
    if issues:
        out_lines.append(f"{rel}: {', '.join(issues)}")
    else:
        out_lines.append(f"{rel}: OK")

with open('analyze_results.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out_lines))

print("Done. Results written to analyze_results.txt")
