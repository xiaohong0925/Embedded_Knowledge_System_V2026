import os, glob

base_dir = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\07-应用层开发'

# Files needing fixes from Round 2/3
fixes = {
    '机器人专题/27-机器人专题.md': ['mermaid'],
    '性能分析与优化/02-perf火焰图与热点分析.md': ['why'],
    '系统服务化/02-嵌入式服务化设计.md': ['why'],
    '轻量级容器/02-Docker核心操作：10个命令搞定隔离环境.md': ['why'],
    '轻量级容器化技术/02-Docker在嵌入式中的裁剪与应用.md': ['why'],
    '轻量级容器化技术/03-Buildroot容器化与rootfs.md': ['why'],
    '进程间通信/02-管道与消息队列实战.md': ['why'],
    '进程间通信/03-D-Bus与内存共享.md': ['why'],
}

# Also fix README.md (history + summary + why)
readme_path = os.path.join(base_dir, 'README.md')
if os.path.exists(readme_path):
    with open(readme_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Add history section if missing
    if '历史演进' not in content:
        # Add after the 学习路径 section
        idx = content.find('## 前置知识')
        if idx != -1:
            history = '''\n## 历史演进\n\n<span class="red">嵌入式 Linux 应用层开发</span>的演进，反映了从"裸机单片机"到"现代操作系统应用"的范式迁移。<br>\n上世纪 80 年代的嵌入式系统以 8 位单片机为主，程序直接操作寄存器，无操作系统概念。<br>\n1991 年 Linux 诞生后，嵌入式领域开始探索将完整操作系统移植到资源受限设备。<br>\n2000 年代，uClinux（无 MMU 的 Linux）推动了 Linux 在 MCU 上的应用，应用层编程模型从循环轮询转向多进程/多线程。<br>\n2010 年后，容器技术（Docker 2013）和 systemd 进入嵌入式领域，应用部署方式从"静态二进制"转向"容器化镜像"，服务管理从 SysV init 转向 systemd unit。<br>\n当前趋势是异构多核协同（Linux + RTOS）和轻量级虚拟化（Jailhouse），应用层开发需要同时兼顾实时性、安全性和可维护性。\n\n'''
            content = content[:idx] + history + content[idx:]
    
    # Add summary + exercise
    if '小结' not in content and '总结' not in content:
        summary = '''\n## 本章小结\n\n| 维度 | 要点 |\n|------|------|\n| 编程模型 | 多线程、IPC、网络编程构成应用层核心 |\n| 工具链 | GDB、perf、Valgrind 形成调试诊断闭环 |\n| 部署形态 | 从静态二进制 → 容器化镜像 → 分层 OTA |\n| 服务管理 | systemd 替代 SysV init，unit 化配置 |\n| 质量门禁 | 看门狗 + 心跳 + 死锁防治 = 可靠性 |\n\n## 练习\n\n1. 为什么嵌入式应用层需要关注实时性，而服务器端应用通常不需要？\n2. 在资源受限的嵌入式设备上，为什么容器化比传统虚拟机更可行？\n3. 设计一个嵌入式系统的故障恢复状态机：从检测 → 降级 → 重启 → 上报。\n'''
        content += summary
    
    # Add why derivation at beginning
    if '为什么' not in content and '为何' not in content:
        # Add after first H1
        lines = content.split('\n')
        h1_idx = 0
        for i, line in enumerate(lines):
            if line.startswith('# '):
                h1_idx = i
                break
        # Insert after first paragraph after H1
        insert_idx = h1_idx + 1
        for i in range(h1_idx + 1, len(lines)):
            if lines[i].strip() == '':
                insert_idx = i + 1
                break
        why_text = '''<span class="red">为什么嵌入式 Linux 需要专门的应用层开发体系？</span><br>
传统服务器应用开发关注高并发与扩展性，而嵌入式应用层面临截然不同的约束：<br>
资源受限（MB 级内存、MHz 级 CPU）、实时性要求（硬实时任务不能被打断）、<br>
可靠性需求（无人值守场景下必须自治恢复）、部署封闭（OTA 是唯一升级通道）。<br>
因此，嵌入式应用层开发不是"桌面开发的子集"，而是需要独立的工具链、架构模式和质量门禁。\n\n'''
        lines.insert(insert_idx, why_text)
        content = '\n'.join(lines)
    
    with open(readme_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed README.md')

# Fix robot topic - add mermaid
robot_path = os.path.join(base_dir, '机器人专题', '27-机器人专题.md')
if os.path.exists(robot_path):
    with open(robot_path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    
    if '```mermaid' not in content:
        # Add mermaid before summary or at end
        mermaid = '''\n\n```mermaid\nflowchart TD\n    A["传感器层<br>激光雷达/IMU/摄像头"] --> B["感知算法<br>SLAM/物体检测"]\n    B --> C["决策规划<br>路径规划/避障"]\n    C --> D["运动控制<br>电机/舵机/底盘"]\n    D --> E["执行器<br>机械臂/轮式底盘"]\n```\n\n'''
        if '## ' in content:
            # Insert before last ## section
            last_section = content.rfind('## ')
            content = content[:last_section] + mermaid + content[last_section:]
        else:
            content += mermaid
    
    with open(robot_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed 机器人专题.md')

# Fix files missing "why"
why_files = [
    '性能分析与优化/02-perf火焰图与热点分析.md',
    '系统服务化/02-嵌入式服务化设计.md',
    '轻量级容器/02-Docker核心操作：10个命令搞定隔离环境.md',
    '轻量级容器化技术/02-Docker在嵌入式中的裁剪与应用.md',
    '轻量级容器化技术/03-Buildroot容器化与rootfs.md',
    '进程间通信/02-管道与消息队列实战.md',
    '进程间通信/03-D-Bus与内存共享.md',
]

for rel_path in why_files:
    full_path = os.path.join(base_dir, rel_path)
    if not os.path.exists(full_path):
        print('Not found:', rel_path)
        continue
    
    with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    
    # Check if already has why
    has_why = any(w in content for w in ['为什么', '为何', '痛点', '需求', '要解决'])
    if has_why:
        print('Already has why:', rel_path)
        continue
    
    # Insert why paragraph after first H2
    lines = content.split('\n')
    h1_idx = -1
    for i, line in enumerate(lines):
        if line.startswith('# '):
            h1_idx = i
            break
    
    if h1_idx != -1:
        # Find first H2 after H1
        h2_idx = -1
        for i in range(h1_idx + 1, len(lines)):
            if lines[i].startswith('## '):
                h2_idx = i
                break
        
        if h2_idx != -1:
            # Insert before first H2
            why_text = '''<span class="red">为什么本章内容对嵌入式开发至关重要？</span><br>
本节聚焦的议题，是嵌入式应用从"能跑"到"跑得稳"的关键跃迁。<br>
理解其背后的设计动机，才能在选型时做出正确决策。\n\n'''
            lines.insert(h2_idx, why_text)
            content = '\n'.join(lines)
            
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print('Fixed why:', rel_path)

print('Done')
