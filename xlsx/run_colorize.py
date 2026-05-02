import os, sys, glob, re

def colorize_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        print(f'Error reading {filepath}: {e}')
        return False

    new_lines = []
    in_code_block = False
    modified = False

    red_words = [
        'Linux 内核', '内核态', '用户态', '进程调度', '内存管理',
        '虚拟文件系统', 'VFS', '设备树', '中断子系统', '网络子系统',
        '时间子系统', '电源管理框架', '内核安全机制', '驱动模型',
        '设备驱动', '中断处理', 'DMA', '并发', '竞态条件',
    ]

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
        if stripped.startswith('```'):
            in_code_block = not in_code_block
            new_lines.append(line)
            continue
        if in_code_block:
            new_lines.append(line)
            continue
        if '<span class="red">' in line or '<span class="green">' in line:
            new_lines.append(line)
            continue
        if stripped.startswith('#') or (stripped.startswith('|') and '|' in stripped[1:]):
            new_lines.append(line)
            continue

        original = line
        for word in red_words:
            if word in line and f'<span class="red">{word}</span>' not in line:
                # Check if already wrapped in any span
                if re.search(rf'<span[^>]*>[^<]*{re.escape(word)}[^<]*</span>', line):
                    continue
                line = line.replace(word, f'<span class="red">{word}</span>', 1)
                modified = True
                break

        for word in green_words:
            if word in line and f'<span class="green">{word}</span>' not in line:
                # Check if already wrapped in any span
                if re.search(rf'<span[^>]*>[^<]*{re.escape(word)}[^<]*</span>', line):
                    continue
                line = line.replace(word, f'<span class="green">{word}</span>', 1)
                modified = True
                break

        new_lines.append(line)

    if modified:
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
            print(f'  [OK] {filepath}')
            return True
        except Exception as e:
            print(f'  [ERR] {filepath}: {e}')
            return False
    else:
        print(f'  [SKIP] {filepath}')
        return True

def main():
    base = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs'
    kernel_dir = None
    for d in os.listdir(base):
        if d.startswith('03-'):
            kernel_dir = d
            break

    if not kernel_dir:
        print('ERROR: 03-Linux内核与驱动 dir not found')
        sys.exit(1)

    target_dir = os.path.join(base, kernel_dir)
    md_files = sorted(glob.glob(os.path.join(target_dir, '**/*.md'), recursive=True))
    print(f'Found {len(md_files)} markdown files in {kernel_dir}')

    success = 0
    for filepath in md_files:
        if colorize_file(filepath):
            success += 1

    print(f'\nDone! Processed: {success}/{len(md_files)}')

if __name__ == '__main__':
    main()
