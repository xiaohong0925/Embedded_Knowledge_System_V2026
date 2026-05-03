#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复 08-总线协议 第一部分+第二部分 共37个 .md 文件的内容质量问题
"""

import os, re, textwrap

WORK_DIR = r"D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026"

# ============== 知识库 ==============

HISTORY_DB = {
    "1-Wire": """1-Wire 总线由 Dallas Semiconductor（现 Maxim Integrated）于 1990 年推出，初衷是为 iButton 电子密钥提供极简的物理连接方式。单线通信的概念在当时极具颠覆性——仅用一根信号线即可完成供电和数据传输，大幅降低了接插件成本。1993 年，Dallas 发布了 DS1990 iButton 系列，将 1-Wire 推向工业和门禁市场。2000 年后，随着嵌入式温度传感器 DS18B20 的普及，1-Wire 进入消费电子领域。2007 年 Maxim 收购 Dallas 后持续维护协议规范。现代 1-Wire 生态中，OWFS（1-Wire File System）项目为 Linux 提供了完善的软件支持，使开发者能像操作文件一样读写 1-Wire 设备。尽管高速场景已被 I2C/SPI 取代，1-Wire 在低成本温度监测和电子标签领域仍不可替代。""",
    "I2C": """I2C 由 Philips（现 NXP）于 1982 年发明，最初用于电视机内部芯片间的通信，目的是减少 PCB 走线数量。1992 年发布 1.0 规范，定义了 100kHz 标准模式和 400kHz 快速模式。2000 年推出 3.4MHz 高速模式（Hs），通过电流源上拉大幅压缩上升时间。2006 年 Fast-mode Plus（Fm+，1MHz）发布，2012 年推出 Ultra Fast-mode（UFm，5MHz，单向推挽）。2014 年后，I2C 与 SMBus（Intel 1995 年推出的系统管理总线）深度兼容，成为服务器、笔记本电池管理的标准。MIPI I3C 作为 I2C 的精神继承者于 2016 年发布，在保留两线架构的基础上引入动态地址和高达 12.5MHz 的 SDR 速率，正在逐步取代传统 I2C。""",
    "MDIO": """MDIO（Management Data Input/Output）伴随 IEEE 802.3u 快速以太网标准于 1995 年诞生，与 MII（Media Independent Interface）一起解决了 MAC 层与 PHY 层的寄存器访问问题。2000 年前后，随着千兆以太网普及，GMII/RGMII 等简化接口相继推出，MDIO 的时钟频率从 2.5MHz 提升到 25MHz（Clause 45）。2005 年后，10G/40G/100G 以太网引入更复杂的 PCS/PMA 层，MDIO 的寄存器空间从 5 位扩展到 16 位。Linux 内核从 2.6 版本开始内置 `mdio_bus` 子系统，2015 年后 Device Tree 成为描述 PHY 连接的标准方式。现代交换机芯片集成数十个 PHY，MDIO 多路复用器和 GPIO-bitbang 方案成为常态，而 netlink-based mdio 工具正在替代传统 ioctl 接口。""",
    "MIPI-I3C": """MIPI I3C 由 MIPI Alliance 于 2016 年正式发布，是对 I2C 的全面现代化重构。I2C 在 30 多年发展中积累了诸多局限：静态地址冲突、速度天花板、功耗无法优化。MIPI I3C 保留了 SDA/SCL 双线的物理兼容性，但引入动态地址分配（DAA）、带内中断（IBI）和高达 12.5MHz 的 SDR 模式。2017 年，HDR（High Data Rate）模式加入，通过推挽驱动实现 33.3Mbps 的双倍数据速率。2019 年 I3C Basic 子集发布，降低授权门槛以加速生态普及。2021 年后，高通、联发科等手机 SoC 广泛集成 I3C 控制器，传感器集线器（Sensor Hub）成为 I3C 的主战场。未来 I3C 有望统一移动设备中所有低速传感器接口，彻底取代 I2C + GPIO 中断的碎片化方案。""",
    "SPI": """SPI 由 Motorola 于 1980 年代早期发明，最初用于 68000 系列处理器与外设的通信。与 I2C 不同，SPI 从一开始就是为高速点对点传输设计的，没有标准化组织的束缚，因此各家厂商实现存在差异（时钟相位/极性）。1990 年代，SPI 成为 Flash 存储器（NOR/NAND）的标准接口。2000 年后，显示屏控制器（ILI9341 等）广泛采用 SPI，推动了 Quad SPI（QSPI）的发展——用 4 根数据线并行传输，速率突破 100Mbps。2012 年 JEDEC 发布 xSPI 标准（JESD251），统一了 Octal SPI（8 线）的时序规范。Linux 内核的 `spidev` 驱动和 Device Tree 绑定使 SPI 设备树描述标准化。现代嵌入式系统中，SPI 仍是 Flash、显示屏、ADC 的首选高速接口，QSPI/Octal SPI 正在向 400Mbps+ 演进。""",
    "UART": """UART（Universal Asynchronous Receiver/Transmitter）的历史可追溯至 1960 年代的电传打字机（Teletype）接口，是计算机串行通信的鼻祖。1970 年代，RS-232 标准（EIA-232）定义了 UART 的电气规范，成为调制解调器和终端的标准连接方式。1980 年代，8250/16450/16550 等 UART 芯片使 PC 串口标准化。1990 年代 USB 兴起后，传统 RS-232 端口逐渐从 PC 消失，但 FT232、CP2102 等 USB-to-UART 桥接芯片让 UART 在嵌入式领域焕发新生。2000 年后，UART 成为嵌入式调试的标配——几乎每个 MCU 的启动日志都通过 UART 输出。2010 年后，蓝牙模块（HC-05）、GPS 模组、LoRa 无线模块仍沿用 UART 接口。未来，虽然高速场景被 USB 取代，但 UART 凭借极简的 2 线设计和无需时钟同步的优势，仍将是嵌入式调试和低速外设通信的核心接口。""",
    "PCIe": """PCI（Peripheral Component Interconnect）由 Intel 于 1992 年推出，替代了老旧的 ISA 总线，首次在 PC 领域引入即插即用和共享总线架构。2003 年 PCI-SIG 发布 PCI Express 1.0，用高速串行差分对替代了并行总线，单 lane 速率 2.5GT/s。2007 年 PCIe 2.0 翻倍至 5GT/s，2010 年 PCIe 3.0 采用 128b/130b 编码达到 8GT/s。2017 年 PCIe 4.0 达 16GT/s，2019 年 PCIe 5.0 达 32GT/s，2022 年 PCIe 6.0 引入 PAM4 信号调制实现 64GT/s。PCIe 的演进始终遵循带宽翻倍、保持向后兼容的节奏，从 PC 扩展到服务器、嵌入式和移动端（M.2 接口）。NVMe 协议基于 PCIe 重新定义了存储接口，使 SSD 延迟从毫秒级降至微秒级。PCIe 6.0/7.0 时代，光学互连和 CXL（Compute Express Link）共存协议正在重塑数据中心架构。""",
    "SATA": """SATA（Serial ATA）由 Intel、APT、Dell、IBM、Maxtor 和 Seagate 于 2000 年联合制定，替代了 1986 年诞生的并行 ATA（PATA/IDE）接口。SATA 1.0 提供 1.5Gbps，2004 年 SATA 2.0 翻倍至 3Gbps 并引入 NCQ（Native Command Queuing），2009 年 SATA 3.0 达 6Gbps。AHCI（Advanced Host Controller Interface）作为 SATA 的软件接口标准于 2004 年发布，统一了不同厂商的驱动模型。然而，SATA/AHCI 的设计根植于机械硬盘时代——单队列、高延迟、CPU 中断开销大。2011 年 NVMe 协议基于 PCIe 发布，专为 NAND Flash 的并行特性设计，多队列架构使 IOPS 提升数十倍。2015 年后，消费级 PC 和服务器全面转向 NVMe SSD，SATA 逐渐退居大容量冷存储和入门级设备的边缘市场。""",
    "SD": """SD（Secure Digital）卡源于 1999 年松下、东芝和 SanDisk 联合推出的 MMC（MultiMediaCard）标准。2000 年 SD 卡协会（SDA）成立，在 MMC 基础上增加写保护开关和 DRM 安全机制。2003 年 SDIO 规范发布，允许 SD 接口扩展 WiFi、GPS 等外设。2006 年 SDHC（High Capacity）突破 2GB 容量限制，2009 年 SDXC 引入 exFAT 支持 2TB。2010 年 UHS-I 将总线速度提升至 104MB/s，2013 年 UHS-II 增加第二排针脚实现 312MB/s，2017 年 UHS-III 达 624MB/s。2018 年后，SD Express 将 PCIe/NVMe 协议映射到 SD 引脚上，速率突破 985MB/s。eMMC（embedded MMC）于 2006 年成为手机存储标准，UFS（Universal Flash Storage）于 2011 年发布，用 M-PHY 替代并行总线，成为高端智能手机的标配。未来 SD Express 和 UFS 将继续并存，分别服务于可移动存储和嵌入式存储场景。""",
    "USB": """USB 由 Intel、Microsoft、IBM、Compaq 等七家公司于 1994 年联合发起，1996 年发布 USB 1.0（1.5Mbps/12Mbps）。1998 年 USB 1.1 修复了早期兼容性问题，2000 年 USB 2.0 将高速模式提升至 480Mbps，确立了 USB 作为通用外设接口的地位。2008 年 USB 3.0（后称 USB 3.1 Gen1）引入 5Gbps SuperSpeed 和全双工差分对，2013 年 USB 3.1 Gen2 达 10Gbps，2017 年 USB 3.2 支持双通道 20Gbps。2014 年 USB Type-C 连接器发布，24 针可翻转设计统一了所有 USB 形态。2019 年 USB4 基于 Thunderbolt 3 协议，支持 40Gbps 和隧道化 PCIe/DisplayPort 传输。2022 年 USB4 v2.0 达 80Gbps，引入不对称带宽分配。现代嵌入式开发中，USB OTG/Device 模式使 MCU 可以模拟 U 盘、串口、网卡等外设，USB 已成为事实上唯一的通用高速外设接口。""",
}

WHY_SECTIONS = {
    "1-Wire": """### 为什么需要 1-Wire

嵌入式系统中，<span class="red">某些场景对引脚数量的限制极端苛刻</span>——电子标签、温度探头、门禁卡等只需偶发通信，不值得占用两根甚至四根信号线。<br>
1-Wire 用**一根线**同时完成供电和数据传输，通过寄生电容储能机制让从设备在无外部电源时也能工作。<br>
这种极简架构在需要最低布线成本、最低接插件尺寸的领域中不可替代。""",

    "I2C": """### 为什么需要 I2C

嵌入式系统中，<span class="red">传感器、EEPROM、RTC</span> 等外设数量动辄十几个。<br>
如果每个外设都用独立的数据+时钟线连接主控，引脚资源很快耗尽。<br>
SPI 虽快但每条从设备独占一条 CS 线，布线复杂。<br>
I2C（Inter-Integrated Circuit，集成电路互连总线）用 **两条线** 连接 **多个设备**，<br>
节省引脚、简化 PCB 走线，是低速外设通信的首选方案。""",

    "MDIO": """### 为什么需要 MDIO

以太网 PHY 芯片包含大量可配置寄存器——自协商使能、速率选择、环回测试、LED 控制等。<br>
<span class="red">如果没有统一的管理接口</span>，每个厂商都需要私有的 GPIO 序列来配置 PHY，驱动开发沦为重复的体力活。<br>
MDIO（Management Data Input/Output）作为 IEEE 802.3 标准的一部分，用 **两根线（MDC 时钟 + MDIO 数据）** 统一了所有 PHY 的寄存器访问方式，<br>
使 MAC 层驱动可以通用地探测、配置和监控任何兼容 PHY。""",

    "MIPI-I3C": """### 为什么需要 MIPI I3C

I2C 在 30 多年发展中暴露了大量痛点：<span class="red">静态地址冲突导致同一总线上无法挂载两个相同设备</span>；中断必须占用额外 GPIO；速度上限 3.4MHz 无法满足高分辨率传感器的数据吞吐需求。<br>
MIPI I3C 在保留 SDA/SCL 双线物理兼容性的前提下，引入动态地址分配（DAA）、带内中断（IBI）和高达 12.5MHz 的 SDR 模式，<br>
既解决了 I2C 的遗留问题，又无需重新设计 PCB 布线，是移动设备传感器总线的下一代标准。""",

    "SPI": """### 为什么需要 SPI

<span class="red">I2C 节省引脚但牺牲了带宽</span>。<br>
当外设需要高速流式传输时——Flash 烧录、显示屏刷新、ADC 采样——400kHz 的 I2C 成为瓶颈。<br>
SPI（Serial Peripheral Interface，串行外设接口）用 **四根线** 换取 **全双工高速传输**。<br>
时钟由主设备单方面驱动，无需等待从设备 ACK，协议开销接近零。""",

    "UART": """### 为什么需要 UART

<span class="red">嵌入式系统调试和低速异步通信</span>是最常见的开发需求之一。<br>
同步总线（I2C/SPI）需要共享时钟信号，长距离传输时时钟偏移导致数据错误。<br>
UART（Universal Asynchronous Receiver/Transmitter）仅需 **两根线（TX+RX）** 即可实现全双工通信，<br>
无需时钟线、无需地址寻址、协议极简，是调试串口、GPS 模组、蓝牙透传模块的首选接口。""",

    "PCIe": """### 为什么需要 PCIe

<span class="red">传统 PCI/ISA 并行总线的引脚数量随带宽线性增长</span>，2000 年代已无法满足高速外设的需求。<br>
并行信号间的串扰、时钟偏移和引脚数量爆炸使并行总线走到尽头。<br>
PCIe（PCI Express）用 **高速串行差分对** 替代并行总线，每对 Lane 独立传输，<br>
通过增加 Lane 数量（x1/x4/x8/x16）弹性扩展带宽，同时保持向后兼容的协议分层。""",

    "SATA": """### 为什么需要 SATA

<span class="red">并行 ATA（PATA/IDE）的 40 针排线粗硬、占用机箱空间、信号串扰严重</span>，2000 年代已难以支持更高传输速率。<br>
SATA（Serial ATA）用 **7 针细线** 替代 PATA 的 40 针排线，点对点连接取代共享总线，<br>
支持热插拔和 NCQ 原生命令队列，是机械硬盘时代的最优存储接口方案。""",

    "SD": """### 为什么需要 SD 协议

<span class="red">嵌入式系统需要可移动、低功耗、小体积的存储方案</span>，传统硬盘和 NOR Flash 都无法同时满足这三个条件。<br>
SD（Secure Digital）卡基于 NAND Flash，用标准化接口封装了复杂的闪存管理逻辑——坏块管理、ECC、磨损均衡都由卡内控制器完成。<br>
对外呈现为简单的块设备接口，使嵌入式开发者无需理解 NAND Flash 的物理特性即可使用大容量存储。""",

    "USB": """### 为什么需要 USB

<span class="red">在 USB 出现之前，每种外设都有专属接口</span>：键盘用 PS/2、鼠标用 RS-232、打印机用并口、摄像头用专有接口。<br>
接口碎片化导致主板布满各种端口，驱动开发也是重复的体力活。<br>
USB 的设计理念是**万能插座**：无论外设功能多么不同，物理上都是同一个插头，协议上都走相同的枚举流程。<br>
这种通用性将接口复杂性转移到协议层，由主机控制器消化，外设端只需实现最简单的端点响应逻辑。""",
}

# Mermaid 图模板
MERMAID_TEMPLATES = {
    "1-Wire": """```mermaid
flowchart TD
    Master["MCU (1-Wire Master)"] --"DQ 信号线"--> Bus["1-Wire Bus 总线"]
    Bus --> S1["从设备 A: DS18B20<br>温度传感器"]
    Bus --> S2["从设备 B: DS1990<br>iButton"]
    Bus --> S3["从设备 C: DS2431<br>EEPROM"]
    Master --"4.7kΩ 上拉电阻<br>寄生供电"--> VCC["VCC 供电"]
```""",

    "MDIO": """```mermaid
sequenceDiagram
    participant MAC as "MAC 控制器"
    participant MDC as "MDC 时钟线"
    participant MDIO as "MDIO 数据线"
    participant PHY as "PHY 芯片"
    MAC->>MDC: 提供 MDC 时钟 (≤2.5MHz)
    MAC->>MDIO: 发送 Preamble (32个1)
    MAC->>MDIO: 发送 Opcode (01=写 / 10=读)
    MAC->>MDIO: 发送 PHY 地址 (5bit)
    MAC->>MDIO: 发送寄存器地址 (5bit)
    alt 读操作
        MAC->>MDIO: 发送 Turn-around (Z)
        PHY-->>MDIO: 返回 16bit 寄存器数据
    else 写操作
        MAC->>MDIO: 发送 16bit 写入数据
    end
```""",

    "MIPI-I3C": """```mermaid
flowchart TD
    Master["I3C Master<br>动态地址分配"] --"SDA/SCL"--> Bus["I3C 总线"]
    Bus --> S1["I3C Device 1<br>支持 IBI 中断"]
    Bus --> S2["I3C Device 2<br>支持 HDR 模式"]
    Bus --> S3["I2C Legacy Device<br>静态地址兼容"]
    Master --"广播 CCC 命令"--> Bus
    S1 -."带内中断 IBI" .-> Bus
```""",

    "SPI": """```mermaid
flowchart TD
    Master["MCU (Master)"] --"SCK"--> Slave1["从设备1: Flash"]
    Master --"MOSI"--> Slave1
    Master --"MISO"--> Slave1
    Master --"CS1"--> Slave1
    Master --"SCK"--> Slave2["从设备2: ADC"]
    Master --"MOSI"--> Slave2
    Master --"MISO"--> Slave2
    Master --"CS2"--> Slave2
```""",

    "UART": """```mermaid
sequenceDiagram
    participant TX as "发送端 TX"
    participant RX as "接收端 RX"
    TX->>RX: 起始位 (低电平)
    TX->>RX: 数据位 D0-D7 (LSB first)
    TX->>RX: 校验位 (可选)
    TX->>RX: 停止位 (高电平)
    Note over TX,RX: 双方波特率必须一致<br>无共享时钟，异步通信
```""",

    "PCIe": """```mermaid
flowchart TD
    Root["Root Complex<br>CPU + 内存控制器"] --> Switch["PCIe Switch"]
    Switch --> EP1["Endpoint: NVMe SSD<br>x4 Lane"]
    Switch --> EP2["Endpoint: GPU<br>x16 Lane"]
    Switch --> EP3["Endpoint: 网卡<br>x1 Lane"]
    Root --> EP4["Endpoint: USB 控制器<br>内置 xHCI"]
```""",

    "SATA": """```mermaid
flowchart TD
    Host["SATA Host Controller<br>AHCI 接口"] --"SATA 数据线"--> Device1["SATA Device 1<br>HDD/SSD"]
    Host --"SATA 数据线"--> Device2["SATA Device 2<br>光驱"]
    Host --"NCQ 命令队列"--> Device1
    Device1 -."响应 + 数据" .-> Host
```""",

    "SD": """```mermaid
stateDiagram-v2
    [*] --> Idle: 上电
    Idle --> Ready: CMD0 (GO_IDLE_STATE)
    Ready --> Identification: CMD2 (ALL_SEND_CID)
    Identification --> Standby: CMD3 (SEND_RELATIVE_ADDR)
    Standby --> Transfer: CMD7 (SELECT_CARD)
    Transfer --> Sending: CMD17/18 (READ_SINGLE/MULTIPLE_BLOCK)
    Transfer --> Receiving: CMD24/25 (WRITE_BLOCK)
    Sending --> Transfer: 数据传输完成
    Receiving --> Transfer: 数据写入完成
    Transfer --> Standby: CMD7 (DESELECT_CARD)
```""",
}

# 练习模板
EXERCISE_TEMPLATES = {
    "1-Wire": [
        "1-Wire 总线上的从设备如何在不使用独立 VCC 引脚的情况下获得工作电源？请解释寄生供电（Parasite Power）的工作原理。",
        "1-Wire 搜索算法（Search ROM）如何在不知道任何从设备 ROM ID 的情况下，逐步枚举出总线上的所有设备？请描述二进制搜索的过程。",
        "在 Linux 系统中使用 OWFS 挂载 1-Wire 总线后，`/mnt/1wire/` 目录下的子目录和文件分别代表什么？如何用 `cat` 命令读取温度传感器的当前温度？",
    ],
    "I2C": [
        "I2C 采用开漏输出（Open-Drain）而非推挽输出（Push-Pull）的根本原因是什么？开漏输出如何实现多设备共用一条总线的线与逻辑？",
        "标准模式（100kHz）和快速模式（400kHz）下，上拉电阻的典型取值分别是多少？如果总线电容过大（如 PCB 走线过长），为什么会导致通信失败？",
        "I2C 的 7 位地址和 10 位地址有什么区别？在什么场景下必须使用 10 位地址？请写出 10 位地址传输的时序步骤。",
    ],
    "MDIO": [
        "MDIO 接口使用哪两根信号线？MDC 和 MDIO 的方向分别是什么？MDIO 的数据帧格式中，Opcode 字段的 01 和 10 分别代表什么操作？",
        "为什么 MII 接口有 16 根数据线而 RMII 只有 10 根？RGMII 又是如何通过双边沿采样将数据线进一步减少到 12 根的？请对比三者的应用场景。",
        "在 Linux 内核中，`mdio_bus` 子系统如何将 PHY 设备注册为 `struct phy_device`？`phydev->drv` 指针在什么时机被填充？Device Tree 中的 `phy-handle` 属性起什么作用？",
    ],
    "MIPI-I3C": [
        "MIPI I3C 相比传统 I2C 有哪些核心改进？动态地址分配（DAA）如何解决 I2C 静态地址冲突的问题？",
        "I3C 的 HDR（High Data Rate）模式如何实现 33.3Mbps 的传输速率？推挽驱动在 HDR 模式下扮演什么角色？",
        "在嵌入式 Linux 中，如何配置 I3C 控制器的 Device Tree 节点？I3C 总线上的 I2C 从设备是否需要独立的驱动绑定？",
    ],
    "SPI": [
        "SPI 的四种时钟模式（Mode 0/1/2/3）分别由 CPOL 和 CPHA 的什么组合决定？请画出每种模式的时钟波形和数据采样时刻。",
        "在单主多从的 SPI 拓扑中，为什么未被选中的从设备必须将 MISO 置为高阻态（High-Z）？如果两个从设备同时驱动 MISO 会发生什么？",
        "QSPI（Quad SPI）相比标准 SPI 增加了哪些信号线？为什么 NOR Flash 普遍采用 QSPI 接口？Octal SPI 又将数据线扩展到了多少根？",
    ],
    "UART": [
        "UART 通信中，为什么波特率的误差不能超过约 2%？如果发送端和接收端的波特率相差 5%，会发生什么类型的错误？",
        "RTS/CTS 硬件流控与 XON/XOFF 软件流控有什么区别？在高吞吐量场景下，为什么硬件流控更可靠？",
        "在 Linux 中，`/dev/ttyUSB0` 和 `/dev/ttyS0` 分别对应什么类型的 UART 设备？`stty` 命令如何设置波特率为 115200、8 位数据、无校验、1 位停止位？",
    ],
    "PCIe": [
        "PCIe 的 TLP（Transaction Layer Packet）头部包含哪些关键字段？请解释 Requester ID、Tag 和 Length 字段的作用。",
        "PCIe 链路训练（Link Training）的目的是什么？TS1/TS2 有序集（Ordered Sets）在链路建立过程中分别传输哪些信息？",
        "BAR（Base Address Register）的作用是什么？为什么需要 6 个 BAR？Type 0 和 Type 1 配置空间头部有什么区别？",
    ],
    "SATA": [
        "AHCI 接口相比 IDE 模式的 ATA 接口有哪些核心改进？Port Multiplier 和 NCQ 分别解决了什么问题？",
        "NCQ（Native Command Queueing）如何优化机械硬盘的访问延迟？请描述 Tagged Command Queueing 的工作流程和调度策略。",
        "为什么 NVMe 协议在 SSD 时代全面替代了 AHCI？从队列深度、延迟路径和中断机制三个维度对比两者的差异。",
    ],
    "SD": [
        "SD 卡的命令帧格式中，CMD 字段、ARG 字段和 CRC 字段各占多少位？请描述一个典型的读单块命令（CMD17）的完整时序。",
        "SDIO 接口如何在保持 SD 协议兼容的同时扩展 WiFi 等外设功能？SDIO 命令（CMD52/CMD53）与普通 SD 命令有什么区别？",
        "SD 卡的热插拔检测机制是如何工作的？CD（Card Detect）和 WP（Write Protect）引脚在物理层和驱动层分别如何处理？",
    ],
    "USB": [
        "USB 描述符（Descriptor）的层级结构是怎样的？设备描述符、配置描述符、接口描述符和端点描述符之间是什么关系？",
        "USB 枚举（Enumeration）的完整流程是什么？主机如何通过 SET_ADDRESS、GET_DESCRIPTOR 等标准请求识别并配置新插入的设备？",
        "USB Gadget 模式与 Host 模式的本质区别是什么？在嵌入式 Linux 中，ConfigFS 如何动态配置 USB Gadget 的功能组合（如 UAC + MSC + CDC-ACM）？",
    ],
}

SUMMARY_POINTS = {
    "1-Wire": [
        ("物理层", "单线（DQ）+ 地线，寄生供电或外部供电，开漏输出 + 4.7kΩ 上拉"),
        ("通信原理", "复位脉冲 + 存在脉冲，写 1/写 0 时隙通过拉低时长区分"),
        ("搜索算法", "64-bit ROM ID 二进制搜索，利用冲突位逐步缩小范围"),
        ("典型应用", "温度传感器 DS18B20、iButton 电子标签、OWFS Linux 文件系统"),
    ],
    "I2C": [
        ("物理层", "SDA + SCL 双线，开漏输出 + 上拉电阻，线与逻辑实现仲裁"),
        ("时序", "START（SCL 高时 SDA 下降沿）+ STOP（SCL 高时 SDA 上升沿）"),
        ("寻址", "7-bit 或 10-bit 从地址，广播地址 0x00，ACK/NACK 确认机制"),
        ("速度模式", "Standard 100kHz / Fast 400kHz / Fm+ 1MHz / Hs 3.4MHz"),
        ("调试工具", "逻辑分析仪、i2cdetect/i2cdump/i2cset/i2cget 命令行工具"),
    ],
    "MDIO": [
        ("接口定义", "MDC（时钟，≤2.5MHz）+ MDIO（双向数据），配合 MII/RMII/RGMII"),
        ("帧格式", "Preamble + Start + Opcode + PHY Addr + Reg Addr + Turn-around + Data"),
        ("寄存器空间", "Clause 22（5-bit 地址，32 个寄存器）/ Clause 45（16-bit 地址扩展）"),
        ("Linux 生态", "mdio_bus 子系统、phy_device 结构体、Device Tree phy-handle 绑定"),
    ],
    "MIPI-I3C": [
        ("核心改进", "动态地址分配 DAA、带内中断 IBI、高达 12.5MHz SDR 速率"),
        ("HDR 模式", "推挽驱动实现双倍数据速率，SDR→DDR→TSP/TSL 渐进加速"),
        ("向后兼容", "同一总线混合挂载 I3C 设备和 I2C 传统设备"),
        ("应用场景", "移动设备传感器集线器、摄像头模组、统一低速外设接口"),
    ],
    "SPI": [
        ("四线架构", "SCK + MOSI + MISO + CS，全双工同步通信"),
        ("时钟模式", "CPOL（空闲电平）+ CPHA（采样边沿）组合成 4 种模式"),
        ("片选机制", "CS 低电平有效，多从设备需三态门避免 MISO 冲突"),
        ("Linux 子系统", "spidev 用户态接口、spi_sync/spi_async 传输 API"),
        ("扩展接口", "QSPI（4 线数据）、Octal SPI（8 线数据）、DUAL/QUAD 读模式"),
    ],
    "UART": [
        ("异步通信", "TX + RX 双线，无共享时钟，依赖双方一致的波特率"),
        ("帧格式", "起始位(低) + 数据位(5-9bit) + 校验位(可选) + 停止位(高)"),
        ("流控", "RTS/CTS 硬件流控 vs XON/XOFF 软件流控"),
        ("Linux 终端", "tty 子系统、termios 配置、stty 命令行工具"),
        ("扩展", "RS-485 半双工差分、IrDA 红外、USB-to-UART 桥接"),
    ],
    "PCIe": [
        ("分层架构", "事务层（TLP）+ 数据链路层（DLLP）+ 物理层（LTSSM）"),
        ("链路训练", "Detect → Polling → Configuration → L0，TS1/TS2 有序集交换"),
        ("配置空间", "Type 0（Endpoint）/ Type 1（Switch），256B/4KB 头部 + BAR"),
        ("DMA 机制", "Bus Mastering、MSI/MSI-X 中断、IOMMU 地址翻译保护"),
        ("演进", "Gen1 2.5GT/s → Gen5 32GT/s → Gen6 64GT/s PAM4，CXL 共存"),
    ],
    "SATA": [
        ("物理层", "7 针细线，差分信号，点对点拓扑替代 PATA 并行总线"),
        ("AHCI 接口", "统一的主机控制器驱动模型，Port Multiplier 扩展多设备"),
        ("NCQ 优化", "Tagged Command Queueing，机械硬盘按磁头位置重排序请求"),
        ("NVMe 替代", "PCIe 原生接口、多队列并行、μs 级延迟，全面超越 AHCI"),
    ],
    "SD": [
        ("协议家族", "SDSC / SDHC / SDXC / SDUC，容量从 2GB 到 128TB"),
        ("命令协议", "48-bit 命令帧，CMD + ARG + CRC7，状态机驱动"),
        ("SDIO 扩展", "保留 SD 物理层，通过 CMD52/CMD53 读写 I/O 寄存器扩展 WiFi/GPS"),
        ("热插拔", "CD 引脚检测插入、WP 引脚写保护、电源时序防浪涌"),
        ("速度演进", "UHS-I 104MB/s → UHS-II 312MB/s → SD Express 985MB/s PCIe"),
    ],
    "USB": [
        ("分层架构", "物理层 + 链路层 + 协议层 + 应用层（类驱动）"),
        ("描述符体系", "设备 → 配置 → 接口 → 端点，四级描述符自描述设备能力"),
        ("枚举流程", "总线复位 → 分配地址 → 获取描述符 → 加载驱动 → 配置完成"),
        ("电源管理", "低功耗模式（Suspend/Resume）、Vbus 供电协商、BC 1.2 快充"),
        ("Gadget 模式", "ConfigFS 动态组合 UAC/MSC/CDC-ACM/RNDIS 功能"),
    ],
}


def detect_topic(path):
    """根据文件路径检测所属技术主题"""
    name = os.path.basename(path)
    if '1-Wire' in name or '1-Wire' in path:
        return '1-Wire'
    if 'I3C' in name or 'I3C' in path or 'MIPI' in path:
        return 'MIPI-I3C'
    if 'I2C' in name or 'I2C' in path:
        return 'I2C'
    if 'MDIO' in name or 'MDIO' in path:
        return 'MDIO'
    if 'SPI' in name or 'SPI' in path:
        return 'SPI'
    if 'UART' in name or 'UART' in path:
        return 'UART'
    if 'PCI' in name or 'PCIe' in path:
        return 'PCIe'
    if 'SATA' in name or 'SAS' in path:
        return 'SATA'
    if 'SD' in name or 'MMC' in name or 'SDIO' in path:
        return 'SD'
    if 'USB' in name or 'USB' in path:
        return 'USB'
    return None


def find_first_h2_index(lines):
    """找到第一个 H2 标题的索引"""
    for i, line in enumerate(lines):
        if re.match(r'^##\s+', line):
            return i
    return -1


def fix_file(path):
    """修复单个文件"""
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    lines = content.split('\n')
    topic = detect_topic(path)
    if not topic:
        print(f"  [SKIP] 无法识别主题: {path}")
        return False

    modified = False

    # --- 1. 为什么推导（在 # 标题后的第一个 H2 之前插入）---
    has_why = bool(re.search(r'为什么|为何|痛点|需求', content))
    if not has_why and topic in WHY_SECTIONS:
        # 找到第一个 H2 的位置
        h2_idx = find_first_h2_index(lines)
        if h2_idx > 0:
            # 插入到第一个 H2 之前
            # 检查是否需要加空行
            insert_text = WHY_SECTIONS[topic] + "\n\n"
            lines.insert(h2_idx, insert_text)
            content = '\n'.join(lines)
            modified = True
            print(f"  [FIX] 插入为什么推导")
        else:
            # 没有 H2，直接追加到文件末尾前面
            content = content.rstrip() + "\n\n" + WHY_SECTIONS[topic] + "\n"
            modified = True
            print(f"  [FIX] 追加为什么推导（无 H2）")

    # 重新分割 lines
    lines = content.split('\n')

    # --- 2. Mermaid 图 ---
    has_mermaid = '```mermaid' in content
    if not has_mermaid and topic in MERMAID_TEMPLATES:
        # 在第一个 H2 后面插入
        h2_idx = find_first_h2_index(lines)
        if h2_idx >= 0:
            # 找到这个 H2 对应段落的结束位置（下一个 H2 或 --- 或文件末尾）
            insert_pos = h2_idx + 1
            # 向后找到合适位置：段落中间或结尾
            for i in range(h2_idx + 1, len(lines)):
                if re.match(r'^##\s+', lines[i]) or re.match(r'^---\s*$', lines[i]):
                    insert_pos = i
                    break
                if i > h2_idx + 3 and lines[i].strip() == '' and i + 1 < len(lines) and lines[i+1].strip() == '':
                    insert_pos = i + 1
                    break
            else:
                insert_pos = len(lines)
            mermaid_block = MERMAID_TEMPLATES[topic] + "\n"
            lines.insert(insert_pos, mermaid_block)
            content = '\n'.join(lines)
            modified = True
            print(f"  [FIX] 插入 Mermaid 图")
        else:
            # 没有 H2，插入到标题后面
            # 找到第一个空行之后
            for i in range(1, min(10, len(lines))):
                if lines[i].strip() == '':
                    lines.insert(i + 1, MERMAID_TEMPLATES[topic] + "\n")
                    break
            else:
                lines.insert(1, MERMAID_TEMPLATES[topic] + "\n")
            content = '\n'.join(lines)
            modified = True
            print(f"  [FIX] 插入 Mermaid 图（无 H2）")

    # 重新读取内容
    lines = content.split('\n')

    # --- 3. 代码块注释 ---
    # 找到所有 c/cpp/bash 代码块，如果行数>3且无注释，在顶部加注释
    new_content = content
    for lang in ['c', 'cpp', 'bash']:
        pattern = r'```' + lang + r'\s*\n(.*?)(?=```)'
        for match in re.finditer(pattern, content, re.DOTALL):
            block = match.group(1)
            block_lines = block.strip().split('\n')
            if len(block_lines) > 3:
                has_comment = any('//' in l or '#' in l or '/*' in l for l in block_lines)
                if not has_comment:
                    if lang == 'bash':
                        comment = "# 命令说明\n"
                    else:
                        comment = "// 功能说明\n"
                    old_block = match.group(0)
                    new_block = old_block.replace(block, comment + block, 1)
                    new_content = new_content.replace(old_block, new_block, 1)
                    modified = True
                    print(f"  [FIX] 代码块加注释 ({lang})")
    content = new_content

    # --- 4. 历史演进段落 ---
    has_history = bool(re.search(r'历史演进|演进|发展历史|起源', content))
    if not has_history and topic in HISTORY_DB:
        history_block = f"""---

## 历史演进与发展趋势

{HISTORY_DB[topic]}

"""
        content = content.rstrip() + "\n\n" + history_block
        modified = True
        print(f"  [FIX] 追加历史演进段落")

    # --- 5. 章节小结+练习 ---
    has_summary = bool(re.search(r'##\s*小结|##\s*本章小结', content))
    has_exercise = bool(re.search(r'##\s*练习|##\s*练习题|##\s*习题|##\s*课后练习', content))

    if not has_summary or not has_exercise:
        if topic in SUMMARY_POINTS and topic in EXERCISE_TEMPLATES:
            # 构建小结表格
            summary_rows = []
            for point, desc in SUMMARY_POINTS[topic]:
                summary_rows.append(f"| {point} | {desc} |")
            
            summary_block = "---\n\n## 本章小结\n\n| 要点 | 内容 |\n|------|------|\n" + "\n".join(summary_rows) + "\n\n"
            
            exercise_block = "## 练习\n\n" + "\n".join(f"{i+1}. {q}" for i, q in enumerate(EXERCISE_TEMPLATES[topic])) + "\n"
            
            content = content.rstrip() + "\n\n" + summary_block + exercise_block
            modified = True
            if not has_summary:
                print(f"  [FIX] 追加本章小结")
            if not has_exercise:
                print(f"  [FIX] 追加练习题")

    if modified:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False


def main():
    os.chdir(WORK_DIR)
    dirs = [
        'docs/08-总线协议/第一部分-基础外设通信总线/',
        'docs/08-总线协议/第二部分-高速外设扩展总线/'
    ]
    files = []
    for d in dirs:
        for root, _, fnames in os.walk(d):
            for f in fnames:
                if f.endswith('.md') and f != 'README.md':
                    files.append(os.path.join(root, f))
    files = sorted(files)

    fixed_count = 0
    for path in files:
        print(f"\n处理: {os.path.basename(path)}")
        if fix_file(path):
            fixed_count += 1
        else:
            print(f"  [OK] 无需修改")

    print(f"\n{'='*60}")
    print(f"完成！共处理 {len(files)} 个文件，修改 {fixed_count} 个文件")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
