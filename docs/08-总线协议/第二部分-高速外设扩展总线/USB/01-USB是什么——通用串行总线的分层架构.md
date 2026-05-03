# USB是什么——通用串行总线的分层架构

<span class="badge-b">[B]</span> <span class="badge-i">[I]</span> <span class="badge-e">[E]</span> <span class="badge-m">[M]</span>

USB 是嵌入式世界最"普世"的接口。
从键盘鼠标到 5G 模组，从 12Mbps 到 80Gbps，
本章带你认识这个历经 28 年仍在进化的协议家族。

---

## 核心定义与价值

<span class="red">USB（Universal Serial Bus）</span> 是由 Intel、Microsoft、IBM 等公司于 1996 年推出的通用外设接口标准。
它用主从架构（Host→Device）、统一连接器、即插即用和热插拔，
终结了 PC 外设接口的"战国时代"（串口、并口、PS/2、SCSI 并存）。

**USB 的核心价值：**

- 一根线缆同时传输数据、供电、控制信号
- Host 主导所有通信，Device 被动响应，协议简单可靠
- 从低速 HID 到超高速存储，同一个协议栈覆盖全场景
- Linux 生态极其成熟：usbcore + HCD + Class Driver

---

### 类比：邮局系统

USB 像一套高效的邮政系统：

- <span class="green">Host</span> = 中央邮局（掌控全局，决定信件何时发送）
- <span class="green">Device</span> = 各区域的投递站（只能接收和响应，不能主动发信）
- <span class="green">Endpoint</span> = 信箱（每个投递站有多个信箱，分类处理）
- <span class="green">Pipe</span> = 邮路（Host 和 Endpoint 之间的逻辑通道）
- <span class="green">Packet</span> = 信件（Token + Data + Handshake 三段式）
- <span class="green">枚举</span> = 新投递站开业时向邮局登记（获取地址、报上业务范围）
- <span class="green">Hub</span> = 区域分拣中心（一个 Hub 连接多个 Device，扩展端口）

---

## 核心机制原理解析

### <strong>1. USB 版本演进：从 1.5Mbps 到 80Gbps</strong>

<br>

| 版本 | 年份 | 速率 | 信号线 | 连接器 | 核心变化 |
|------|------|------|--------|--------|---------|
| USB 1.0 Low Speed | 1996 | 1.5 Mbps | D+/D- | Type-A/B | 初代 |
| USB 1.1 Full Speed | 1998 | 12 Mbps | D+/D- | Type-A/B | 修正 1.0 缺陷 |
| USB 2.0 High Speed | 2000 | 480 Mbps | D+/D- | Type-A/B/Mini/Micro | 480x 提速 |
| USB 3.0 SuperSpeed | 2008 | 5 Gbps | SSTX+/SSTX-/SSRX+/SSRX- | Type-A/B/Micro | 新增差分对 |
| USB 3.1 Gen2 | 2013 | 10 Gbps | 同上 | Type-C 引入 | 速率翻倍 |
| USB 3.2 Gen2×2 | 2017 | 20 Gbps | 双通道 | Type-C 独占 | 双通道并行 |
| USB4 Gen2 | 2019 | 20 Gbps | 基于 TB3 | Type-C | 隧道化 PCIe/DP |
| USB4 Gen3 | 2019 | 40 Gbps | 基于 TB3 | Type-C | 40G 全速 |
| USB4 v2 | 2022 | 80 Gbps | PAM3 | Type-C | 双向 80G |

<br>

<span class="blue">命名混乱的澄清：
2017 年后 USB-IF 将命名改为"Gen X"体系，但市场仍混用旧名。
USB 3.0 = USB 3.1 Gen1 = USB 3.2 Gen1×1 = 5Gbps。
USB 3.1 Gen2 = USB 3.2 Gen2×1 = 10Gbps。
USB 3.2 Gen2×2 = 20Gbps（Type-C 独占）。</span>

---

### <strong>2. USB 物理层：从 2 线到 10 线的进化</strong>

<br>

**USB 2.0 引脚（Type-A）：**

| 引脚 | 颜色 | 信号 | 说明 |
|------|------|------|------|
| 1 | 红 | VBUS | +5V 供电 |
| 2 | 白 | D- | 差分对负 |
| 3 | 绿 | D+ | 差分对正 |
| 4 | 黑 | GND | 地 |

<br>

**USB 3.0 新增引脚（SuperSpeed）：**

| 引脚 | 信号 | 说明 |
|------|------|------|
| 5 | StdA_SSRX- | 接收差分对负 |
| 6 | StdA_SSRX+ | 接收差分对正 |
| 7 | GND_DRAIN | 地 |
| 8 | StdA_SSTX- | 发送差分对负 |
| 9 | StdA_SSTX+ | 发送差分对正 |

<br>

**Type-C 引脚（24-pin，双面可用）：**

| 引脚组 | 功能 |
|--------|------|
| VBUS ×4 | +5V 供电（双面） |
| GND ×4 | 地（双面） |
| CC ×2 | Configuration Channel，检测方向和供电能力 |
| D+/D- ×2 | USB 2.0 数据线（双面） |
| TX+/TX-/RX+/RX- ×2 | USB 3.x / USB4 / PCIe / DP（双面各一组） |
| SBU ×2 | Sideband Use，用于 Alternate Mode |

<br>

<span class="blue">Type-C 的革命不仅是正反插，更是引脚数量的暴增：
从 Type-A 的 4-pin 到 Type-C 的 24-pin，
为 Alternate Mode（DP、PCIe、USB4 隧道化）提供了物理基础。</span>

---

### <strong>3. USB 分层架构：从 Host 到 Device 的协议栈</strong>

<br>

```mermaid
graph TD
    A[Client Driver: Mass Storage / CDC / HID] --
    B[USB Core: usbcore]
    B --
    C[HCD: xHCI / EHCI / OHCI]
    C --
    D[Host Controller Hardware]
    D --
    E[USB Cable]
    E --
    F[Device Controller]
    F --
    G[Gadget Driver: f_mass_storage / f_acm]
    G --
    H[Device Function]
```

<br>

| 层次 | Linux 模块 | 功能 |
|------|-----------|------|
| Client Driver | usb-storage / cdc-acm / hid | 解析设备数据 |
| USB Core | usbcore.ko | 设备管理、枚举、urb 调度 |
| HCD | xhci-hcd / ehci-hcd / ohci-hcd | Host 控制器驱动 |
| PHY | phy-usb | 物理层初始化 |

<br>

**Gadget 侧（Device Mode）：**

| 层次 | 模块 | 功能 |
|------|------|------|
| Function Driver | f_mass_storage / f_rndis | 实现具体功能 |
| Gadget Core | gadgetfs / configfs | 配置管理 |
| UDC Driver | dwc3 / musb | USB Device Controller |

---

### <strong>4. 与串口/并口的对比：为什么 USB 统一了外设世界</strong>

<br>

| 特性 | RS-232 串口 | IEEE-1284 并口 | USB 2.0 | USB 3.0 |
|------|-------------|-----------------|---------|---------|
| 速率 | 115.2 Kbps | 1 Mbps | 480 Mbps | 5 Gbps |
| 引脚 | 9 pin | 25 pin | 4 pin | 9 pin |
| 供电 | 无 | 无 | 5V/500mA | 5V/900mA |
| 热插拔 | 不支持 | 不支持 | 支持 | 支持 |
| 即插即用 | 不支持 | 不支持 | 支持 | 支持 |
| 多设备 | 1:1 | 1:1 | 1:127（Hub） | 1:127 |
| 线缆长度 | 15m | 3m | 5m | 3m |
| 拓扑 | 点对点 | 点对点 | 星形（Hub） | 星形 |

<br>

<span class="red">USB 的胜利不是速率胜利，而是生态胜利：
统一连接器 + 统一协议栈 + 统一供电 + 热插拔 + 即插即用，
让外设厂商和用户都只需要面对一个接口。</span>

---

## 技术教学与实战

### Linux USB 设备树绑定

```c
/* arch/arm64/boot/dts/rockchip/rk3399.dtsi */
usbdrd3_0: usb@fe800000 {
    compatible = "rockchip,rk3399-dwc3";
    reg = <0x0 0xfe800000 0x0 0x100000>;
    interrupts = <GIC_SPI 105 IRQ_TYPE_LEVEL_HIGH 0>;
    clocks = <&cru SCLK_USB3OTG0_REF>, ...;
    resets = <&cru SRST_USB3OTG0>, ...;
    dr_mode = "otg";    /* Host / Device / OTG */
    status = "disabled";
};
```

<br>
<span class="green">dr_mode</span> 决定 USB 控制器的工作模式：
- "host" = 仅 Host 模式
- "peripheral" = 仅 Device 模式
- "otg" = 根据 ID 引脚自动切换

---

## 嵌入式专属实战场景

### 场景：STM32 USB OTG 控制器配置

STM32F4/F7/H7 系列的 USB OTG FS/HS 支持 Host、Device 和 OTG 模式。

| 参数 | USB OTG FS | USB OTG HS |
|------|-----------|-----------|
| PHY | 内置 Full Speed PHY | 内置/外接 High Speed PHY |
| 速率 | 12 Mbps | 480 Mbps |
| FIFO 大小 | 1280 byte | 4096 byte |
| 端点数 | 4 IN + 4 OUT | 8 IN + 8 OUT |
| DMA | 无 | 支持 |

<br>

初始化流程：

```c
/* 简化的 STM32 USB 初始化 */
void USB_Init(void) {
    /* 1. 使能 USB 时钟 */
    RCC->AHB1ENR |= RCC_AHB1ENR_OTGFSEN;

    /* 2. 配置 GPIO：PA11=DM, PA12=DP */
    GPIOA->MODER |= (2 << 22) | (2 << 24);  /* AF 模式 */
    GPIOA->AFR[1] |= (10 << 12) | (10 << 16); /* AF10 = OTG */

    /* 3. 复位 USB 控制器 */
    USB_OTG_FS->GRSTCTL = USB_OTG_GRSTCTL_CSRST;
    while (USB_OTG_FS->GRSTCTL & USB_OTG_GRSTCTL_CSRST);

    /* 4. 配置 Device 模式 */
    USB_OTG_FS->GUSBCFG |= USB_OTG_GUSBCFG_FDMOD;

    /* 5. 配置 FIFO */
    USB_OTG_FS->GRXFSIZ = 128;   /* Rx FIFO 128 × 4 = 512 byte */
    USB_OTG_FS->DIEPTXF0_HNPTXFSIZ = (64 << 16) | 128; /* EP0 Tx FIFO */

    /* 6. 使能中断 */
    USB_OTG_FS->GAHBCFG |= USB_OTG_GAHBCFG_GINT;
    NVIC_EnableIRQ(OTG_FS_IRQn);

    /* 7. 连接 D+ 上拉电阻（通知 Host 设备接入） */
    USB_OTG_FS->DCTL &= ~USB_OTG_DCTL_SDIS;
}
```

<br>
<span class="blue">第 7 步的 D+ 上拉是 USB 热插拔检测的关键：
Device 内部将一个 1.5kΩ 电阻连接到 D+（Full Speed）或 D-（Low Speed），
Host 检测到这个上拉后，触发枚举流程。</span>

---

## 历史演进与前沿

### USB 的 28 年演进

| 年份 | 里程碑 | 意义 |
|------|--------|------|
| 1996 | USB 1.0 | 取代串口/并口 |
| 1998 | USB 1.1 | 修正 1.0 的设计缺陷 |
| 2000 | USB 2.0 | 480Mbps，真正普及 |
| 2008 | USB 3.0 | 5Gbps，新增差分对 |
| 2014 | USB Type-C | 正反插，24-pin，PD 基础 |
| 2017 | USB 3.2 | 20Gbps，Gen2×2 |
| 2019 | USB4 | 基于 Thunderbolt 3，40Gbps |
| 2022 | USB4 v2 | 80Gbps，PAM3 |

<br>

<span class="red">USB4 的本质：</span>

- 物理层基于 Thunderbolt 3（Intel 贡献给 USB-IF）
- 协议层支持隧道化：USB3、PCIe、DisplayPort 全部走同一对差分线
- USB4 控制器内部有一个"路由器"，动态分配带宽给不同协议
- <span class="blue">这意味着：USB4 线缆可以同时传输数据、视频和 PCIe，一根线替代了 USB + DP + PCIe 三根线。</span>

---

## 本章小结

| 主题 | 关键要点 |
|------|---------|
| 版本演进 | 1.5M → 12M → 480M → 5G → 10G → 20G → 40G → 80G |
| USB 2.0 | 4-pin：VBUS/D-/D+/GND |
| USB 3.0 | 新增 5-pin 差分对：SSTX+/SSTX-/SSRX+/SSRX- |
| Type-C | 24-pin，CC 检测方向，支持 Alternate Mode |
| 分层 | Client → usbcore → HCD → PHY → Cable → Device |
| 热插拔 | D+ 1.5kΩ 上拉（Full Speed）或 D- 上拉（Low Speed） |

---

## 练习

1. USB 的命名体系在 2017 年后变得混乱。"USB 3.2 Gen2×2"、"USB 3.1 Gen2"、"SuperSpeed USB 10Gbps"、"USB4 Gen2"分别对应什么速率？
2. 为什么 Type-C 的 24-pin 设计是 USB4 的基础？如果 Type-C 只有 12-pin，USB4 的隧道化功能能否实现？
3. 对比 USB 2.0 和 USB 3.0 的线缆：USB 3.0 线缆为什么通常更粗更硬？从信号完整性和供电两个角度分析。
4. STM32 的 USB OTG 控制器中，D+ 上拉电阻在 Device 模式下由谁控制？在 Host 模式下这个上拉还存在吗？
5. USB 从 1996 年到 2022 年经历了 8 次主要版本升级。列举 3 个 USB 版本升级"向后兼容"的具体机制。
