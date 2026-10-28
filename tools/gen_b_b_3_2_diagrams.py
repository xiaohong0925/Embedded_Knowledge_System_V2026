# -*- coding: utf-8 -*-
"""B-B.3.2 I2C 协议层与帧格式：4 张时序图生成脚本。
SDA 蓝色、SCL 深灰；START/STOP/Sr 绿色、ACK 橙色、NACK 红色。
所有图均以 0x50 设备、0xAB 数据为例，逐位真实电平绘制。
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# CJK 字体回退链
for f in ["Noto Sans CJK SC", "Microsoft YaHei", "SimHei", "WenQuanYi Zen Hei"]:
    try:
        matplotlib.font_manager.findfont(f, fallback_to_default=False)
        plt.rcParams["font.sans-serif"] = [f]
        break
    except Exception:
        continue
plt.rcParams["axes.unicode_minus"] = False

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "B. 总线协议",
                   "B. 低速外设接口", "images")
os.makedirs(OUT, exist_ok=True)

SDA_C = "#1565c0"   # 蓝
SCL_C = "#424242"   # 深灰
GREEN = "#2e7d32"
ORANGE = "#e65100"
RED = "#c62828"
GRAY = "#616161"


def draw_tx(fname, title, cells, groups, figsize=(14, 3.4)):
    """cells: (kind, levels, bitlabels, color)
    kind: start/sr/stop/bits/ack/nack；levels 为每位电平列表（start/sr/stop 忽略）
    groups: [(首 cell 序号, 末 cell 序号, 文字, 颜色)] 画在 SCL 下方
    """
    n = len(cells)
    fig, ax = plt.subplots(figsize=figsize, dpi=150)

    # 组织 SDA / SCL 折线
    sda_x, sda_y, scl_x, scl_y = [0], [1], [0], [1]

    def sda_to(x, y):
        if sda_y[-1] != y:
            sda_x.extend([x, x])
            sda_y.extend([sda_y[-1], y])
        else:
            sda_x.append(x)
            sda_y.append(y)

    def scl_to(x, y):
        if scl_y[-1] != y:
            scl_x.extend([x, x])
            scl_y.extend([scl_y[-1], y])
        else:
            scl_x.append(x)
            scl_y.append(y)

    for i, (kind, levels, labels, color) in enumerate(cells):
        x0, x1 = i + 1.0, i + 2.0   # 0~1 为空闲段
        if kind in ("start", "sr"):
            if kind == "sr":
                sda_to(x0, 1)       # 先回高，再在 SCL 高时下降
            sda_to(x0 + 0.5, 0)     # SDA 在 SCL 高电平期间下降
            scl_to(x0, 1)
            scl_to(x1, 1)
        elif kind == "stop":
            sda_to(x0, 0)
            sda_to(x0 + 0.5, 1)     # SDA 在 SCL 高电平期间上升
            scl_to(x0, 1)
            scl_to(x1, 1)
        else:
            lv = levels[0]
            sda_to(x0, lv)
            sda_to(x1, lv)
            scl_to(x0, 0)           # 低半拍
            scl_to(x0 + 0.5, 1)     # 高半拍（采样点）
            scl_to(x1, 0)
        # 位标签
        if labels:
            for j, txt in enumerate(labels):
                cx = x0 + (j + 0.5) / max(len(labels), 1) if len(labels) > 1 else x0 + 0.5
                ax.text(cx, 0.5, txt, ha="center", va="center", fontsize=9.5,
                        color=color if color else GRAY)
        # 单元格底色
        if color:
            ax.axvspan(x0, x1, color=color, alpha=0.08)

    # 尾部空闲
    sda_to(n + 1.6, 1)
    scl_to(n + 1.6, 1)

    ax.plot(sda_x, sda_y, color=SDA_C, lw=1.8)
    ax.plot(scl_x, [y - 2.4 for y in scl_y], color=SCL_C, lw=1.6)

    ax.text(-0.15, 1.0, "SDA", ha="right", va="center", fontsize=11, color=SDA_C)
    ax.text(-0.15, -1.4, "SCL", ha="right", va="center", fontsize=11, color=SCL_C)

    for a, b, txt, color, row in groups:
        ax.text((a + b) / 2 + 1.0, -2.95 - 0.45 * row, txt, ha="center", va="center",
                fontsize=10, color=color if color else GRAY)

    ax.set_title(title, fontsize=12, pad=10)
    ax.set_xlim(-0.7, n + 1.8)
    ax.set_ylim(-3.9, 1.6)
    ax.axis("off")
    fig.tight_layout()
    path = os.path.join(OUT, fname)
    fig.savefig(path, facecolor="white", bbox_inches="tight")
    plt.close(fig)
    print("written:", path)


# ---------- 图 1：一笔完整写通信（0x50 写 0xAB） ----------
cells1 = [
    ("start", None, ["S"], GREEN),
    ("bits", [1, 0, 1, 0, 0, 0, 0, 0], ["A6", "A5", "A4", "A3", "A2", "A1", "A0", "W"], None),
    ("ack", [0], ["A"], ORANGE),
    ("bits", [1, 0, 1, 0, 1, 0, 1, 1], ["D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"], None),
    ("ack", [0], ["A"], ORANGE),
    ("stop", None, ["P"], GREEN),
]
# bits 单元格需按位拆分绘制：把 bits 展开成单 bit 单元
def expand(cells):
    out = []
    for kind, levels, labels, color in cells:
        if kind == "bits":
            for lv, lb in zip(levels, labels):
                out.append(("bit", [lv], [lb], None))
        else:
            out.append((kind, levels, labels, color))
    return out

groups1 = [(0, 0, "START", GREEN, 0),
           (1, 8, "地址帧：0x50 写 → 线上 0xA0", GRAY, 0),
           (9, 9, "ACK", ORANGE, 1),
           (10, 17, "数据帧：0xAB", GRAY, 0),
           (18, 18, "ACK", ORANGE, 1),
           (19, 19, "STOP", GREEN, 0)]
draw_tx("b-b-3-2-full-write.png", "一笔完整的 I2C 写通信：主设备向 0x50 写入 0xAB",
        expand(cells1), groups1, figsize=(15, 3.4))

# ---------- 图 2：START/STOP 与数据稳定规则 ----------
cells2 = [
    ("start", None, ["S"], GREEN),
    ("bits", [1, 0], ["1", "0"], None),
    ("stop", None, ["P"], GREEN),
]
groups2 = [(0, 0, "START", GREEN, 0),
           (1, 2, "数据位", GRAY, 0),
           (3, 3, "STOP", GREEN, 0)]
draw_tx("b-b-3-2-start-stop.png", "START / STOP 与数据位规则：SCL 高电平期间 SDA 必须稳定",
        expand(cells2), groups2, figsize=(9, 3.4))

# ---------- 图 3：ACK 与 NACK 的第 9 拍（上下两幅合一，分左右） ----------
cells3a = [
    ("bits", [1, 0, 1, 0, 1, 0, 1, 1], ["D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"], None),
    ("ack", [0], ["A"], ORANGE),
]
groups3a = [(0, 7, "主设备发完 8 位后放手", GRAY, 0),
            (8, 8, "第 9 拍 ACK", ORANGE, 1)]
draw_tx("b-b-3-2-ack.png", "写方向第 9 拍：从设备拉低 SDA 应答（ACK）",
        expand(cells3a), groups3a, figsize=(10, 3.2))

cells3b = [
    ("bits", [1, 0, 1, 0, 1, 0, 1, 1], ["D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"], None),
    ("nack", [1], ["N"], RED),
    ("stop", None, ["P"], GREEN),
]
groups3b = [(0, 7, "主设备收下最后一字节", GRAY, 0),
            (8, 8, "第 9 拍 NACK", RED, 1),
            (9, 9, "STOP", GREEN, 0)]
draw_tx("b-b-3-2-nack.png", "读方向收尾：主设备回 NACK，从设备释放 SDA，主设备发 STOP",
        expand(cells3b), groups3b, figsize=(11, 3.2))

# ---------- 图 4：读寄存器的重复 START 复合消息 ----------
cells4 = [
    ("start", None, ["S"], GREEN),
    ("bits", [1, 0, 1, 0, 0, 0, 0, 0], ["A6", "A5", "A4", "A3", "A2", "A1", "A0", "W"], None),
    ("ack", [0], ["A"], ORANGE),
    ("bits", [0, 0, 0, 0, 0, 0, 0, 1], ["D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"], None),
    ("ack", [0], ["A"], ORANGE),
    ("sr", None, ["Sr"], GREEN),
    ("bits", [1, 0, 1, 0, 0, 0, 0, 1], ["A6", "A5", "A4", "A3", "A2", "A1", "A0", "R"], None),
    ("ack", [0], ["A"], ORANGE),
    ("bits", [1, 0, 1, 0, 1, 0, 1, 1], ["D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"], None),
    ("nack", [1], ["N"], RED),
    ("stop", None, ["P"], GREEN),
]
groups4 = [(0, 0, "S", GREEN, 0),
           (1, 8, "地址帧 0xA0（写）", GRAY, 0),
           (9, 9, "ACK", ORANGE, 1),
           (10, 17, "寄存器地址 0x01", GRAY, 0),
           (18, 18, "ACK", ORANGE, 1),
           (19, 19, "Sr：不发 STOP，直接换方向", GREEN, 0),
           (20, 27, "地址帧 0xA1（读）", GRAY, 0),
           (28, 28, "ACK", ORANGE, 1),
           (29, 36, "数据 0xAB", GRAY, 0),
           (37, 37, "NACK", RED, 1),
           (38, 38, "P", GREEN, 0)]
draw_tx("b-b-3-2-repeated-start.png",
        "从 0x50 读寄存器 0x01：先写寄存器地址，Sr 换方向，再读数据（重复 START 复合消息）",
        expand(cells4), groups4, figsize=(18, 3.4))
