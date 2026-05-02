#!/usr/bin/env python3
"""
Linux知识体系 Markdown 四色标记批量上色脚本
用法: python colorize_md.py <目录路径>
"""

import os
import re
import sys
import glob

def colorize_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return False

    new_lines = []
    in_code_block = False
    modified = False

    # 红色: 核心概念
    red_words = [
        'Linux 内核', '内核态', '用户态', '进程调度', '内存管理',
        '虚拟文件系统', 'VFS', '设备树', '中断子系统', '网络子系统',
        '时间子系统', '电源管理框架', '内核安全机制', '驱动模型',
        '设备驱动', '中断处理', 'DMA', '并发', '竞态条件',
    ]

    # 绿色: API/工具/协议
    green_words = [
        'kmalloc', 'kfree', 'vmalloc', 'request_irq', 'free_irq',
        'register_chrdev', 'class_create', 'device_create',
        'ioremap', 'readl', 'writel', 'spin_lock', 'mutex_lock',
        'wait_event', 'wake_up', 'skb_alloc', 'netif_receive_skb',
        'of_find_node_by_name', 'platform_driver_register',
        'sysfs', 'procfs', 'debugfs', 'ioctl', 'mmap',
        'I2C', 'SPI', 'UART', 'GPIO', 'PCIe', 'USB', 'CAN',
        'eMMC', 'NAND', 'NOR', 'insmod', 'rmmod', 'modprobe',
        'dmesg', 'printk',
    ]

    for line in lines:
        stripped = line.strip()

        # 代码块检测
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            new_lines.append(line)
            continue

        if in_code_block:
            new_lines.append(line)
            continue

        # 跳过已有颜色的行
        if '<span class="red">' in line or '<span class="green">' in line:
            new_lines.append(line)
            continue

        # 跳过标题、表格
        if stripped.startswith("#") or (stripped.startswith("|") and "|" in stripped[1:]):
            new_lines.append(line)
            continue

        original = line

        # 红色标记（每行最多1个）
        for word in red_words:
            if word in line and f'<span class="red">{word}</span>' not in line:
                # 确保不在HTML标签内
                pattern = re.compile(r'(?<!<span[^>]*>)' + re.escape(word) + r'(?![^<]*</span>)')
                if pattern.search(line):
                    line = pattern.sub(f'<span class="red">{word}</span>', line, count=1)
                    modified = True
                    break

        # 绿色标记（每行最多1个，且不在红色span内）
        for word in green_words:
            if word in line and f'<span class="green">{word}</span>' not in line:
                # 检查是否已经被红色标记包含
                if f'<span class="red">' in line and word in line[line.find('<span class="red">'):line.find('</span>')+8]:
                    continue
                pattern = re.compile(r'(?<!<span[^>]*>)' + re.escape(word) + r'(?![^<]*</span>)')
                if pattern.search(line):
                    line = pattern.sub(f'<span class="green">{word}</span>', line, count=1)
                    modified = True
                    break

        new_lines.append(line)

    if modified:
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
            print(f"  [OK] {filepath}")
            return True
        except Exception as e:
            print(f"  [ERR] {filepath}: {e}")
            return False
    else:
        print(f"  [SKIP] {filepath}")
        return True

def main():
    if len(sys.argv) < 2:
        print("Usage: python colorize_md.py <directory>")
        sys.exit(1)

    target_dir = sys.argv[1]
    if not os.path.exists(target_dir):
        print(f"Error: Directory '{target_dir}' not found")
        sys.exit(1)

    md_files = sorted(glob.glob(os.path.join(target_dir, "**/*.md"), recursive=True))
    print(f"Found {len(md_files)} markdown files")

    success = 0
    for filepath in md_files:
        if colorize_file(filepath):
            success += 1

    print(f"\nDone! Processed: {success}/{len(md_files)}")

if __name__ == '__main__':
    main()
