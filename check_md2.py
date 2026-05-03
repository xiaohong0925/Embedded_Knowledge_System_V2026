import os, re, json

base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\08-总线协议'
all_files = []
for part in ['第六部分-音视频专用总线', '第七部分-调试与跟踪专用总线']:
    path = os.path.join(base, part)
    for root, dirs, fnames in os.walk(path):
        for f in fnames:
            if f.endswith('.md') and f.lower() != 'readme.md':
                all_files.append(os.path.join(root, f))

results = {}
for fp in all_files:
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1. 历史演进段落检查 - 找包含关键词的段落（>=100字）
    hist_keywords = ['历史演进', '演进', '发展历史', '起源']
    hist_ok = False
    for para in content.split('\n\n'):
        if any(kw in para for kw in hist_keywords) and len(para) >= 100:
            hist_ok = True
            break
    
    # 2. 章节小结+练习检查 - 更准确
    has_summary = False
    if '## 本章小结' in content or '## 章节小结' in content or '## 小结' in content:
        has_summary = True
    
    # 练习题数量：查找练习/习题/思考题部分后的编号列表项
    exercise_count = 0
    # 找到 "## 练习" 或 "## 习题" 或 "## 思考题" 后面的内容
    exercise_section = re.search(r'##\s+(练习|习题|思考题|课后练习)\s*\n([\s\S]*?)(?=\n##\s|\Z)', content)
    if exercise_section:
        section_content = exercise_section.group(2)
        # 数编号项: 1. 2. 3. 或 - 或 *
        numbered = re.findall(r'\n\s*(?:\d+[\.\)、]|[-*])\s+', section_content)
        exercise_count = len(numbered)
    
    # 3. 为什么推导检查
    why_keywords = ['为什么', '为何', '痛点', '需求']
    has_why = any(kw in content for kw in why_keywords)
    
    # 4. Mermaid图检查
    has_mermaid = '```mermaid' in content
    
    # 5. 代码块注释检查
    code_pattern = re.compile(r'```(?:c|cpp|bash)\n(.*?)```', re.DOTALL)
    code_blocks = code_pattern.findall(content)
    need_comment = 0
    for block in code_blocks:
        lines = block.strip().split('\n')
        if len(lines) > 3:
            has_comment = any(re.match(r'\s*(//|#|/\*|\*)', line) for line in lines[:3])
            if not has_comment:
                need_comment += 1
    
    fname = os.path.basename(fp)
    issues = []
    if not hist_ok: issues.append('缺历史演进')
    if not has_summary: issues.append('缺小结')
    if exercise_count < 3: issues.append(f'练习题不足({exercise_count})')
    if not has_why: issues.append('缺推导')
    if not has_mermaid: issues.append('缺Mermaid')
    if need_comment: issues.append(f'{need_comment}个代码块缺注释')
    
    status = '; '.join(issues) if issues else 'OK'
    results[fname] = {
        'path': fp,
        'hist_ok': hist_ok,
        'has_summary': has_summary,
        'exercise_count': exercise_count,
        'has_why': has_why,
        'has_mermaid': has_mermaid,
        'need_comment': need_comment,
        'issues': issues
    }
    print(f'{fname}: {status}')

with open('check_results2.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
