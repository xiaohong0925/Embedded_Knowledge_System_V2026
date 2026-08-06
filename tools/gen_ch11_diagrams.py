# -*- coding: utf-8 -*-
"""批量生成第11章缺失流程图（9张），统一技术风格。"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.executable).parent.parent.parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Polygon
from daimon_runtime import setup_plot

setup_plot()

IMGDIR = Path(r"docs/02-核心机制深度解析/第11章 设备模型/images")
BLUE, RED, GRAY = "#2f5b95", "#c0392b", "#666666"
FACE_B, FACE_R, FACE_G, FACE_Y = "#eaf1fb", "#fdeeee", "#eef7ee", "#fdf6e3"


def canvas(w, h, title, subtitle=None):
    fig, ax = plt.subplots(figsize=(w, h), dpi=150)
    ax.set_xlim(0, w); ax.set_ylim(0, h); ax.axis("off")
    ax.text(w / 2, h - 0.5, title, ha="center", va="center",
            fontsize=19, fontweight="bold", color="#1a1a1a")
    if subtitle:
        ax.text(w / 2, h - 0.95, subtitle, ha="center", va="center",
                fontsize=11, color=GRAY)
    return fig, ax


def box(ax, x, y, w, h, title, sub=None, face=FACE_B, edge=BLUE, tfs=13, sfs=9.5, sub2=None):
    ax.add_patch(FancyBboxPatch((x, y), w, h,
                                boxstyle="round,pad=0.04,rounding_size=0.1",
                                fc=face, ec=edge, lw=1.5))
    cy = y + h / 2
    if sub is None and sub2 is None:
        ax.text(x + w / 2, cy, title, ha="center", va="center",
                fontsize=tfs, fontweight="bold", color="#1a1a1a")
    else:
        ax.text(x + w / 2, y + h * 0.72, title, ha="center", va="center",
                fontsize=tfs, fontweight="bold", color="#1a1a1a")
        ax.text(x + w / 2, y + h * 0.40, sub, ha="center", va="center",
                fontsize=sfs, color="#444444")
        if sub2:
            ax.text(x + w / 2, y + h * 0.16, sub2, ha="center", va="center",
                    fontsize=sfs, color="#888888")


def varrow(ax, x, y1, y2, color=BLUE, label=None, lx=0.15):
    ax.add_patch(FancyArrowPatch((x, y1), (x, y2), arrowstyle="-|>",
                                 mutation_scale=18, lw=1.7, color=color))
    if label:
        ax.text(x + lx, (y1 + y2) / 2, label, ha="left", va="center",
                fontsize=9.5, color=color)


def harrow(ax, x1, x2, y, color=BLUE, label=None, ly=0.12):
    ax.add_patch(FancyArrowPatch((x1, y), (x2, y), arrowstyle="-|>",
                                 mutation_scale=18, lw=1.7, color=color))
    if label:
        ax.text((x1 + x2) / 2, y + ly, label, ha="center", va="bottom",
                fontsize=9.5, color=color)


def save(fig, name):
    out = IMGDIR / name
    fig.savefig(out, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("saved:", name)


# ============ 1. 11.3.1 设备树到 platform_device 流程（含 status 分支） ============
def gen_1131():
    fig, ax = canvas(11, 11.5, "从 .dts 到 platform_device 的创建流程")
    steps = [
        (".dts 源文件", "板级硬件描述，文本形式"),
        ("dtc 编译", "生成 .dtb 二进制"),
        ("内核解析", "展开为 device_node 树（内存中）"),
        ("of_platform_populate()", "启动时遍历 device_node 树"),
    ]
    x, w, h, gap = 3.0, 5.0, 0.85, 0.55
    y = 9.6
    for i, (t, s) in enumerate(steps):
        box(ax, x, y - h, w, h, t, s)
        if i < len(steps) - 1:
            varrow(ax, x + w / 2, y - h - 0.03, y - h - gap + 0.03)
        y -= h + gap
    # 判断菱形
    dy = y - 0.75
    ax.add_patch(Polygon([(x + w / 2, dy + 0.75), (x + w - 0.3, dy),
                         (x + w / 2, dy - 0.75), (x + 0.3, dy)], closed=True,
                        fc=FACE_Y, ec="#b8860b", lw=1.5))
    ax.text(x + w / 2, dy, "status\n属性？", ha="center", va="center",
            fontsize=11, fontweight="bold")
    varrow(ax, x + w / 2, y - h - 0.03, dy + 0.78)
    # okay 分支
    box(ax, 0.6, dy - 2.3, 4.2, 1.0, "创建 platform_device",
        "注册到 platform 总线，等待匹配", FACE_G, "#2e7d32")
    ax.add_patch(FancyArrowPatch((x + 0.3, dy), (2.7, dy - 1.25),
                                 arrowstyle="-|>", mutation_scale=18, lw=1.7,
                                 color="#2e7d32", connectionstyle="arc3,rad=0.15"))
    ax.text(2.2, dy - 0.65, "okay（缺省）", ha="center", fontsize=10,
            color="#2e7d32")
    # disabled 分支
    box(ax, 6.2, dy - 2.3, 4.2, 1.0, "跳过",
        "不创建设备，驱动永远等不到它", FACE_R, RED)
    ax.add_patch(FancyArrowPatch((x + w - 0.3, dy), (8.3, dy - 1.25),
                                 arrowstyle="-|>", mutation_scale=18, lw=1.7,
                                 color=RED, connectionstyle="arc3,rad=-0.15"))
    ax.text(8.8, dy - 0.65, "disabled", ha="center", fontsize=10, color=RED)
    ax.text(5.5, 0.35, "节点存在 ≠ 设备存在：cat /proc/device-tree/ 看到的节点，"
                       "只有 status=okay 才会变成 platform_device",
            ha="center", fontsize=10.5, color="#555555")
    save(fig, "11.3.1-设备树到platform_device流程.png")


# ============ 2. 11.3.2 platform_driver 注册与匹配链路 ============
def gen_1132():
    fig, ax = canvas(11, 10.5, "platform_driver 注册到匹配的调用链")
    chain = [
        "platform_driver_register()",
        "__platform_driver_register()",
        "driver_register()",
        "bus_add_driver()",
        "driver_attach()",
        "platform_match() 逐设备尝试",
    ]
    x, w, h, gap = 0.8, 4.6, 0.8, 0.5
    y = 8.9
    for i, t in enumerate(chain):
        box(ax, x, y - h, w, h, t, face=FACE_B if i < 5 else FACE_G,
            edge=BLUE if i < 5 else "#2e7d32", tfs=11.5)
        if i < len(chain) - 1:
            varrow(ax, x + w / 2, y - h - 0.03, y - h - gap + 0.03)
        y -= h + gap
    # 右侧：匹配优先级
    box(ax, 6.4, 5.6, 4.1, 3.4, "", face="white", edge="#b8860b")
    ax.text(8.45, 8.6, "platform_match 的匹配顺序", ha="center",
            fontsize=13, fontweight="bold", color="#b8860b")
    pri = [("1. OF（设备树）", "of_driver_match_device：compatible 比对"),
           ("2. ACPI", "acpi_driver_match_device"),
           ("3. id_table", "platform_match_id：id 表比对"),
           ("4. name", " drv->name == dev->name 兜底")]
    for i, (a, b) in enumerate(pri):
        ax.text(6.7, 8.1 - i * 0.62, a, ha="left", fontsize=11,
                fontweight="bold", color="#1a1a1a")
        ax.text(6.95, 7.82 - i * 0.62, b, ha="left", fontsize=9, color=GRAY)
    ax.add_patch(FancyArrowPatch((x + w + 0.05, 5.3), (6.35, 5.3),
                                 arrowstyle="-|>", mutation_scale=18, lw=1.7,
                                 color="#b8860b"))
    ax.text(5.85, 5.5, "调用", ha="center", fontsize=9.5, color="#b8860b")
    ax.text(5.5, 0.7, "命中 → really_probe() → drv->probe()；"
                      "insmod 返回只说明模块加载，不代表匹配命中任何设备",
            ha="center", fontsize=10.5, color="#555555")
    save(fig, "11.3.2-platform_driver注册与匹配流程.png")


# ============ 3. 11.3.5 probe 失败排查树 ============
def gen_1135():
    fig, ax = canvas(12, 8.5, "probe 失败排查树")
    box(ax, 4.6, 6.5, 2.8, 1.0, "probe 未执行 / 失败", face=FACE_R, edge=RED)
    branches = [
        ("设备未注册", "ls /sys/bus/platform/devices/\ncat /proc/device-tree/ 查节点", FACE_B, BLUE),
        ("匹配失败", "cat .../compatible 逐字符对比\nreadlink .../driver 查被谁绑走", FACE_B, BLUE),
        ("资源获取失败", "dmesg 查 -EPROBE_DEFER\ndev_err_probe 打印的错误码", FACE_B, BLUE),
        ("时钟/电源未使能", "确认 clk/regulator 供应方驱动\n已就绪（看其 probe 日志）", FACE_B, BLUE),
        ("硬件初始化错误", "先读 ID 寄存器核对 datasheet\n区分\"没起来\"与\"配置错\"", FACE_B, BLUE),
    ]
    bw, bh, gap = 2.1, 1.5, 0.25
    x0 = 0.5
    y = 3.4
    for i, (t, c, f, e) in enumerate(branches):
        x = x0 + i * (bw + gap)
        box(ax, x, y, bw, bh, t, None, f, e, tfs=11)
        ax.text(x + bw / 2, y - 0.25, c, ha="center", va="top",
                fontsize=8.5, color="#444444")
        ax.add_patch(FancyArrowPatch((6.0, 6.5), (x + bw / 2, y + bh + 0.03),
                                     arrowstyle="-|>", mutation_scale=15,
                                     lw=1.4, color=e,
                                     connectionstyle=f"arc3,rad={(i - 2) * 0.08}"))
    ax.text(6, 5.95, "四步反推：驱动注册了吗 → 设备存在吗 → 匹配条件满足吗 → 资源就绪吗",
            ha="center", fontsize=11, fontweight="bold", color="#1a1a1a")
    ax.text(6, 1.0, "原则：先确认故障发生在旅程的哪一段，再深入该段的细节，"
                    "不要从驱动的第一行代码开始通读",
            ha="center", fontsize=10.5, color="#555555")
    save(fig, "11.3.5-probe失败排查树.png")


# ============ 4. 11.4.1 compatible 匹配流程（循环+分支） ============
def gen_1141():
    fig, ax = canvas(11, 10, "compatible 字符串的匹配流程")
    box(ax, 1.0, 7.85, 4.4, 1.2, "设备树节点",
        'compatible = "vendor,board-chip",\n"vendor,chip", "soc-family"',
        FACE_B, BLUE, tfs=13, sfs=9)
    box(ax, 6.6, 7.85, 3.6, 1.2, "总线上的驱动们",
        "各自的 of_match_table\n声明支持的字符串",
        FACE_B, BLUE, tfs=13, sfs=9.5)
    varrow(ax, 3.2, 7.8, 7.25)
    varrow(ax, 8.4, 7.8, 7.25)
    box(ax, 2.6, 5.9, 5.8, 1.3, "按 compatible 列表顺序取字符串",
        "从第 1 个（最具体）开始，逐个尝试", FACE_Y, "#b8860b")
    box(ax, 2.6, 4.3, 5.8, 1.1, "遍历已注册驱动的 of_match_table",
        "of_driver_match_device() 逐一字符串比较", FACE_B, BLUE)
    varrow(ax, 5.5, 5.85, 5.45)
    # 分支
    box(ax, 0.7, 1.9, 4.2, 1.2, "匹配成功", "绑定设备 → really_probe()\n→ drv->probe()",
        FACE_G, "#2e7d32")
    box(ax, 6.1, 1.9, 4.2, 1.2, "该字符串无驱动认领",
        "取列表下一个字符串，回到上一步", FACE_R, RED)
    ax.add_patch(FancyArrowPatch((4.0, 4.25), (2.8, 3.15), arrowstyle="-|>",
                                 mutation_scale=18, lw=1.7, color="#2e7d32",
                                 connectionstyle="arc3,rad=0.2"))
    ax.add_patch(FancyArrowPatch((7.0, 4.25), (8.2, 3.15), arrowstyle="-|>",
                                 mutation_scale=18, lw=1.7, color=RED,
                                 connectionstyle="arc3,rad=-0.2"))
    # 回环
    ax.add_patch(FancyArrowPatch((10.3, 2.5), (8.45, 5.0), arrowstyle="-|>",
                                 mutation_scale=18, lw=1.7, color=RED, ls="--",
                                 connectionstyle="arc3,rad=-0.35"))
    ax.text(5.5, 1.2, "全部字符串都失败：设备保持未绑定状态（不报错、不 probe）",
            ha="center", fontsize=10.5, color=RED)
    ax.text(5.5, 0.55, "列表顺序即优先级：最具体的 compatible 必须写在最前面",
            ha="center", fontsize=10.5, color="#555555")
    save(fig, "11.4.1-compatible匹配流程.png")


# ============ 5. 11.5.2 uevent 生命周期时序 ============
def gen_1152():
    fig, ax = canvas(12, 9.5, "uevent 生命周期：从设备注册到 /dev 节点")
    parts = ["驱动 / 内核", "kobject", "netlink", "udevd", "/dev"]
    xs = [1.3, 3.9, 6.1, 8.3, 10.5]
    for p, x in zip(parts, xs):
        box(ax, x - 0.85, 7.9, 1.7, 0.7, p, tfs=11)
        ax.plot([x, x], [1.6, 7.85], ls=":", lw=1, color="#bbbbbb")
    msgs = [
        (1.3, 3.9, 7.3, "device_register()", BLUE),
        (3.9, 6.1, 6.5, "kobject_uevent(KOBJ_ADD)", BLUE),
        (6.1, 8.3, 5.7, "广播 uevent 消息", BLUE),
        (8.3, 10.5, 4.9, "规则匹配 → mknod 创建节点", "#2e7d32"),
        (1.3, 3.9, 3.6, "device_unregister()（rmmod）", RED),
        (3.9, 6.1, 2.8, "kobject_uevent(KOBJ_REMOVE)", RED),
        (8.3, 10.5, 2.1, "删除 /dev 节点", RED),
    ]
    for x1, x2, y, label, c in msgs:
        harrow(ax, x1 + 0.05, x2 - 0.05, y, color=c, label=label, ly=0.10)
    ax.text(1.2, 4.35, "加载路径", ha="left", fontsize=10.5,
            fontweight="bold", color=BLUE)
    ax.text(1.2, 1.7, "卸载路径", ha="left", fontsize=10.5,
            fontweight="bold", color=RED)
    ax.text(6, 0.7, "时间自上而下。udevadm monitor 可实时观察这两条路径上的事件",
            ha="center", fontsize=10.5, color="#555555")
    save(fig, "11.5.2-uevent生命周期时序.png")


# ============ 6. 11.6.1 overlay 与传统方式对比 ============
def gen_1161():
    fig, ax = canvas(12, 8, "运行时改硬件描述：传统方式 vs overlay")
    # 左栏
    box(ax, 0.6, 6.2, 5.2, 0.7, "传统方式：改一次设备树", face=FACE_R, edge=RED)
    left = ["修改 .dts", "重新编译 dtb", "重新烧录", "重启系统", "设备上线"]
    y = 5.3
    for i, t in enumerate(left):
        box(ax, 1.2, y - 0.62, 4.0, 0.62, t, face="white", edge=RED, tfs=11)
        if i < len(left) - 1:
            varrow(ax, 3.2, y - 0.64, y - 0.83, color=RED)
        y -= 0.85
    # 右栏
    box(ax, 6.2, 6.2, 5.2, 0.7, "overlay 方式：不重启增删设备", face=FACE_G, edge="#2e7d32")
    right = ["编写 overlay .dts", "dtc -@ 编译为 .dtbo",
             "configfs 运行时加载", "动态合并进内核", "设备立即上线"]
    y = 5.3
    for i, t in enumerate(right):
        box(ax, 6.8, y - 0.62, 4.0, 0.62, t, face="white", edge="#2e7d32", tfs=11)
        if i < len(right) - 1:
            varrow(ax, 8.8, y - 0.64, y - 0.83, color="#2e7d32")
        y -= 0.85
    # 底部场景
    box(ax, 1.6, 0.35, 3.8, 0.75, "场景：FPGA 动态重配置", face=FACE_Y,
        edge="#b8860b", tfs=11)
    box(ax, 6.6, 0.35, 3.8, 0.75, "场景：扩展板热插拔", face=FACE_Y,
        edge="#b8860b", tfs=11)
    ax.plot([5.98, 5.98], [0.5, 6.9], ls="--", lw=1, color="#cccccc")
    save(fig, "11.6.1-overlay与传统方式对比.png")


# ============ 7. 11.6.2 dtbo 编译与加载流程 ============
def gen_1162():
    fig, ax = canvas(11, 10, "dtbo 的编译与运行时加载")
    # 上半：编译
    box(ax, 0.8, 8.6, 9.4, 0.65, "① 编译：dtc 的 -@ 选项生成带符号的 dtbo",
        face=FACE_B, edge=BLUE, tfs=12)
    steps1 = [("overlay .dts", "含 /plugin/ 与\n__fixups__ 引用"),
              ("dtc -@ 编译", "保留 __symbols__\n符号表"),
              (".dtbo", "可被运行时合并的\n二进制片段")]
    xs = [1.0, 4.3, 7.6]
    for (t, s), x in zip(steps1, xs):
        box(ax, x, 6.9, 2.4, 1.3, t, s, FACE_B, BLUE, tfs=11.5, sfs=9)
    harrow(ax, 3.42, 4.28, 7.55)
    harrow(ax, 6.72, 7.58, 7.55)
    # 下半：加载
    box(ax, 0.8, 6.0, 9.4, 0.65, "② 加载：configfs 接口触发的合并链",
        face=FACE_G, edge="#2e7d32", tfs=12)
    steps2 = ["configfs 加载 dtbo", "符号解析", "节点合并进 live tree",
              "of_reconfig 通知", "新增 platform_device", "触发 probe"]
    y = 5.3
    for i, t in enumerate(steps2):
        box(ax, 3.4, y - 0.62, 4.2, 0.62, t, face="white", edge="#2e7d32", tfs=11)
        if i < len(steps2) - 1:
            varrow(ax, 5.5, y - 0.64, y - 0.76, color="#2e7d32")
        y -= 0.78
    varrow(ax, 5.5, 6.85, 6.68, color="#555555", label=None)
    save(fig, "11.6.2-dtbo编译与加载流程.png")


# ============ 8. 11.99 设备模型知识图谱 ============
def gen_1199_map():
    fig, ax = canvas(12.5, 9.5, "设备模型知识图谱：六大模块的关联")
    # 顶层三角色
    box(ax, 0.7, 7.0, 3.6, 1.6, "总线层", "bus_type\n设备链表 / 驱动链表 / match()",
        FACE_B, BLUE)
    box(ax, 4.7, 7.0, 3.6, 1.6, "设备层", "device → platform_device\n硬件资源描述（reg/irq）",
        FACE_G, "#2e7d32")
    box(ax, 8.7, 7.0, 3.6, 1.6, "驱动层", "device_driver → platform_driver\nprobe/remove + of_match_table",
        FACE_G, "#2e7d32")
    harrow(ax, 4.32, 4.68, 7.8, label="维护")
    harrow(ax, 8.32, 8.68, 7.8, label="维护")
    ax.text(6.5, 6.55, "match() 配对成功 → probe()", ha="center",
            fontsize=11, fontweight="bold", color="#1a1a1a")
    # 中层基础设施
    box(ax, 2.6, 4.4, 4.2, 1.5, "kobject 基础设施",
        "kobject / kset / kobj_type\n命名、层次、引用计数", FACE_Y, "#b8860b")
    box(ax, 7.2, 4.4, 4.6, 1.5, "sysfs 投影",
        "kobject 树 → /sys 目录树\n属性文件 ↔ show()/store()", FACE_Y, "#b8860b")
    varrow(ax, 4.7, 7.0, 5.95, color="#b8860b", label=None)
    varrow(ax, 10.5, 7.0, 5.95, color="#b8860b", label=None)
    harrow(ax, 6.82, 7.18, 5.15, color="#b8860b", label="映射")
    # 底层两条外延
    box(ax, 0.7, 1.6, 5.2, 1.7, "uevent 生命周期",
        "KOBJ_ADD/REMOVE → netlink 广播\n→ udevd 匹配规则 → 创建 /dev 节点",
        FACE_R, RED)
    box(ax, 6.6, 1.6, 5.2, 1.7, "DT overlay 机制",
        "dtbo → 运行时合并 live tree\n→ of_reconfig 通知 → 新增设备 → probe",
        FACE_R, RED)
    varrow(ax, 4.0, 4.4, 3.35, color=RED)
    varrow(ax, 9.0, 4.4, 3.35, color=RED)
    ax.text(6.25, 0.7, "三个角色配对是骨架，kobject 是地基，sysfs/uevent 是对用户空间的出口，overlay 是运行时入口",
            ha="center", fontsize=10.5, color="#555555")
    save(fig, "11.99-设备模型知识图谱.png")


# ============ 9. 11.99 调用链时序 ============
def gen_1199_seq():
    fig, ax = canvas(12.5, 12.5, "从 insmod 到 /dev 节点：完整调用链时序")
    parts = ["用户空间", "注册链", "匹配链", "驱动", "用户接口"]
    xs = [1.4, 4.0, 6.4, 8.8, 11.1]
    for p, x in zip(parts, xs):
        box(ax, x - 0.95, 10.85, 1.9, 0.65, p, tfs=11)
        ax.plot([x, x], [0.9, 10.8], ls=":", lw=1, color="#bbbbbb")
    msgs = [
        (1.4, 4.0, 10.25, "insmod → platform_driver_register()", BLUE),
        (4.0, 4.0, 10.0, "driver_register() → bus_add_driver() → driver_attach()", None),
        (4.0, 6.4, 9.4, "bus_match() → platform_match()", BLUE),
        (6.4, 6.4, 8.8, "of_driver_match_device()", None),
        (6.4, 8.8, 8.2, "really_probe() → drv->probe()", "#2e7d32"),
        (8.8, 11.1, 7.4, "sysfs_create_group()：/sys 属性就绪", "#2e7d32"),
        (8.8, 11.1, 6.6, "kobject_uevent(KOBJ_ADD)", BLUE),
        (11.1, 11.1, 6.0, "netlink 广播 → udevd 匹配规则", None),
        (11.1, 11.1, 5.4, "创建 /dev 节点", "#2e7d32"),
    ]
    for x1, x2, y, label, c in msgs:
        if x1 == x2:
            ax.text(x1 + 0.1, y, label, ha="left", va="center",
                    fontsize=9.5, color=c or "#444444")
        else:
            harrow(ax, x1 + 0.05, x2 - 0.05, y, color=c or BLUE,
                   label=label, ly=0.10)
    # overlay 并线
    ax.add_patch(FancyBboxPatch((0.7, 1.6), 11.3, 2.6,
                                boxstyle="round,pad=0.05", fc="#fdf6e3",
                                ec="#b8860b", lw=1.3, ls="--"))
    ax.text(1.0, 3.9, "并线：DT overlay 路径（运行时入口）", ha="left",
            fontsize=11, fontweight="bold", color="#b8860b")
    overlay_msgs = [
        (1.4, 4.0, 3.3, "of_overlay_apply()", "#b8860b"),
        (4.0, 6.4, 2.7, "of_reconfig 通知 → 合并 live tree", "#b8860b"),
        (6.4, 8.8, 2.1, "新增 platform_device → device_register()", "#b8860b"),
    ]
    for x1, x2, y, label, c in overlay_msgs:
        harrow(ax, x1 + 0.05, x2 - 0.05, y, color=c, label=label, ly=0.10)
    ax.text(8.95, 1.75, "同样走到 driver_attach → probe（汇入主线）",
            ha="left", fontsize=9.5, color="#b8860b")
    ax.text(6.25, 0.55, "时间自上而下；两条路径共享同一套匹配与 probe 机制",
            ha="center", fontsize=10.5, color="#555555")
    save(fig, "11.99-设备模型调用链时序.png")


if __name__ == "__main__":
    gen_1131(); gen_1132(); gen_1135(); gen_1141(); gen_1152()
    gen_1161(); gen_1162(); gen_1199_map(); gen_1199_seq()
    print("全部完成")
