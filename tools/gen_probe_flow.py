# -*- coding: utf-8 -*-
"""生成 11.3.3 probe 六步流程图（技术流程图风格，CJK）"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.executable).parent.parent.parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from daimon_runtime import setup_plot

setup_plot()

STEPS = [
    ("①", "取资源", "platform_get_resource / platform_get_irq", "来源：设备树 reg / interrupts 属性"),
    ("②", "取时钟并使能", "devm_clk_get + clk_prepare_enable", "未使能则寄存器读写无效"),
    ("③", "取电源并使能", "devm_regulator_get + regulator_enable", "未配 supply 时返回 dummy regulator"),
    ("④", "IO 映射", "devm_ioremap_resource", "仲裁占用 + 建立页表映射"),
    ("⑤", "注册子系统", "alloc_chrdev_region + cdev_add", "设备对用户空间可见"),
    ("⑥", "初始化硬件", "readl 验证 ID → writel 配置", "先读验证，分离两类故障"),
]

BOX_H, BOX_W = 1.18, 8.6
GAP = 0.62
X0, X1 = 1.2, 1.2 + BOX_W
C_BOX, C_EDGE, C_NUM = "#eaf1fb", "#2f5b95", "#2f5b95"
C_DIV = "#c0392b"

fig_h = len(STEPS) * (BOX_H + GAP) + 2.4
fig, ax = plt.subplots(figsize=(11, fig_h), dpi=150)
ax.set_xlim(0, 11)
ax.set_ylim(0, fig_h)
ax.axis("off")

ax.text(5.5, fig_h - 0.55, "probe() 六步标准流程", ha="center", va="center",
        fontsize=21, fontweight="bold", color="#1a1a1a")
ax.text(5.5, fig_h - 1.05, "顺序由依赖关系决定，不是约定俗成的习惯", ha="center", va="center",
        fontsize=12, color="#666666")

top = fig_h - 1.5
ys = []
for i, (num, title, api, note) in enumerate(STEPS):
    y = top - i * (BOX_H + GAP) - BOX_H
    ys.append(y)
    # ⑤⑥ 用略不同的底色，直观区分托管/非托管
    face = C_BOX if i < 4 else "#fdeeee"
    edge = C_EDGE if i < 4 else C_DIV
    box = FancyBboxPatch((X0, y), BOX_W, BOX_H,
                         boxstyle="round,pad=0.06,rounding_size=0.12",
                         fc=face, ec=edge, lw=1.6)
    ax.add_patch(box)
    ax.text(X0 + 0.45, y + BOX_H / 2, num, ha="center", va="center",
            fontsize=20, fontweight="bold", color=edge)
    ax.text(X0 + 1.0, y + BOX_H * 0.78, title, ha="left", va="center",
            fontsize=15, fontweight="bold", color="#1a1a1a")
    ax.text(X0 + 1.0, y + BOX_H * 0.46, api, ha="left", va="center",
            fontsize=11.5, color="#2f5b95" if i < 4 else "#7a3b34")
    ax.text(X0 + 1.0, y + BOX_H * 0.17, note, ha="left", va="center",
            fontsize=10, color="#888888")

# 箭头
for i in range(len(STEPS) - 1):
    y_from = ys[i]
    y_to = ys[i + 1] + BOX_H
    ax.add_patch(FancyArrowPatch((5.5, y_from - 0.04), (5.5, y_to + 0.04),
                                 arrowstyle="-|>", mutation_scale=22,
                                 lw=1.8, color="#2f5b95"))

# 托管分界线（④ 与 ⑤ 之间）
y_div = (ys[3] + ys[4] + BOX_H) / 2
ax.plot([0.55, 10.45], [y_div, y_div], ls="--", lw=1.4, color=C_DIV, alpha=0.85)
ax.text(10.5, y_div + 0.10, "↑ devm 托管资源：失败直接返回，内核统一清理",
        ha="right", va="bottom", fontsize=10.5, color=C_DIV,
        bbox=dict(fc="white", ec="none", pad=1))
ax.text(10.5, y_div - 0.10, "↓ 非托管资源：每步失败都要手动回收已申请部分",
        ha="right", va="top", fontsize=10.5, color=C_DIV,
        bbox=dict(fc="white", ec="none", pad=1))

# 底部注释
ax.text(5.5, 0.55, "依赖未就绪（时钟源/电源驱动未 probe）时返回 -EPROBE_DEFER，原样传回内核，稍后重试",
        ha="center", va="center", fontsize=11, color="#555555")

out = Path(r"docs/02-核心机制深度解析/第11章 设备模型/images/11.3.3-probe六步流程.png")
fig.savefig(out, bbox_inches="tight", facecolor="white")
print("saved:", out)
