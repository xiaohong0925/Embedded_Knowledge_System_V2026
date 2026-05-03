# USB往哪去——Type-C、PD与前沿演进

<span class="badge-b">[B]</span> <span class="badge-i">[I]</span> <span class="badge-e">[E]</span> <span class="badge-m">[M]</span>

USB 的进化没有停止。
从 Type-C 到 USB4，从 Alternate Mode 到车载诊断，
本章梳理 USB 在嵌入式领域的前沿方向。

---

## 核心定义与价值

<span class="red">USB Type-C</span> 不是"另一种 USB 接口"，而是一个全新的连接平台。
它在 24 个引脚中融合了数据、视频、PCIe 和供电，
目标是成为所有电子设备统一的物理接口。

**Type-C 的核心能力：**

- 正反插（对称设计）
- 动态供电协商（USB PD，最高 240W）
- Alternate Mode（DP、PCIe、Thunderbolt 隧道化）
- 双向供电（Source/Sink 可动态切换）

---

### 类比：万能转接头

USB Type-C 像一把瑞士军刀：

- <span class="green">基础刀刃</span> = USB 2.0 数据线（永远可用）
- <span class="green">主刀刃</span> = USB 3.x 差分对（高速数据传输）
- <span class="green">螺丝刀</span> = DisplayPort 视频输出（Alternate Mode）
- <span class="green">剪刀</span> = PCIe 扩展（USB4 隧道化）
- <span class="green">打火机</span> = USB PD 供电（最高 240W）
- <span class="green">镊子</span> = Sideband Use（调试、配置通道）

但瑞士军刀不是每把刀都一样锋利——Type-C 线缆和端口的能力差异巨大，
需要通过 E-Marker 芯片标识线缆能力。

---

## 核心机制原理解析

### <strong>1. Type-C CC 引脚：方向检测与供电协商</strong>

<br>

Type-C 的核心创新是 CC（Configuration Channel）引脚。

| 状态 | CC1 | CC2 | 插入方向 | Source/Sink |
|------|-----|-----|---------|-------------|
| 未连接 | 悬空 | 悬空 | — | — |
| 正插 | 下拉 | 悬空 | 未翻转 | Source（Rp 上拉） |
| 反插 | 悬空 | 下拉 | 翻转 | Source |
| 连接电源适配器 | 上拉 | 悬空 | 未翻转 | Sink |

<br>

**Rp（上拉电阻）值与供电能力：**

| Rp 值 | Source 电流能力 |
|-------|----------------|
| 56 kΩ | Default USB Power（500mA/900mA） |
| 22 kΩ | 1.5A @ 5V |
| 10 kΩ | 3A @ 5V |

<br>

**E-Marker 芯片：**

- Type-C 线缆中集成的微芯片
- 记录线缆能力：最大电流、最大电压、USB 版本、长度
- Host 通过 CC 引脚的 SOP' 消息读取 E-Marker
- <span class="blue">没有 E-Marker 的线缆，USB PD 限制在 20V/3A（60W）以内；超过 60W 必须使用带 E-Marker 的线缆。</span>

---

### <strong>2. USB4：基于 Thunderbolt 3 的 40Gbps 隧道</strong>

<br>

USB4 是 Thunderbolt 3 的"去 Intel 化"版本——Intel 将 Thunderbolt 协议贡献给 USB-IF，形成了 USB4 标准。

```mermaid
graph TD
    A[USB4 Host] --隧道化--
    B[USB4 Router]
    B --USB3 隧道--
    C[USB3 Device]
    B --PCIe 隧道--
    D[PCIe Device]
    B --DP 隧道--
    E[Display]
```

<br>

| 隧道类型 | 带宽 | 用途 |
|---------|------|------|
| USB3 隧道 | 最高 20Gbps | 兼容现有 USB 设备 |
| PCIe 隧道 | 最高 32Gbps | 外置显卡、NVMe 扩展坞 |
| DisplayPort 隧道 | 最高 8K@60Hz | 视频输出 |

<br>

USB4 的核心组件是 <span class="green">Router</span>：
- Router 接收来自不同协议的包
- 将包映射到统一的 USB4 传输层
- 在另一端解映射，还原为原始协议
- <span class="blue">这意味着：一根 USB4 线缆可以同时传输数据、视频和 PCIe，动态分配带宽。</span>

---

### <strong>3. USB OTG：Host/Device 双角色切换</strong>

<br>

USB OTG（On-The-Go）允许设备在 Host 和 Device 之间动态切换。

| 角色 | 判断方式 | 典型场景 |
|------|---------|---------|
| Host | ID 引脚接地 | 手机连接 U 盘 |
| Device | ID 引脚悬空 | 手机连接 PC |
| OTG | 根据连接伙伴协商 | 手机连接手机 |

<br>

**OTG 的 HNP（Host Negotiation Protocol）：**

1. A-Device（默认 Host，ID 接地）连接 B-Device（默认 Device）
2. A-Device 通过 VBUS 供电
3. 如果 A-Device 需要变成 Device（如手机连接 PC），通过 HNP 交换角色
4. B-Device 成为 Host，A-Device 成为 Device

<br>

**现代替代方案：**
- Type-C 的 DRD（Dual Role Data）和 DRP（Dual Role Power）替代了传统 OTG
- 通过 CC 引脚协商角色，不再需要独立的 ID 引脚

---

### <strong>4. USB 在车载中的角色：CarPlay、Android Auto、OBD</strong>

<br>

| 应用 | USB 角色 | 协议 | 用途 |
|------|---------|------|------|
| CarPlay | Device | iAP2 | iPhone 投屏到车机 |
| Android Auto | Device | AOA（Android Open Accessory） | Android 手机投屏 |
| 充电 | Device/Sink | USB PD | 手机快充 |
| OBD 诊断 | Host | CDC-ACM | 连接 OBD-II 适配器 |
| 数据同步 | Device | MTP/PTP | 媒体文件传输 |

<br>

**车载 USB 的特殊要求：**

- <span class="green">温度范围</span>：-40°C ~ 85°C（工业级连接器）
- <span class="green">振动抗性</span>：符合 ISO 16750-3 振动标准
- <span class="green">EMC</span>：CISPR 25 Class 5 辐射发射要求
- <span class="green">供电</span>：支持 USB PD 3.0 PPS，为手机提供自适应快充

---

### <strong>5. 未来：USB4 v2（80Gbps）与光互联</strong>

<br>

| 技术 | 年份 | 速率 | 关键变化 |
|------|------|------|---------|
| USB4 Gen2 | 2019 | 20Gbps | 基于 TB3 |
| USB4 Gen3 | 2019 | 40Gbps | 双向 40G |
| USB4 v2 | 2022 | 80Gbps | PAM3 调制，非对称模式 |
| 光 USB | 2025+ | 40-120Gbps | 光纤替代铜缆 |

<br>

**USB4 v2 的 80Gbps 模式：**

- 使用 PAM3（三电平调制），每符号 1.5 bit
- 支持 <span class="green">非对称模式</span>：一个方向 80Gbps，另一个方向 40Gbps
- 适用于显示场景：Host→Display 传输 8K 视频需要高带宽，反向只需低带宽控制信号

<br>

**光互联 USB（正在标准化）：**

- USB-IF 正在制定"Active Optical Cable"标准
- 使用光纤传输高速信号，铜线传输供电和低速控制
- 目标长度从 3m 扩展到 100m
- 适用于数据中心、医疗影像、工业相机等长距离场景

---

## 技术教学与实战

### 检测 Type-C 端口能力

```bash
# Linux: 查看 Type-C 端口状态
ls /sys/class/typec/
port0  port0-partner  port0-power-role  port0-data-role

# 查看当前角色
cat /sys/class/typec/port0/power_role
source

cat /sys/class/typec/port0/data_role
host

# 查看支持的 Alternate Mode
cat /sys/class/typec/port0-port0.0/modes
DisplayPort
```

<br>

```bash
# 查看 USB PD 协商结果
cat /sys/class/power_supply/usb/present
cat /sys/class/power_supply/usb/current_max
cat /sys/class/power_supply/usb/voltage_max
```

---

## 嵌入式专属实战场景

### 场景：设计支持 DP Alt Mode 的 Type-C 嵌入式设备

某嵌入式设备需要通过 Type-C 输出视频信号。

硬件设计要点：

| 组件 | 选择 | 说明 |
|------|------|------|
| Type-C 连接器 | 24-pin 全功能 | 支持 USB3 + DP + PD |
| CC 控制器 | TUSB322I / FUSB302 | 处理 CC 检测和 PD 协商 |
| DP 复用器 | PI3WVR12412 / TS3DV642 | 切换 SSTX/SSRX 到 DP 通道 |
| PD 控制器 | FUSB307B / CYPD3177 | USB PD 3.0 供电管理 |

<br>

软件流程：

```
1. CC 控制器检测插入方向
2. 通过 CC 与 Sink 协商供电
3. 通过 PD 消息协商 Alternate Mode = DisplayPort
4. 配置 DP 复用器，将 SSTX/SSRX 切换到 DP 通道
5. 配置视频输出分辨率
6. 开始 DP 视频传输
```

---

## 历史演进与前沿

### USB 连接器的兴衰

| 连接器 | 年份 | 现状 | 原因 |
|--------|------|------|------|
| Type-A | 1996 | 逐步淘汰 | 单向插入，不支持 PD |
| Type-B | 1996 | 已淘汰 | 笨重，仅打印机使用 |
| Mini-AB | 2000 | 已淘汰 | 被 Micro 替代 |
| Micro-AB | 2007 | 已淘汰 | 安卓早期标准，不支持高速 |
| Type-C | 2014 | 主流 | 正反插、PD、Alt Mode |

<br>

<span class="red">趋势预测：</span>

- Type-C 将在 2025-2027 年成为所有消费电子的"唯一"接口
- USB4 将在高端笔记本和工作站普及
- 车载 USB 将从 Type-A 全面转向 Type-C + PD
- 光互联 USB 将在数据中心和专业音视频领域率先落地

---

## 本章小结

| 主题 | 关键要点 |
|------|---------|
| Type-C CC | 方向检测、供电能力（Rp 56k/22k/10k）、E-Marker 芯片 |
| PD 3.1 | EPR 扩展至 240W，电压阶梯 5→9→15→20→28→36→48V |
| USB4 | 基于 TB3，40Gbps，隧道化 USB3/PCIe/DP |
| USB4 v2 | 80Gbps，PAM3，非对称模式 |
| OTG | ID 引脚 / HNP 协商；Type-C 时代由 DRD/DRP 替代 |
| 车载 | CarPlay/AOA + USB PD + OBD-CDC ACM，宽温振动 EMC |
| 光 USB | 2025+，Active Optical Cable，光纤+铜线混合 |

---

## 练习

1. Type-C 的 E-Marker 芯片存储了哪些信息？为什么超过 60W 的供电必须使用带 E-Marker 的线缆？
2. USB4 的 Router 如何实现"隧道化"？对比 USB4 的协议复用与 PCIe 的 SR-IOV 虚拟化，两者有何异同？
3. 某嵌入式设备需要同时支持 USB Host（连接 U 盘）和 USB Device（连接 PC）。
   使用传统 OTG（ID 引脚）和 Type-C DRD 各有什么优劣？
4. USB4 v2 的 80Gbps 使用 PAM3 调制（三电平），相比 PAM4（四电平）有什么优势？
   为什么 USB4 v2 选择了 PAM3 而非 PAM4？
5. 设计一款车载信息娱乐系统的 USB 接口方案：需要同时支持 CarPlay、Android Auto、PD 快充和 OBD 诊断。
   需要多少个物理 USB 端口？每个端口的速率/供电能力如何规划？
