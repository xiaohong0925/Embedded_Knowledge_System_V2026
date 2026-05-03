import os, re

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
    
    # 1. 历史演进段落检查
    hist_keywords = ['历史演进', '演进', '发展历史', '起源']
    has_hist = any(kw in content for kw in hist_keywords)
    hist_ok = False
    if has_hist:
        for para in content.split('\n\n'):
            if any(kw in para for kw in hist_keywords) and len(para) >= 100:
                hist_ok = True
                break
    
    # 2. 章节小结+练习检查
    has_summary = '小结' in content or '总结' in content
    exercise_matches = re.findall(r'(练习|习题|思考题|问答题)', content)
    has_exercises = len(exercise_matches) >= 3
    
    # 3. 为什么推导检查
    why_keywords = ['为什么', '为何', '痛点', '需求']
    has_why = any(kw in content for kw in why_keywords)
    
    # 4. Mermaid图检查
    has_mermaid = '```mermaid' in content
    
    # 5. 代码块注释检查
    code_blocks = re.findall(r'```(?:c|cpp|bash)\n(.*?)```', content, re.DOTALL)
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
    if not has_exercises: issues.append(f'练习题不足({len(exercise_matches)})')
    if not has_why: issues.append('缺推导')
    if not has_mermaid: issues.append('缺Mermaid')
    if need_comment: issues.append(f'{need_comment}个代码块缺注释')
    
    status = '; '.join(issues) if issues else 'OK'
    results[fname] = {
        'path': fp,
        'hist_ok': hist_ok,
        'has_summary': has_summary,
        'has_exercises': has_exercises,
        'has_why': has_why,
        'has_mermaid': has_mermaid,
        'need_comment': need_comment,
        'issues': issues
    }
    print(f'{fname}: {status}')

# Save results for later processing
import json
with open('check_results.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
