#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量填充骨架文件 - 第二批"""

import os, glob, sys

BASE = "docs/08-总线协议"

def find_file(rel_pattern):
    """用glob查找文件，返回实际路径"""
    parts = rel_pattern.replace('/', os.sep).split(os.sep)
    current = parts[0]
    for i in range(1, len(parts)):
        if not os.path.isdir(current):
            return None
        candidates = os.listdir(current)
        found = None
        target = parts[i]
        for c in candidates:
            if c == target:
                found = c
                break
        if not found:
            for c in candidates:
                if target.lower() in c.lower() or c.lower() in target.lower():
                    found = c
                    break
        if not found:
            return None
        current = os.path.join(current, found)
    return current

def write_content(path, content):
    with open(path, 'wb') as f:
        f.write(content.encode('utf-8'))
    size = os.path.getsize(path)
    print(f"Wrote {size:5d} bytes -> {path}")
    return size

# ========== 文件4：MDIO 逻辑级与以太网驱动 ==========
content4 = """# MDIO 帧结构与 Linux 以太网 PHY 驱动

<span class="badge-e">[Expert]</span>

---

<span class="red">MDIO（Management Data Input/Output）</span> 是以太网 MAC 与 PHY 之间的管理接口，
<br>
通常与 MII/RGMII/SGMII 数据接口配合使用。
<br>
MDIO 仅包含 MDC（时钟）和 MDIO（双向数据）两条线，负责 PHY 寄存器的读写配置。
<br>
理解 MDIO 帧结构和 Linux mdio_bus 驱动，是嵌入式网络开发的必备技能。

---

## <strong>MDIO 帧结构详解</strong>

### <strong>Clause 22 帧格式（传统 MDIO）</strong>

IEEE 802.3 Clause 22 定义了 32 个 PHY 寄存器的标准读写帧格式：

```
| Preamble | ST  | OP   | PHYADR | REGADR | TA | Data (16bit) | Idle |
|----------|-----|------|--------|--------|----|-------------|------|
| 32 bit   | 2bit| 2bit | 5bit   | 5bit   | 2bit| 16bit       | -    |
```

| 字段 | 位宽 | 读操作值 | 写操作值 | 说明 |
|------|------|----------|----------|------|
| Preamble | 32 | 全 1 | 全 1 | 同步前导 |
| ST (Start) | 2 | 01 | 01 | 起始帧 |
| OP (Opcode) | 2 | 10 | 01 | 10=读，01=写 |
| PHYADR | 5 | 目标地址 | 目标地址 | 0-31 |
| REGADR | 5 | 寄存器号 | 寄存器号 | 0-31 |
| TA (Turnaround) | 2 | Z0 | 10 | 读时主机释放总线 |
| Data | 16 | 读出的值 | 写入的值 | 寄存器数据 |

<span class="blue">关键结论：Clause 22 限制最多 32 个 PHY 地址、32 个寄存器，
<br>
无法满足现代千兆/万兆 PHY 大量扩展寄存器的需求。
</span>
<br>

---

### <strong>Clause 45 帧格式（扩展 MDIO）</strong>

IEEE 802.3 Clause 45 扩展了地址空间和设备类型：

```
| Preamble | ST  | OP   | PHYADR | DEVTYPE | TA | Address/Data(16bit) | Idle |
|----------|-----|------|--------|---------|----|---------------------|------|
| 32 bit   | 2bit| 2bit | 5bit   | 5bit    | 2bit| 16bit               | -    |
```

| OP 码 | 含义 | 用途 |
|-------|------|------|
| 00 | 地址写入 | 设置目标扩展寄存器地址 |
| 01 | 数据写入 | 向当前地址写入 16-bit 数据 |
| 10 | 数据读取 | 从当前地址读取 16-bit 数据 |
| 11 | 地址读取 | 读取当前地址指针（较少用） |

```mermaid
sequenceDiagram
    participant MAC as MAC MDIO
    participant PHY as PHY芯片
    Note over MAC,PHY: Clause 45 扩展寄存器读取
    MAC->>PHY: 地址帧: OP=00, DEVTYPE=3(PMA/PMD), Address=0x1234
    PHY-->>MAC: ACK
    MAC->>PHY: 数据帧: OP=10, DEVTYPE=3, Data=??
    PHY-->>MAC: 返回 0x5678
```

<span class="green">`DEVTYPE`</span> 字段定义设备类型：
<br>
0=保留，1=PMA/PMD，2=WIS，3=PCS，4=PHY XS，5=DTE XS，6=TC，7=自动协商，29/30/31=厂商自定义。

---

## <strong>PHY 寄存器标准映射</strong>

### <strong>为什么寄存器地址是标准化的</strong>

IEEE 802.3 强制规定 Register 0-15 的标准语义，确保不同厂商 PHY 能被统一驱动管理。
<br>
Register 16-31 留给厂商自定义，用于实现芯片特有功能（LED 控制、时序调整等）。
<br>
这种分层设计使 Linux 内核可以编写通用 PHY 驱动框架，而厂商只需补充私有扩展。

---

### <strong>关键寄存器一览</strong>

| 寄存器 | 名称 | 标准定义 | 典型用途 |
|--------|------|----------|----------|
| Reg 0 | Control | 802.3 Clause 22 | 复位、自协商使能、速率/双工设置 |
| Reg 1 | Status | 802.3 Clause 22 | 自协商完成、链路状态、故障检测 |
| Reg 2 | PHY ID 1 | 802.3 Clause 22 | 厂商 ID 高 16 位（如 Marvell=0x0141） |
| Reg 3 | PHY ID 2 | 802.3 Clause 22 | 厂商 ID 低 16 位 + 型号 + 版本 |
| Reg 4 | Auto-Neg Adv | 802.3 Clause 22 | 通告支持的速率和双工模式 |
| Reg 9 | 1000BASE-X Ctrl | 802.3 Clause 22 | 千兆光纤自协商控制 |
| Reg 10 | 1000BASE-X Stat | 802.3 Clause 22 | 千兆光纤自协商状态 |
| Reg 17 | SGMII Control | Cisco/SerDes 私有 | SGMII 模式使能、链路定时器 |

---

### <strong>Link Status 检测机制</strong>

```c
// 轮询链路状态的典型代码
uint16_t reg1 = mdio_read(phy_addr, 1);  // Read Status Register
uint8_t link_up = (reg1 >> 2) & 0x1;      // Bit 2: Link Status
uint8_t aneg_done = (reg1 >> 5) & 0x1;    // Bit 5: Auto-Negotiation Complete

// Linux 内核 phylib 中的标准链路检测
// drivers/net/phy/phy.c: genphy_read_status()
// 1. 读 Reg 1 确认 link_up
// 2. 读 Reg 4/9 确认自协商结果
// 3. 读厂商私有寄存器确认实际速率
```

<span class="blue">关键结论：Link Status（Reg1 bit2）是 latch-low 位，
<br>
链路断开时会锁存 0，直到下一次 MDIO 读取才更新。
<br>
因此中断驱动方式比轮询更高效，链路变化由 PHY INT 引脚通知 MAC。
</span>
<br>

---

## <strong>Linux mdio_bus 驱动框架</strong>

### <strong>为什么内核需要 mdio_bus 抽象</strong>

现代 SoC 中 MDIO 控制器可能集成在 MAC（如 STM32 ETH）、独立存在（如 IP101GR），或由交换机芯片提供。
<br>
Linux 内核将 MDIO 控制器抽象为 `mdio_bus`，将 PHY 设备抽象为 `phy_device`，
<br>
实现控制器与 PHY 的解耦，同一驱动可适配不同硬件平台。

---

### <strong>设备树绑定与注册</strong>

```dts
// arch/arm/boot/dts/stm32f7.dts 示例
&mac {
    pinctrl-names = "default";
    pinctrl-0 = <&ethernet_mdc_pa1>;
    phy-mode = "rmii";
    phy-handle = <&phy0>;
    
    mdio {
        #address-cells = <1>;
        #size-cells = <0>;
        
        phy0: ethernet-phy@0 {
            reg = <0>;              // PHY 地址 0
            compatible = "ethernet-phy-ieee802.3-c22";
            reset-gpios = <&gpioa 0 GPIO_ACTIVE_LOW>;
        };
    };
};
```

<span class="green">`phy-mode = "rmii"`</span> 指定数据接口为 RGMII 之前的简化版，MDIO 独立管理。
<br>
<span class="green">`reg = <0>`</span> 是 PHY 在 MDIO 总线上的地址，硬件通过 PHYAD 引脚（上拉/下拉）配置。

---

### <strong>驱动核心结构</strong>

```c
// drivers/net/phy/mdio_bus.c 核心逻辑
struct mii_bus *devm_mdiobus_alloc(struct device *dev);
int mdiobus_register(struct mii_bus *bus);

// PHY 读写 API
int mdiobus_read(struct mii_bus *bus, int addr, u32 regnum);
int mdiobus_write(struct mii_bus *bus, int addr, u32 regnum, u16 val);

// PHY 设备探测
static int mdio_bus_match(struct device *dev, struct device_driver *drv) {
    struct phy_device *phydev = to_phy_device(dev);
    struct phy_driver *phydrv = to_phy_driver(drv);
    // 匹配 PHY ID（Reg 2/3）与驱动支持的 ID 列表
    return phydrv->phy_id == (phydev->phy_id & phydrv->phy_id_mask);
}
```

<span class="green">`phy_id`</span> 由 Reg 2 和 Reg 3 拼接而成：`(Reg2 << 16) | Reg3`，唯一标识 PHY 型号。
<br>
<span class="green">`mdiobus_read/write`</span> 是同步阻塞调用，底层触发 MDIO 状态机发送 Clause 22 帧。

---

### <strong>通用 PHY 驱动（phylib）</strong>

```c
// drivers/net/phy/phy_device.c: phy_init()
// 自动识别 PHY ID 并绑定对应驱动

// 若厂商未提供专用驱动，fallback 到 genphy（通用 PHY 驱动）
static struct phy_driver genphy_driver = {
    .phy_id         = 0xffffffff,
    .phy_id_mask    = 0xffffffff,
    .name           = "Generic PHY",
    .read_status    = genphy_read_status,
    .config_aneg    = genphy_config_aneg,
    .soft_reset     = genphy_soft_reset,
};
```

<span class="blue">关键结论：Linux phylib 框架通过 PHY ID 自动匹配驱动，
<br>
未知 PHY 回退到 genphy，基本功能（速率/双工/链路检测）仍可工作。
<br>
但厂商特有功能（EEE 节能、LED、RGMII 时序调谐）需要专用驱动支持。
</span>
<br>

---

## <strong>历史演进与工业应用</strong>

MDIO 随 MII 接口于 1995 年在 IEEE 802.3u（快速以太网）中标准化。
<br>
Clause 22 为 10/100M 时代设计，32 个寄存器足够覆盖基础配置。
<br>
2002 年千兆以太网普及后，32 个寄存器明显不足，Clause 45 于 IEEE 802.3ae（10G）中引入。
<br>
Clause 45 通过 DEVTYPE + 扩展地址空间，支持数千个寄存器，覆盖 SerDes、PMA、PCS 等子层。
<br>
在嵌入式 Linux 中，mdio_bus 框架于 2.6 内核时代成熟，Device Tree 绑定在 3.x 后标准化。
<br>
现代 SoC（i.MX、STM32、RK3588）均将 MDIO 集成到以太网 MAC 或独立作为 GPIO bitbang 实现。

---

## 小结

| 要点 | 内容 |
|------|------|
| Clause 22 | 32 地址 x 32 寄存器，OP=10/01 读/写，适用于 10/100M PHY |
| Clause 45 | 32 地址 x 32 DEVTYPE x 65536 寄存器，OP=00/01/10/11，适用于千兆+ PHY |
| 关键寄存器 | Reg0 控制、Reg1 状态、Reg2/3 PHY ID、Reg4 自协商通告 |
| Linux 框架 | mdio_bus 抽象控制器、phy_device 抽象 PHY、phylib 自动识别 |
| 设备树 | `phy-handle` + `mdio` 子节点 + `reg` 配置 PHY 地址 |

## 练习

| 题号 | 问题 |
|------|------|
| 1 | Clause 22 的 TA（Turnaround）字段在读操作时为什么要求主机先释放 MDIO 总线（Z 状态），再读取 PHY 数据？从开漏/推挽电气特性分析。 |
| 2 | 为什么现代千兆 PHY 需要 Clause 45 而非 Clause 22？计算两种帧格式可访问的寄存器总数并分析扩展性差异。 |
| 3 | 在 Linux 内核中，若一颗新 PHY 芯片没有专用驱动，genphy 如何保证基本功能（速率、双工、链路检测）可用？从 phy_id 匹配和通用寄存器语义分析。 |

---

## 学习路线

- <span class="badge-b">[Beginner]</span> 掌握：MDIO 引脚定义、 Clause 22 帧格式、基本寄存器读写。
<br>
- <span class="badge-i">[Intermediate]</span> 掌握：Clause 45 扩展帧格式、PHY 寄存器语义、Linux mdio_bus 框架。
<br>
- <span class="badge-e">[Expert]</span> 掌握：Linux phylib 驱动开发、Device Tree 绑定、厂商私有寄存器调试、RGMII/SGMII 时序配合。

---

<span class="purple">扩展阅读</span>：IEEE 802.3 Clause 22/45；Linux Kernel `Documentation/devicetree/bindings/net/ethernet-phy.yaml`；
<br>
`drivers/net/phy/` 目录下内核 PHY 驱动源码。
"""

# ========== 文件5：MDIO 历史演进（扩充版） ==========
content5 = """# MDIO 从 MII 到 XFI 的历史演进

<span class="badge-e">[Expert]</span>

---

<span class="red">MDIO 管理接口</span> 随 MII 数据接口于 1995 年标准化，最初仅支持 10/100M 以太网 PHY 配置。
<br>
随着以太网从百兆到万兆的演进，MDIO 先后经历 Clause 22、Clause 45 两次重大升级，
<br>
与 RGMII、SGMII、XFI 等数据接口协同演化。
<br>
理解 MDIO 的演进脉络，有助于在嵌入式网络选型中正确匹配 PHY 与 MAC 的管理接口。

---

## <strong>1995-2000：MII 时代与 Clause 22 诞生</strong>

### <strong>为什么 MII 需要配套管理接口</strong>

1995 年 IEEE 802.3u 定义快速以太网（100BASE-TX），引入 MII（Media Independent Interface）
<br>
将 MAC 与 PHY 解耦，同一 MAC 可适配不同物理层（双绞线、光纤）。
<br>
但速率协商、链路检测、环回测试等功能需要寄存器访问机制。
<br>
MDIO 应运而生：2 线串行接口，32 地址 x 32 寄存器，满足当时百兆 PHY 的配置需求。

---

### <strong>MII + MDIO 经典架构</strong>

```mermaid
flowchart LR
    MAC["MAC 控制器"] -- TXD[4:0]--> MII["MII 接口"]
    MAC -- RXD[4:0]--> MII
    MAC -- TX_CLK/RX_CLK--> MII
    MAC -- MDC --> MDIO["MDIO 管理"]
    MAC -- MDIO --> MDIO
    MII --> PHY["PHY 芯片10/100M"]
    MDIO --> PHY
    style MII fill:#e3f2fd
    style MDIO fill:#e8f5e9
```

MII 使用 16 根数据线（TXD/RXD 各 4-bit + 控制/时钟），MDIO 仅需 2 根线。
<br>
这种分离设计使 MAC 只需关注数据转发，PHY 配置由 MDIO 独立管理。

---

## <strong>2001-2005：RGMII/SGMII 精简与千兆普及</strong>

### <strong>为什么 MII 需要瘦身</strong>

千兆以太网（1000BASE-T）于 1999 年标准化，MII 的 16 根线在 PCB 上占用过多引脚。
<br>
RGMII（Reduced Gigabit Media Independent Interface）将数据线压缩至 12 根，
<br>
通过在时钟边沿双采样（DDR）保持 1Gbps 速率。
<br>
SGMII（Serial Gigabit MII）进一步将数据接口串行化，仅需 2 对差分线（TX/RX）。

---

### <strong>RGMII/SGMII 与 MDIO 的配合</strong>

| 数据接口 | 数据线数 | 时钟 | MDIO 角色 | 典型应用 |
|----------|----------|------|-----------|----------|
| MII | 16 | 25MHz | 独立管理 | 早期百兆嵌入式 |
| RMII | 10 | 50MHz | 独立管理 | 精简百兆（STM32） |
| RGMII | 12 | 125MHz DDR | 独立管理 | 千兆主流方案 |
| SGMII | 2对差分 | SerDes | 独立管理 | 千兆SerDes方案 |
| XFI | 1对差分 | 10.3125G SerDes | 扩展管理(Clause45) | 万兆光纤 |

<span class="blue">关键结论：数据接口从并行走向串行，但 MDIO 始终保持独立管理角色。
<br>
即使 SGMII/XFI 使用 SerDes，PHY 寄存器配置仍需 MDIO/Clause 45。
</span>
<br>

---

### <strong>RGMII 时序与 PHY 寄存器调谐</strong>

```c
// 典型 RGMII RX 时钟延迟调谐（Marvell PHY）
// 通过 MDIO 修改厂商私有寄存器
mdio_write(phy_addr, 0x1D, 0x1F);  // 选择 Page 31
mdio_write(phy_addr, 0x1E, 0x00B0); // 选择寄存器 0xB0 (RGMII 时序)
uint16_t val = mdio_read(phy_addr, 0x1E);
val |= (1 << 7);  // 设置 RX 时钟延迟使能
mdio_write(phy_addr, 0x1E, val);
```

RGMII 要求 TX 时钟与数据边沿对齐，RX 时钟需 1.5-2.0ns 延迟避免采样冲突。
<br>
这些时序参数通常通过 MDIO 访问 PHY 私有寄存器调整。
<br>
不同厂商（Marvell、Realtek、Micrel）的寄存器映射各不相同，驱动开发需查阅 datasheet。

---

## <strong>2006-2015：Clause 45 与万兆扩展</strong>

### <strong>为什么 Clause 22 无法满足万兆需求</strong>

10G 以太网 PHY 内部结构远比百兆复杂：PCS（物理编码子层）、PMA（物理媒介附加）、
<br>
PMD（物理媒介相关）、WIS（WAN 接口子层）、Auto-Neg 等子模块都需要独立寄存器空间。
<br>
Clause 22 的 32 个寄存器远远不够，且 DEVTYPE 字段缺失导致无法区分子模块。
<br>
Clause 45 通过引入 DEVTYPE（5-bit）和地址/数据分离帧，将可访问寄存器扩展至 32x32x64K。

---

### <strong>Clause 45 与 XFI 的协同</strong>

XFI（10 Gigabit Serial Electrical Interface）使用单通道 10.3125Gbps SerDes，
<br>
物理层通常是集成 MAC+PHY 的网卡芯片（如 Intel X710），或交换机 ASIC。
<br>
在此场景中，MDIO 不再连接外部 PHY，而是访问芯片内部的 SerDes 寄存器。
<br>
Clause 45 的 DEVTYPE=1（PMA/PMD）和 DEVTYPE=3（PCS）成为调谐误码率、预加重、均衡的关键接口。

---

## <strong>历史演进时间线</strong>

```mermaid
timeline
    title MDIO 与数据接口演进路线
    1995 : MII + MDIO Clause22
         : 16根数据线 + 2线管理，10/100M
    1999 : RGMII 诞生
         : 12根 DDR 数据线，千兆主流
    2002 : Clause45 引入
         : 万兆扩展寄存器空间
    2003 : SGMII 普及
         : SerDes 串行数据 + MDIO 管理
    2006 : XFI 万兆接口
         : 单通道10G SerDes
    2010 : Linux mdio_bus 成熟
         : Device Tree 绑定标准化
    2016 : Clause45 在嵌入式普及
         : RK3588/i.MX8 原生 Clause45 支持
    2020 : USXGMII 多速率接口
         : 2.5G/5G/10G 统一 SerDes
```

---

## 小结

| 要点 | 内容 |
|------|------|
| 起源 | 1995 年 MII 配套管理接口，Clause 22 标准化 |
| 数据接口瘦身 | MII(16) -> RMII(10) -> RGMII(12 DDR) -> SGMII(2差分) -> XFI(1差分) |
| MDIO 升级 | Clause 22(32x32) -> Clause 45(32x32x64K)，DEVTYPE 区分子模块 |
| 时序调谐 | RGMII RX 时钟延迟、SGMII 链路定时器通过 MDIO 厂商私有寄存器配置 |
| 嵌入式趋势 | 现代 SoC 通过 mdio_bus 框架统一支持 Clause 22/45，PHY 地址由设备树配置 |

## 练习

| 题号 | 问题 |
|------|------|
| 1 | RGMII 为什么需要在时钟边沿双采样（DDR）才能用 12 根线实现 1Gbps？计算单线速率并与 MII 对比。 |
| 2 | Clause 45 的地址帧（OP=00）和数据帧（OP=10）分离设计，相比 Clause 22 的直接读写有什么优势和劣势？从协议效率和实现复杂度分析。 |
| 3 | 在 SGMII 架构中，MDIO 管理的是外部 PHY 还是 MAC 内部的 SerDes 控制器？若使用 XFI 直连光模块（无外部 PHY），MDIO 还有存在的必要吗？ |

---

## 学习路线

- <span class="badge-b">[Beginner]</span> 掌握：MDIO 引脚定义、Clause 22 帧结构、基本寄存器读写。
<br>
- <span class="badge-i">[Intermediate]</span> 掌握：RGMII/SGMII 与 MDIO 的配合、PHY 地址配置、Linux mdio_bus 注册。
<br>
- <span class="badge-e">[Expert]</span> 掌握：Clause 45 扩展帧、万兆 SerDes 寄存器调谐、XFI/USXGMII 接口演进、厂商 PHY 私有寄存器逆向调试。

---

<span class="purple">扩展阅读</span>：IEEE 802.3 Clause 22/45；RGMII v2.0 Specification（RapidlIO Trade Association）；
<br>
Cisco SGMII Application Note；Linux `drivers/net/phy/` 源码。
"""

# ========== 文件6：I3C 逻辑级与测试模式 ==========
content6 = """# I3C HDR 模式与内置测试调试机制

<span class="badge-e">[Expert]</span>

---

<span class="red">MIPI I3C 的 HDR（High Data Rate）模式</span> 是其超越 I2C 性能的核心机制。
<br>
通过 DDR（Double Data Rate）和 TSC（Ternary Symbol Coding）等编码方式，
<br>
I3C 在相同的 SDA/SCL 双线上实现最高 33.3 Mbps 的有效数据率。
<br>
此外，IBI（In-Band Interrupt）和 HJ（Hot-Join）机制为动态设备管理和带内调试提供了原生支持。

---

## <strong>I3C HDR 模式详解</strong>

### <strong>为什么 I3C 需要 HDR</strong>

I3C 的 SDR（Single Data Rate）模式最高 12.5MHz，已远超 I2C 的 3.4MHz。
<br>
但对于 4K 摄像头、高帧率 IMU 等场景，12.5Mbps 仍然不够。
<br>
HDR 模式通过在时钟和数据线上同时编码更多信息，突破单沿采样的速率限制。
<br>
这类似于 DDR 内存和 PCIe 的演进思路：不改变引脚数，提升每引脚的信息密度。

---

### <strong>DDR 模式：双边沿采样</strong>

DDR 模式在 SCL 的上升沿和下降沿各传输 1-bit 数据，有效速率翻倍。

```mermaid
sequenceDiagram
    participant SCL as SCL 时钟
    participant SDA as SDA 数据
    Note over SCL,SDA: DDR 模式：双边沿采样
    SCL->>SCL: 上升沿
    SDA-->>SCL: 数据 Bit N (上升沿采样)
    SCL->>SCL: 下降沿
    SDA-->>SCL: 数据 Bit N+1 (下降沿采样)
    SCL->>SCL: 上升沿
    SDA-->>SCL: 数据 Bit N+2 (上升沿采样)
    SCL->>SCL: 下降沿
    SDA-->>SCL: 数据 Bit N+3 (下降沿采样)
```

| 参数 | SDR 模式 | DDR 模式 |
|------|----------|----------|
| 时钟频率 | 12.5 MHz | 12.5 MHz |
| 数据采样 | 单沿 | 双沿 |
| 有效数据率 | 12.5 Mbps | 25 Mbps |
| 总线状态 | 推挽输出 | 推挽输出 |

<span class="blue">关键结论：DDR 模式不改变时钟频率，仅通过双边沿采样将吞吐量翻倍。
<br>
但对 SDA 信号完整性要求更高，建立/保持时间减半。
</span>
<br>

---

### <strong>TSC 模式：三态编码</strong>

TSC（Ternary Symbol Coding）是 I3C 最高效的 HDR 变体。
<br>
传统二进制每时钟传输 1-bit，而 TSC 利用 SDA 的三态（高、低、高阻）编码更多状态。
<br>
两线组合（SCL + SDA）每周期可表示 3x3=9 种状态，实际使用 4 种数据符号 + 控制符号。
<br>
TSC 模式有效数据率可达 33.3 Mbps，是 SDR 的 2.66 倍。

```
TSC 符号映射：
SCL=Low,  SDA=Low   -> Symbol 0
SCL=Low,  SDA=High  -> Symbol 1
SCL=High, SDA=Low   -> Symbol 2
SCL=High, SDA=High  -> Symbol 3
```

---

## <strong>内置测试与调试机制</strong>

### <strong>为什么 I3C 需要带内中断 IBI</strong>

I2C 没有中断机制，传感器事件必须靠主机轮询检测。
<br>
在 20+ 传感器的智能手机中，轮询功耗占整体传感器子系统功耗的 40% 以上。
<br>
I3C 引入 IBI（In-Band Interrupt）：从设备通过在总线上发送特定序列主动请求中断。
<br>
主机收到 IBI 后，按优先级顺序读取各设备的事件寄存器，仅处理有事件的设备。

---

### <strong>IBI 工作流程</strong>

```mermaid
flowchart TD
    SENSOR["传感器检测到事件"] -- IBI 请求 --> ARBITER["总线仲裁器"]
    ARBITER -- 总线空闲时 --> BROADCAST["广播 IBI 地址头"]
    BROADCAST -- 匹配 --> MASTER["主机识别中断源"]
    MASTER -- 读取 --> REG["事件寄存器"]
    REG -- 处理完成 --> ACK["ACK 清除中断"]
    style SENSOR fill:#ffebee
    style ARBITER fill:#e3f2fd
```

| I3C 特性 | I2C 对比 | 优势 |
|----------|----------|------|
| IBI 带内中断 | 无中断，纯轮询 | 降低 80% 轮询功耗 |
| HJ 热插拔 | 不支持 | 动态添加/移除设备 |
| CCC 通用命令 | 无标准命令集 | 统一的设备控制接口 |
| DAA 动态地址 | 固定地址（跳线/电阻） | 避免地址冲突，简化生产 |

---

### <strong>HJ（Hot-Join）动态加入</strong>

```c
// I3C Hot-Join 流程示意（伪代码）
void i3c_hotjoin_handler(struct i3c_bus *bus) {
    // 1. 新设备通过 HJ 请求加入总线
    u8 hj_addr = i3c_recv_broadcast(bus);
    
    // 2. 主机分配动态地址（DAA：Dynamic Address Assignment）
    u8 new_addr = i3c_alloc_address(bus);
    
    // 3. 发送 ENTDAA CCC 命令，设备进入地址分配模式
    i3c_ccc_cmd(bus, CCC_ENTDAA, new_addr);
    
    // 4. 设备返回 48-bit PID（Product ID）
    u64 pid = i3c_read_pid(bus);
    
    // 5. 注册到总线设备链表
    i3c_register_device(bus, new_addr, pid);
}
```

<span class="green">`CCC_ENTDAA`</span> 是 Enter Dynamic Address Assignment 命令，触发所有未分配地址的设备上报 PID。
<br>
<span class="green">`48-bit PID`</span> 由厂商 ID + 部件 ID + 实例 ID 组成，唯一标识芯片型号和个体。

---

## <strong>Linux I3C 子系统</strong>

### <strong>内核架构</strong>

```c
// drivers/i3c/master.c 核心结构
struct i3c_master_controller {
    struct i3c_bus bus;
    struct i3c_device *devs[I3C_MAX_DEVS];
    
    // CCC 命令发送
    int (*send_ccc_cmd)(struct i3c_master_controller *,
                        struct i3c_ccc_cmd *);
    // IBI 处理
    int (*request_ibi)(struct i3c_device *, ibi_handler_t);
};
```

<span class="blue">关键结论：Linux I3C 子系统于 4.19 内核合并，架构与 I2C 类似但增加了 CCC、IBI、DAA 支持。
<br>
主控制器驱动负责 HDR 模式物理层时序，设备驱动通过标准 API 访问功能。
</span>
<br>

---

## 小结

| 要点 | 内容 |
|------|------|
| SDR 模式 | 12.5MHz 单沿，基础模式，兼容 I2C |
| DDR 模式 | 12.5MHz 双沿，25Mbps，信号完整性要求更高 |
| TSC 模式 | 三态编码，33.3Mbps，最高效 HDR 变体 |
| IBI | 带内中断，传感器主动通知，消除轮询功耗 |
| HJ/DAA | 热插拔 + 动态地址分配，生产免跳线 |
| Linux 支持 | 4.19+ 内核 i3c 子系统，CCC/IBI/DAA 完整实现 |

## 练习

| 题号 | 问题 |
|------|------|
| 1 | I3C DDR 模式在 SCL 下降沿采样时，如何避免 SDA 信号在时钟翻转瞬间的亚稳态？从建立时间和保持时间要求分析。 |
| 2 | TSC 模式使用 SCL+SDA 的三态组合编码，为什么比 DDR 模式更高效？计算 TSC 和 DDR 在相同 12.5MHz 时钟下的有效数据率比值。 |
| 3 | 为什么 I3C 的热插拔（HJ）机制对可穿戴设备特别重要？设想 TWS 耳机充电仓内的传感器在取出/放入时的地址分配过程。 |

---

## 学习路线

- <span class="badge-b">[Beginner]</span> 掌握：I3C SDR 模式时序、CCC 基本命令、与 I2C 的兼容性。
<br>
- <span class="badge-i">[Intermediate]</span> 掌握：DDR/TSC HDR 模式原理、IBI 中断处理、DAA 地址分配流程。
<br>
- <span class="badge-e">[Expert]</span> 掌握：Linux I3C 子系统驱动开发、HDR 物理层信号完整性分析、多主控制器仲裁、与 MIPI CSI/DSI 的协同设计。

---

<span class="purple">扩展阅读</span>：MIPI I3C Specification v1.1.1；Linux Kernel `Documentation/i3c/`；
<br>
MIPI I3C HDR Mode Application Note。
"""

# ========== 文件7：I3C 历史演进与生态 ==========
content7 = """# MIPI I3C 标准路线与 I2C/SPI 替代关系

<span class="badge-e">[Expert]</span>

---

<span class="red">MIPI I3C</span> 是 MIPI Alliance 于 2016 年发布的传感器接口标准，旨在解决 I2C 速率低、无中断、地址冲突等固有问题。
<br>
作为 I2C 的精神继承者，I3C 在智能手机、可穿戴设备、汽车电子中快速渗透。
<br>
理解 MIPI Alliance 的标准路线和 I3C 的生态布局，有助于预判未来嵌入式传感器接口格局。

---

## <strong>MIPI Alliance 标准路线</strong>

### <strong>为什么 MIPI 要定义 I3C</strong>

2003 年成立的 MIPI Alliance 最初专注于移动设备显示（DSI）和摄像头（CSI）接口。
<br>
2010 年后，智能手机传感器数量从 3-4 个激增至 15+ 个，I2C 成为瓶颈。
<br>
MIPI 发现传感器接口没有统一标准，各厂商使用 I2C+SPI+GPIO 混合方案，互操作性差。
<br>
2013 年，MIPI 传感器工作组成立，目标是定义"下一代传感器总线"。
<br>
2016 年，I3C v1.0 规范发布。2018 年 v1.1 增加 HDR 模式，2021 年 v1.1.1 完善测试规范。

---

### <strong>MIPI 标准族谱</strong>

```mermaid
flowchart LR
    subgraph "MIPI Alliance 标准族"
        CSI["MIPI CSI-2/CSI-3摄像头"]
        DSI["MIPI DSI/DSI-2显示"]
        RFFE["MIPI RFFE射频前端"]
        I3C["MIPI I3C传感器"]
        SPMI["MIPI SPMI电源管理"]
        SLIMbus["MIPI SLIMbus音频"]
    end
    CSI -- 数据 --> I3C
    DSI -- 配置 --> I3C
    RFFE -- 寄存器 --> I3C
    SPMI -- 电源 --> I3C
    style I3C fill:#e8f5e9
```

MIPI I3C 定位为"传感器控制总线"，与 CSI/DSI 的数据总线形成互补。
<br>
RFFE（RF Front-End）也使用类似的寄存器访问模型，未来可能与 I3C 融合。

---

## <strong>I3C vs I2C/SPI 的替代关系</strong>

### <strong>为什么 I3C 能替代 I2C 但不能替代 SPI</strong>

I3C 的设计目标明确：替代 I2C 在传感器场景中的地位。
<br>
12.5MHz SDR + 33.3Mbps HDR 的速率，足以覆盖绝大多数传感器（加速度计、陀螺仪、环境光等）。
<br>
但 SPI 的 50MHz+ 速率对于高速 ADC、显示屏、Flash 存储仍然是刚需。
<br>
因此 I3C 不会完全替代 SPI，而是与 SPI 在"中速传感器"和"高速外设"之间形成新的分工。

---

### <strong>三种总线的新分工格局</strong>

| 场景 | 传统方案 | 新方案 | 原因 |
|------|----------|--------|------|
| 10+ 传感器手机 | I2C 多路复用 | I3C 单总线 | 动态地址+IBI中断 |
| 可穿戴设备 | I2C+GPIO中断 | I3C 单总线 | HJ热插拔+低功耗 |
| 汽车传感器 | CAN/LIN | I3C + CAN FD | 速率+可靠性并重 |
| 高速 ADC | SPI | SPI | I3C 速率不足 |
| 显示屏 | SPI/RGB | MIPI DSI | 视频专用协议 |
| 摄像头 | SPI/并行 | MIPI CSI-2 | 视频专用协议 |

<span class="blue">关键结论：I3C 的核心替代目标是 I2C 传感器场景，而非 SPI 高速场景。
<br>
在多传感器移动设备中，I3C 将逐渐成为标配，I2C 退守工业存量市场。
</span>
<br>

---

### <strong>旗舰 SoC 的 I3C 支持现状</strong>

| SoC | 发布时间 | I3C 支持 | 典型应用 |
|-----|----------|----------|----------|
| 高通骁龙 888 | 2020 | I3C SDR | 小米11、三星S21 |
| 高通骁龙 8 Gen 1 | 2021 | I3C SDR+HDR | 旗舰手机 |
| 高通骁龙 8 Gen 2 | 2022 | I3C SDR+HDR+IBI | 主流旗舰 |
| 联发科天玑 9200 | 2022 | I3C SDR+HDR | vivo X90 |
| 苹果 A16/A17 | 2022/23 | 私有传感器总线 | iPhone 14/15 |

---

## <strong>历史演进时间线</strong>

```mermaid
timeline
    title MIPI I3C 标准演进路线
    2003 : MIPI Alliance 成立
         : 聚焦移动设备接口标准化
    2010 : 传感器工作组成立
         : 智能手机传感器激增驱动需求
    2016 : I3C v1.0 发布
         : 12.5MHz SDR，兼容 I2C
    2018 : I3C v1.1 发布
         : HDR 模式（DDR/TSC），IBI 中断
    2021 : I3C v1.1.1 发布
         : 测试规范完善，合规认证启动
    2022 : 旗舰 SoC 原生支持
         : 高通、联发科集成 I3C 主控制器
    2025 : 汽车电子渗透
         : AEC-Q100 认证传感器上市
    2026 : I3C 成为传感器主流
         : 新手机传感器 80%+ 采用 I3C
```

---

## 小结

| 要点 | 内容 |
|------|------|
| MIPI 路线 | 2010 传感器工作组 -> 2016 I3C v1.0 -> 2018 v1.1 HDR -> 2021 v1.1.1 测试规范 |
| I2C 替代 | I3C 在传感器场景中逐步替代 I2C，工业市场 I2C 长期共存 |
| SPI 共存 | I3C 不替代 SPI，中速传感器 I3C + 高速外设 SPI 分工 |
| 旗舰支持 | 高通骁龙 8 Gen 2、联发科天玑 9200 已原生集成 I3C 主控 |
| 未来趋势 | 汽车电子、可穿戴、AR/VR 是 I3C 的下一个增长点 |

## 练习

| 题号 | 问题 |
|------|------|
| 1 | MIPI Alliance 已有 CSI（摄像头）和 DSI（显示）标准，为什么还需要单独定义 I3C 而非直接复用 CSI/DSI 的配置通道？从传感器数量、速率需求、功耗约束三个角度分析。 |
| 2 | 为什么高通和联发科在 2022 年后才开始原生支持 I3C，而不是在 2016 年 I3C 发布后立即集成？从 IP 验证周期、传感器生态、成本三个因素分析。 |
| 3 | 在汽车电子中，I3C 与 CAN FD 的分工是什么？为什么汽车传感器不全部改用 I3C，而是保留 CAN FD 作为主干总线？ |

---

## 学习路线

- <span class="badge-b">[Beginner]</span> 掌握：I3C 基础时序、SDR 模式、与 I2C 的兼容性。
<br>
- <span class="badge-i">[Intermediate]</span> 掌握：HDR 模式原理、IBI/HJ 机制、MIPI 标准族关系。
<br>
- <span class="badge-e">[Expert]</span> 掌握：MIPI Alliance 标准路线、SoC I3C 主控集成、汽车电子认证要求、I3C 与 CSI/DSI/RFFE 的协同设计。

---

<span class="purple">扩展阅读</span>：MIPI I3C Specification v1.1.1；MIPI Alliance Sensor WG Whitepaper；
<br>
高通 Snapdragon 8 Gen 2 Technical Reference Manual I3C 章节。
"""

print("=" * 60)
print("写入第二批文件 (MDIO+I3C)...")
print("=" * 60)

p4 = find_file("docs/08-总线协议/基础外设通信总线/MDIO/04-MDIO逻辑级与以太网驱动.md")
if p4:
    write_content(p4, content4)
else:
    print("ERROR: 找不到 MDIO 04")

p5 = find_file("docs/08-总线协议/基础外设通信总线/MDIO/05-MDIO历史演进.md")
if p5:
    write_content(p5, content5)
else:
    print("ERROR: 找不到 MDIO 05")

p6 = find_file("docs/08-总线协议/基础外设通信总线/MIPI-I3C/04-I3C逻辑级与测试模式.md")
if p6:
    write_content(p6, content6)
else:
    print("ERROR: 找不到 MIPI-I3C 04")

p7 = find_file("docs/08-总线协议/基础外设通信总线/MIPI-I3C/05-I3C历史演进与生态.md")
if p7:
    write_content(p7, content7)
else:
    print("ERROR: 找不到 MIPI-I3C 05")

print("=" * 60)
print("第二批完成")
print("=" * 60)
