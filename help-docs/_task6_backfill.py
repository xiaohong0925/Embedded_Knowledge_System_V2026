# -*- coding: utf-8 -*-
"""任务6回填：第一部旧引用 -> 新38章目录。A类+B类映射，C类删除。"""
from docx import Document
import re, sys

PATH = r'help-docs/嵌入式Linux知识体系V2026_最终版_38章.docx'

# (旧文本, 新文本) —— 按对照表 1.1~6.11 + R1~R6
REPL = [
# ---- 第1章 ----
("第II部第7章（内核子系统）将深入ARM异常向量表、RISC-V的PLIC中断控制器；第IV部（性能优化）会深入到SIMD指令集和Cache优化。★第1次出现（概念级）",
 "第10章（中断与时间）将深入异常向量表与中断控制器的工作原理。★第1次出现（概念级）"),
("第II部第9章（存储子系统）会深入MTD层、文件系统选型；第IV部会涉及存储性能调优。★第1次出现（概念级）",
 "第12章（文件系统与存储）会深入MTD层，第17章（存储架构设计）会讨论文件系统选型与存储性能权衡。★第1次出现（概念级）"),
("第II部第8章（驱动开发）会自己写串口驱动、理解UART寄存器。★第1次出现（操作级）",
 "第11章（设备模型）会亲手写出第一个驱动（11.0），第22章（驱动架构设计）会讨论串口等驱动的设计权衡。★第1次出现（操作级）"),
("第III部（调试与维护）会深入看门狗、复位控制器、电源管理。★第1次出现（概念级）",
 "第15章（电源管理）会深入电源管理，第30章（可靠性工程）会深入看门狗与复位设计。★第1次出现（概念级）"),
("当你需要优化Cache miss或理解分支预测时，那是第IV部的事。在第一部",
 "当你需要优化Cache miss或理解分支预测时，那是性能优化阶段的事，本书不做展开。在第一部"),
# ---- 第2章 ----
("到第II部第6章（构建系统）会深入到sysroot、staging dir、交叉编译的依赖管理，再到第III部会涉及工具链的定制和优化。",
 "到第18章（构建系统设计）会深入到sysroot、staging dir、交叉编译的依赖管理和工具链的定制。"),
("第II部第6章（构建系统）会在Yocto/Buildroot中处理更复杂的交叉编译场景（ Canadian Cross、多重目标）；第IV部涉及工具链级别的优化（LTO、PGO）。★第1次出现（操作级）",
 "第18章（构建系统设计）会在Yocto/Buildroot中处理更复杂的交叉编译场景（Canadian Cross、多重目标）。★第1次出现（操作级）"),
("第II部第6章会在Buildroot中切换C库并分析体积差异；第IV部会涉及musl在静态链接场景的优势。★第1次出现（概念级）",
 "第18章（构建系统设计）会在Buildroot中切换C库、分析体积差异，并讨论musl在静态链接场景的优势。★第1次出现（概念级）"),
("第III部（调试）会深入分析elf文件结构和链接过程；第II部第8章会写裸机链接脚本。★第1次出现（概念级）",
 "第23章（系统调试方法论）会深入分析elf文件结构和链接过程，第7章（启动链深度解析）会涉及裸机链接脚本。★第1次出现（概念级）"),
# ---- 第3章 ----
("第III部会深入到U-Boot驱动模型、命令开发、启动脚本优化；第II部第8章会涉及U-Boot中的硬件初始化代码。",
 "第16章（内核版本与启动架构设计）会讨论启动架构层面的U-Boot定制，第24章（启动全链路优化）会深入启动脚本优化；第7章（启动链深度解析）会涉及U-Boot中的硬件初始化代码。"),
("第II部第7章会分析具体SoC的BootROM行为（如i.MX的ROM loader、Rockchip的miniloader）；第III部会涉及Secure Boot chain中每个阶段的签名验证。★第1次出现（概念级）",
 "第7章（启动链深度解析）会分析具体SoC的BootROM行为（如i.MX的ROM loader、Rockchip的miniloader）；第19章（安全架构设计）和第29章（安全全链路）会涉及Secure Boot chain中每个阶段的签名验证。★第1次出现（概念级）"),
("第II部第8章（驱动开发）会自己编写设备树绑定和驱动匹配逻辑；第III部会调试设备树解析问题。★第1次出现（操作级）",
 "第11章（设备模型）会亲手写带设备树的驱动（11.0/11.1）并深入绑定与匹配机制（11.3），第23章（系统调试方法论）会调试设备树解析问题。★第1次出现（操作级）"),
("第III部（调试与维护）会深入NFS rootfs的排错和网络启动的安全性考量。★第1次出现（操作级）",
 "第23章（系统调试方法论）会深入NFS rootfs的排错，第29章（安全全链路）会涉及网络启动的安全性考量。★第1次出现（操作级）"),
("第III部会自定义U-Boot命令、环境变量持久化、脚本化启动流程。★第1次出现（操作级）",
 "第24章（启动全链路优化）会涉及环境变量持久化与脚本化启动流程。★第1次出现（操作级）"),
("本节不深入绑定文档（binding）规范——那是第II部的事。",
 "本节不深入绑定文档（binding）规范——那是第11章（11.3）的事。"),
# ---- 第4章 ----
("第6章的LED驱动需要内核配置中启用GPIO子系统；第II部第7章将深入内核子系统实现。",
 "第6章的LED驱动需要内核配置中启用GPIO子系统；第二部（第7-15章）将深入内核子系统实现。"),
("第II部第7章在编写驱动时会创建自己的Kconfig条目和Makefile；第IV部会分析配置对二进制体积和启动时间的影响。★第1次出现（操作级）",
 "第11章（11.0）在编写驱动时会创建自己的Kconfig条目和Makefile；第24章（启动全链路优化）会分析配置对二进制体积和启动时间的影响。★第1次出现（操作级）"),
("第II部第8章会编写自己的内核模块；第III部会调试模块加载失败和符号依赖问题。★第1次出现（概念级）",
 "第11章（11.0）会编写自己的内核模块；第23章（系统调试方法论）会调试模块加载失败和符号依赖问题。★第1次出现（概念级）"),
("第III部会配置console loglevel、使用dynamic debug、分析oops日志。★第1次出现（操作级）",
 "第23章（系统调试方法论）会配置console loglevel、使用dynamic debug、分析oops日志。★第1次出现（操作级）"),
("第II部第6章（构建系统）会在Buildroot/Yocto中管理自定义defconfig；第IV部会分析配置差异对启动时间和内存占用的影响。★第1次出现（操作级）",
 "第18章（构建系统设计）会在Buildroot/Yocto中管理自定义defconfig；第24章（启动全链路优化）会分析配置差异对启动时间和内存占用的影响。★第1次出现（操作级）"),
("内核内部机制将在第II部第7章作为”深入理解”展开。",
 "内核内部机制将在第二部（第7-15章）作为”深入理解”展开。"),
# ---- 第5章 ----
("第II部第6章会用Buildroot/Yocto替代手动BusyBox构建；第III部会涉及根文件系统的只读保护和更新机制。",
 "第18章（构建系统设计）会用Buildroot/Yocto替代手动BusyBox构建；第17章（存储架构设计）和第21章（OTA与更新架构设计）会涉及根文件系统的只读保护和更新机制。"),
("本章是手工构建根文件系统（理解原理）；第II部是用构建系统自动化（工程化）；第III部是根文件系统的维护和可靠性（工业化）。",
 "本章是手工构建根文件系统（理解原理）；第18章是用构建系统自动化（工程化）；第21章（OTA与更新架构设计）与第30章（可靠性工程）是根文件系统的维护和可靠性（工业化）。"),
("第II部第6章会在Yocto中自定义FHS布局；第III部会涉及只读rootfs和overlayfs的联合挂载。★第1次出现（概念级）",
 "第18章（构建系统设计）会在Yocto中自定义FHS布局；第17章（存储架构设计）会涉及只读rootfs和overlayfs的联合挂载。★第1次出现（概念级）"),
("第II部第9章会对比systemd的启动流程（target、unit、socket激活）；第III部会调试启动时间优化。★第1次出现（概念级）",
 "第7章（7.6 init进程与系统初始化）会对比systemd的启动流程（target、unit、socket激活）；第24章（启动全链路优化）会深入启动时间优化。★第1次出现（概念级）"),
("第II部第8章在写驱动时会理解mknod和devtmpfs自动创建设备节点的机制；第III部会涉及udev规则。★第1次出现（概念级）",
 "第11章（11.0实操、11.5机制）会理解mknod和devtmpfs自动创建设备节点的机制；第23章（系统调试方法论）会涉及udev规则。★第1次出现（概念级）"),
("第II部第6章处理交叉编译的动态库依赖；第IV部会优化库体积。★第1次出现（操作级）",
 "第18章（构建系统设计）会处理交叉编译的动态库依赖并讨论库体积优化。★第1次出现（操作级）"),
("systemd将在第II部第9章详细介绍。",
 "systemd将在第7章（7.6）详细介绍。"),
("Buildroot将在第II部作为工程化工具引入。",
 "Buildroot将在第18章（构建系统设计）作为工程化工具引入。"),
# ---- 第6章 ----
("GPIO子系统（第II部驱动开发）、设备树绑定（第II部设备模型）、sysfs接口（第III部用户空间接口）",
 "GPIO子系统与设备树绑定（第11章设备模型）、sysfs接口（第11章11.5）"),
("第II部第8章将深入字符设备驱动框架，编写.ko模块；第II部第7章将深入GPIO子系统的内核实现（gpiochip、gpiolib）；第III部会涉及设备树调试和驱动probe失败排查。",
 "第11章（11.0/11.1）将亲手编写字符设备驱动.ko模块；第11章（11.2）将深入GPIO子系统的内核管理框架（gpiochip、gpiolib）；第11章排错指南与第23章（系统调试方法论）会涉及设备树调试和驱动probe失败排查。"),
("本章是”用户空间操作GPIO→加载现成驱动”；第II部是”编写驱动”；第III部是”调试和优化驱动”。",
 "本章是”用户空间操作GPIO→加载现成驱动”；第11章是”编写驱动”；第22章（驱动架构设计）与第23章（系统调试方法论）是”设计和调试驱动”。"),
("第II部第8章会编写gpiochip驱动、理解gpiolib的descriptor-based API（gpio_desc取代gpio_num）；第IV部会涉及GPIO性能优化和中断驱动输入。★第1次出现（操作级）",
 "第11章（11.2）与第22章（驱动架构设计）会深入gpiochip驱动框架和gpiolib的descriptor-based API（gpio_desc取代gpio_num）；第10章（中断与时间）会涉及中断驱动输入。★第1次出现（操作级）"),
("第II部第8章会深入设备树绑定文档（binding）、理解compatible字符串匹配机制、编写驱动中的of_device_id表；第III部会调试设备树overlay和动态加载。★第2次出现",
 "第11章（11.3）会深入设备树绑定文档（binding）、理解compatible字符串匹配机制、编写驱动中的of_device_id表；第11章（11.6）与第23章会涉及设备树overlay和动态加载。★第2次出现"),
("第II部第8章会在驱动中创建自定义sysfs属性（device_attribute）；第III部会涉及sysfs与debugfs的区别和选型。★第1次出现（操作级）",
 "第11章（11.5）会在驱动中创建自定义sysfs属性（device_attribute）；第23章（系统调试方法论）会涉及sysfs与debugfs的区别和选型。★第1次出现（操作级）"),
("第II部第8章会深入module_init、platform_driver、probe/remove机制；第IV部会分析驱动加载时序和延迟。★第1次出现（概念级）",
 "第11章（11.0实操、11.2/11.3机制）会深入module_init、platform_driver、probe/remove机制；第24章（启动全链路优化）会分析驱动加载时序和延迟。★第1次出现（概念级）"),
("为第II部引入character device（/dev/gpiochip0 + ioctl）做铺垫",
 "为第11章引入character device（/dev/gpiochip0 + ioctl）做铺垫"),
("预告第II部将学习的内容：自己写一个platform_driver、实现probe/remove函数、注册字符设备节点。",
 "预告第11章将学习的内容：自己写一个platform_driver（11.0）、实现probe/remove函数、注册字符设备节点（11.1）。"),
("——这正是第II部的起点。", "——这正是第11章的起点。"),
("这些是第II部的内容。在第6章", "这些是第11章的内容。在第6章"),
("为第II部打开这个黑盒做好了心理准备。", "为第11章打开这个黑盒做好了心理准备。"),
("第II部将回答：“那个让LED亮起来的驱动是怎么写的？”——这是完美的螺旋上升。",
 "第11章（11.0）将回答：“那个让LED亮起来的驱动是怎么写的？”——这是完美的螺旋上升。"),
# ---- 问题之门 ----
("→ 第II部第7章：设备树深入与内存管理子系统",
 "→ 第9章（内存管理）与第11章（设备树解析，11.2）"),
("→ 第II部第8章：字符设备驱动开发",
 "→ 第11章：11.0亲手写驱动 → 11.2机制解析"),
("→ 第II部第6章：Buildroot与Yocto构建系统",
 "→ 第18章：构建系统设计（Buildroot与Yocto）"),
("→ 第II部第9章：系统服务与进程管理",
 "→ 第8章（进程与调度）与第18章（用Buildroot添加软件包）"),
("→ 第II部第7章：内核子系统深入",
 "→ 第7章（启动链深度解析）与第23章（系统调试方法论）"),
("→ 第II部第8章：字符设备接口与ioctl",
 "→ 第11章（11.1）：字符设备接口与ioctl"),
]

doc = Document(PATH)
paras = doc.paragraphs

# 定位第一部范围
start = end = None
for i, p in enumerate(paras):
    t = p.text.strip()
    if p.style.name == 'Heading 1' and t.startswith('第一部'):
        start = i
    elif p.style.name == 'Heading 1' and t.startswith('第二部') and start is not None:
        end = i
        break
print(f'第一部范围: {start}-{end}')

def replace_in_paragraph(p, old, new):
    """优先run级替换；跨run时整段重建（保留第一个非空run的格式）。"""
    for r in p.runs:
        if old in r.text:
            r.text = r.text.replace(old, new)
            return True
    full = p.text
    if old in full:
        # 跨run：整段重建
        newfull = full.replace(old, new)
        if p.runs:
            p.runs[0].text = newfull
            for r in p.runs[1:]:
                r.text = ''
        return True
    return False

applied = {old: 0 for old, _ in REPL}
cross_run = []
for i in range(start, end):
    p = paras[i]
    for old, new in REPL:
        if old in p.text:
            # 检查是否单run可替换
            single = any(old in r.text for r in p.runs)
            if replace_in_paragraph(p, old, new):
                applied[old] += 1
                if not single:
                    cross_run.append((i, old[:40]))

missing = [old[:60] for old, _ in REPL if applied[old] == 0]
print(f'\n替换规则: {len(REPL)} 条')
print(f'成功应用: {sum(1 for v in applied.values() if v > 0)} 条')
print(f'跨run重建: {len(cross_run)} 处')
for i, s in cross_run:
    print(f'  段落{i}: {s}')
if missing:
    print('\n!! 未命中的规则:')
    for m in missing:
        print('  ', m)
else:
    print('全部规则命中。')

OUT = PATH.replace('.docx', '_v2_引用已回填.docx')
try:
    doc.save(PATH)
    print('\n已保存:', PATH)
except PermissionError:
    doc.save(OUT)
    print('\n!! 原文件被占用（Word 打开中），已另存为:', OUT)
