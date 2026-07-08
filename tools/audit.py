#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EKL 全项目质量审计工具
生成基线报告，为后续整改提供数据支撑

用法:
    python tools/audit.py [--json reports/audit-baseline.json]
"""

import os
import re
import json
import argparse
from pathlib import Path
from collections import defaultdict, Counter

BASE_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = BASE_DIR / "docs"

# ─────────────────────────────────────────────
# 规则定义
# ─────────────────────────────────────────────

L1_RULES = {
    "L1-001": ("一级标题含序号", r'^#\s+\d+[\.\d\s]'),
    "L1-002": ("存在四级标题", r'^####\s+'),
    "L1-003": ("表格内含span标签", None),  # 特殊处理
    "L1-004": ("blockquote嵌套代码块", None),  # 特殊处理
    "L1-005": ("代码块缺少语言标识", r'^```\s*$'),
    "L1-006": ("死链/错链", None),  # 特殊处理
    "L1-007": ("mkdocs构建问题", None),  # 由CI处理
    "L1-008": ("文件命名不合规", None),  # 特殊处理
}

L2_RULES = {
    "L2-001": ("段落超过4行", None),
    "L2-002": ("单段'你'超过2次", None),
    "L2-003": ("emoji后直接粗体", r'(💡|⚠️|🔴|📷|🎯|📚|🔗)\s*\*\*'),
    "L2-004": ("含AI导航语", r'(下面介绍|接下来我们来看|下面逐一展开|下面将详细|下面来看|接下来介绍)'),
    "L2-005": ("含元叙述", r'(本节用|本节将用|本节通过|张图带你|本章用|本章将用)'),
    "L2-006": ("小节标题缺少BIEM徽章", None),  # 特殊处理
    "L2-007": ("[图N]标注未改审稿格式", r'\[图\d+[：:]'),
    "L2-008": ("含伪百分比", r'\d{1,2}%的?(时间|情况|场景|问题|工程师|开发者|用户)'),
    "L2-009": ("代码块含$提示符", r'^\$\s+\w+'),
    "L2-010": ("含生活化比喻", r'(厨房做菜|做菜|做饭|炒菜|骑车|逛街|看电影|看电视)'),
}

L3_RULES = {
    "L3-001": ("使用小写<br>", r'<br>(?![^<]*>)'),
    "L3-002": ("含珍珠项链比喻", r'珍珠项链'),
    "L3-003": ("承诺型表述", r'学完本节|学完本章|学完后|通过本节'),
    "L3-004": ("ASCII框图(建议改Mermaid)", None),
    "L3-005": ("难度非范围标注", r'难度：\s*\[[^→]+\](?!.*→)'),
}

# ─────────────────────────────────────────────
# 检查函数
# ─────────────────────────────────────────────

def check_l1(content: str, rel_path: str) -> list:
    issues = []
    lines = content.split('\n')
    in_code_block = False
    in_blockquote = False
    in_table = False

    for i, line in enumerate(lines, 1):
        # 代码块边界
        if line.startswith('```'):
            in_code_block = not in_code_block
            # L1-005: 代码块缺少语言标识
            if not in_code_block:
                continue
            match = re.match(r'^```\s*(\w*)\s*$', line)
            if match and not match.group(1):
                issues.append(("L1-005", i, line.strip()[:60]))
            continue

        if in_code_block:
            # L2-009: 代码块含$提示符
            if re.match(r'^\$\s+\w+', line):
                issues.append(("L2-009", i, line.strip()[:60]))
            continue

        # blockquote 边界
        if line.startswith('>'):
            in_blockquote = True
        elif not line.strip():
            in_blockquote = False
        else:
            in_blockquote = False

        # 表格边界
        if '|' in line and not line.startswith('>'):
            in_table = True
        elif not line.strip():
            in_table = False

        # L1-001: 一级标题含序号
        if re.match(r'^#\s+\d+[\.\d\s]', line):
            issues.append(("L1-001", i, line.strip()[:60]))

        # L1-002: 四级标题
        if re.match(r'^####\s+', line):
            issues.append(("L1-002", i, line.strip()[:60]))

        # L1-003: 表格内span
        if in_table and '<span' in line:
            issues.append(("L1-003", i, line.strip()[:60]))

        # L1-004: blockquote内嵌代码块
        if in_blockquote and line.startswith('```'):
            issues.append(("L1-004", i, line.strip()[:60]))

        # L2 规则（行级正则）
        for rule_id, (desc, pattern) in L2_RULES.items():
            if pattern and re.search(pattern, line):
                # 排除一些误报
                if rule_id == "L2-010" and rel_path.startswith("05-"):
                    continue  # 第5部行业视野允许比喻
                issues.append((rule_id, i, line.strip()[:60]))

        # L3 规则
        for rule_id, (desc, pattern) in L3_RULES.items():
            if pattern and re.search(pattern, line):
                issues.append((rule_id, i, line.strip()[:60]))

    # L2-001: 段落长度检查
    paragraphs = re.split(r'\n\n+', content)
    for para_idx, para in enumerate(paragraphs):
        if para.startswith('```') or para.startswith('#') or para.startswith('|') or para.startswith('>'):
            continue
        lines_in_para = [l for l in para.split('\n') if l.strip()]
        non_list = [l for l in lines_in_para if not re.match(r'^\s*[\-\*\d+\.]', l.strip())]
        if len(non_list) > 4:
            issues.append(("L2-001", f"para_{para_idx}", f"段落超长({len(non_list)}行非列表)"))

    # L2-002: 单段"你"计数
    for para_idx, para in enumerate(paragraphs):
        if para.startswith('```') or para.startswith('#') or para.startswith('|'):
            continue
        you_count = para.count('你')
        if you_count > 2:
            issues.append(("L2-002", f"para_{para_idx}", f"'你'出现{you_count}次"))

    # L2-006: 小节标题缺少BIEM徽章（对非固定小节）
    h2_lines = re.findall(r'^## (.+)$', content, re.MULTILINE)
    exempt = {'本节导读', '本节总结', '下一步', '常见问题FAQ', '知识图谱与查漏补缺', '动手实验', '核心概念回顾'}
    for h2 in h2_lines:
        h2_clean = re.sub(r'<[^>]+>', '', h2).strip()
        h2_text = re.sub(r'\s*\[.*\]\s*', '', h2_clean)
        if h2_text in exempt:
            continue
        if not re.search(r'badge-[biewm]', h2) and not re.search(r'\[[B→IE]+\]', h2):
            issues.append(("L2-006", 0, f"'{h2[:50]}...'"))

    # L1-006: 死链检查
    links = re.findall(r'\[([^\]]+)\]\(([^)]+)\)', content)
    for text, url in links:
        if url.startswith('http') or url.startswith('#'):
            continue
        if url.startswith('/'):
            target = DOCS_DIR / url.lstrip('/').replace('/', os.sep)
        else:
            target = (BASE_DIR / "docs" / rel_path).parent / url.replace('/', os.sep)
        target = target.resolve()
        if not target.exists():
            issues.append(("L1-006", 0, f"[{text}] -> {url}"))

    return issues


# ─────────────────────────────────────────────
# 主函数
# ─────────────────────────────────────────────

def audit_file(filepath: Path) -> dict:
    rel = filepath.relative_to(BASE_DIR).as_posix()
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    issues = check_l1(content, rel)

    l1 = [i for i in issues if i[0].startswith('L1')]
    l2 = [i for i in issues if i[0].startswith('L2')]
    l3 = [i for i in issues if i[0].startswith('L3')]

    # 估算字数
    word_count = len(content)

    return {
        "path": rel,
        "words": word_count,
        "l1_count": len(l1),
        "l2_count": len(l2),
        "l3_count": len(l3),
        "l1_issues": l1,
        "l2_issues": l2,
        "l3_issues": l3,
    }


def main():
    parser = argparse.ArgumentParser(description="EKL 全项目质量审计")
    parser.add_argument("--json", type=str, default="reports/audit-baseline.json", help="JSON报告输出路径")
    parser.add_argument("--markdown", type=str, default="reports/audit-dashboard.md", help="Markdown看板输出路径")
    args = parser.parse_args()

    # 收集所有md文件
    md_files = sorted(DOCS_DIR.rglob("*.md"))
    print(f"📁 扫描到 {len(md_files)} 个 Markdown 文件\n")

    results = []
    module_stats = defaultdict(lambda: {"files": 0, "l1": 0, "l2": 0, "l3": 0, "words": 0})
    rule_counter = Counter()

    for idx, filepath in enumerate(md_files, 1):
        result = audit_file(filepath)
        results.append(result)

        # 模块统计
        parts = result["path"].split('/')
        module = parts[1] if len(parts) > 1 else "root"
        module_stats[module]["files"] += 1
        module_stats[module]["l1"] += result["l1_count"]
        module_stats[module]["l2"] += result["l2_count"]
        module_stats[module]["l3"] += result["l3_count"]
        module_stats[module]["words"] += result["words"]

        # 规则统计
        for issue in result["l1_issues"] + result["l2_issues"] + result["l3_issues"]:
            rule_counter[issue[0]] += 1

        if idx % 50 == 0:
            print(f"  已处理 {idx}/{len(md_files)}...")

    # 汇总
    total_l1 = sum(r["l1_count"] for r in results)
    total_l2 = sum(r["l2_count"] for r in results)
    total_l3 = sum(r["l3_count"] for r in results)
    total_words = sum(r["words"] for r in results)
    files_with_l1 = sum(1 for r in results if r["l1_count"] > 0)

    summary = {
        "scan_time": "2026-07-03",
        "total_files": len(md_files),
        "total_words": total_words,
        "total_l1": total_l1,
        "total_l2": total_l2,
        "total_l3": total_l3,
        "files_with_l1": files_with_l1,
        "l1_rate": round(files_with_l1 / len(md_files) * 100, 1) if md_files else 0,
        "modules": dict(module_stats),
        "rule_distribution": dict(rule_counter),
        "files": results,
    }

    # 写入JSON
    json_path = BASE_DIR / args.json
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    # 写入Markdown看板
    md_path = BASE_DIR / args.markdown
    md_path.parent.mkdir(parents=True, exist_ok=True)

    md_lines = [
        "# EKL 质量审计看板",
        "",
        f"> 扫描时间：{summary['scan_time']}  ",
        f"> 文件总数：**{summary['total_files']}**  |  总字数：**{summary['total_words']:,}**",
        "",
        "## 总体健康度",
        "",
        f"| 指标 | 数值 | 健康度 |",
        f"|------|------|--------|",
        f"| L1 阻断级问题 | {total_l1} | {'🔴 高危' if total_l1 > 100 else '🟡 中危' if total_l1 > 20 else '🟢 健康'} |",
        f"| L2 提醒级问题 | {total_l2} | {'🔴 待清理' if total_l2 > 500 else '🟡 进行中' if total_l2 > 100 else '🟢 可控'} |",
        f"| L3 优化级问题 | {total_l3} | 持续改进 |",
        f"| 含L1问题文件 | {files_with_l1}/{len(md_files)} ({summary['l1_rate']}%) | {'🔴' if summary['l1_rate'] > 50 else '🟡' if summary['l1_rate'] > 20 else '🟢'} |",
        "",
        "## 模块健康度",
        "",
        "| 模块 | 文件数 | L1 | L2 | L3 | 字数 | 状态 |",
        "|------|--------|----|----|----|------|------|",
    ]

    for mod, stats in sorted(module_stats.items()):
        status = "🟢" if stats["l1"] == 0 else "🟡" if stats["l1"] < 10 else "🔴"
        md_lines.append(f"| {mod} | {stats['files']} | {stats['l1']} | {stats['l2']} | {stats['l3']} | {stats['words']:,} | {status} |")

    md_lines += [
        "",
        "## 问题分布 TOP10",
        "",
        "| 规则 | 描述 | 次数 | 级别 |",
        "|------|------|------|------|",
    ]

    for rule_id, count in rule_counter.most_common(10):
        rule_def = L1_RULES.get(rule_id) or L2_RULES.get(rule_id) or L3_RULES.get(rule_id) or (rule_id, None)
        desc = rule_def[0]
        level = "🔴 L1" if rule_id.startswith("L1") else "🟡 L2" if rule_id.startswith("L2") else "🔵 L3"
        md_lines.append(f"| {rule_id} | {desc} | {count} | {level} |")
        desc = L1_RULES.get(rule_id, L2_RULES.get(rule_id, L3_RULES.get(rule_id, (rule_id, None)))[0]
        level = "🔴 L1" if rule_id.startswith("L1") else "🟡 L2" if rule_id.startswith("L2") else "🔵 L3"
        md_lines.append(f"| {rule_id} | {desc} | {count} | {level} |")

    md_lines += [
        "",
        "## L1 问题文件清单（需优先修复）",
        "",
    ]

    l1_files = [r for r in results if r["l1_count"] > 0]
    l1_files.sort(key=lambda x: x["l1_count"], reverse=True)

    for r in l1_files[:30]:
        md_lines.append(f"- **{r['path']}** — L1:{r['l1_count']} L2:{r['l2_count']} L3:{r['l3_count']}")
        for issue in r["l1_issues"][:3]:
            md_lines.append(f"  - `{issue[0]}` 行{issue[1]}: {issue[2]}")
        if len(r["l1_issues"]) > 3:
            md_lines.append(f"  - ... 等共 {r['l1_count']} 处")

    with open(md_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md_lines))

    # 终端输出
    print(f"\n{'='*60}")
    print("📊 审计完成")
    print(f"{'='*60}")
    print(f"  总文件数: {len(md_files)}")
    print(f"  总字数:   {total_words:,}")
    print(f"  L1 问题:  {total_l1} (影响 {files_with_l1} 个文件)")
    print(f"  L2 问题:  {total_l2}")
    print(f"  L3 问题:  {total_l3}")
    print(f"\n  JSON报告: {json_path}")
    print(f"  看板:     {md_path}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
