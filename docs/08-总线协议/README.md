# 总线协议

<span class="badge-b">[Beginner → Master]</span>

<span class="red">总线协议</span> 是嵌入式系统中各个组件互联通信的 "神经网络"，决定数据传输的速度、可靠性和功耗。

---

## <strong>模块概览</strong>

<span class="green">08-总线协议</span> 按速率和场景分为八大类别，覆盖从片内IP互联到工业现场通信的全谱系：

| 类别 | 定位 | 代表总线 |
|------|------|----------|
| <span class="green">片内SoC总线</span> | 芯片内部IP互联 | AXI/AHB/APB/TileLink |
| <span class="green">基础外设通信总线</span> | 低速传感器与外设 | I2C/SPI/UART/1-Wire |
| <span class="green">高速外设扩展总线</span> | 高速数据传输 | PCIe/USB/SATA/SD |
| <span class="green">存储设备专用总线</span> | 存储器接口 | eMMC/UFS/QPI |
| <span class="green">车载与网络互联总线</span> | 汽车电子与实时网络 | CAN/LIN/TSN |
| <span class="green">工业现场总线</span> | 工厂自动化 | EtherCAT/Modbus/PROFIBUS |
| <span class="green">音视频专用总线</span> | 多媒体采集与显示 | I2S/MIPI-DSI/CSI-2 |
| <span class="green">调试与跟踪专用总线</span> | 芯片调试与烧录 | JTAG/SWD/CoreSight |

---

## <strong>BIEM 学习路径</strong>

```mermaid
graph LR
    A[基础外设通信] -->|建立直觉| B[片内SoC总线]
    B -->|理解机制| C[高速外设扩展]
    C -->|掌握实战| D[存储与车载总线]
    D -->|设计权衡| E[工业与调试总线]
    E -->|洞察趋势| F[前沿技术]
```

| 级别 | 目标 | 推荐起点 |
|------|------|----------|
| <span class="badge-b">B</span> | 看懂时序图、选对总线 | I2C/SPI/UART 基础认知 |
| <span class="badge-i">I</span> | 跟读协议代码、排错 | AXI/AHB 原理解析 |
| <span class="badge-e">E</span> | 设计总线架构、优化性能 | PCIe/TSN 实战与优化 |
| <span class="badge-m">M</span> | 制定标准、参与演进 | CXL/CAN-XL/工业4.0 |

---

## <strong>总线选型决策树</strong>

### <strong>按速率选型</strong>

- <span class="blue">< 1 Mbps</span> → 1-Wire、LIN、Modbus-RTU<br>
- <span class="blue">1 Mbps - 100 Mbps</span> → I2C、SPI、UART、CAN、MDIO<br>
- <span class="blue">100 Mbps - 10 Gbps</span> → USB2/3、SATA、车载以太网、EtherCAT<br>
- <span class="blue">> 10 Gbps</span> → PCIe、NVMe over Fabrics、MIPI、TSN 10G<br>

### <strong>按场景选型</strong>

| 场景 | 推荐总线 | 为什么 |
|------|----------|--------|
| 温度传感器阵列 | I2C 或 1-Wire | 多从设备、布线简单 |
| 显示屏接口 | MIPI-DSI 或 SPI | 高带宽、低引脚数 |
| 汽车动力总成 | CAN FD | 实时性、抗干扰、行业标准 |
| 工业伺服控制 | EtherCAT | 纳秒级同步、确定性 |
| 高速存储 | PCIe NVMe | 最高性能、低延迟 |
| SoC内部互联 | AXI 或 TileLink | 标准化、IP复用 |

---

## <strong>历史演进脉络</strong>

<span class="red">总线协议的演进是嵌入式系统发展的缩影。</span>

- <span class="green">1980s</span> — I2C、SPI、UART 奠定低速通信基础<br>
- <span class="green">1990s</span> — AMBA 标准化片内总线，PCI 定义扩展接口<br>
- <span class="green">2000s</span> — USB 统一外设接口，CAN 主导汽车电子<br>
- <span class="green">2010s</span> — PCIe 替代 PCI，MIPI 统治移动设备，EtherCAT 革新工业<br>
- <span class="green">2020s</span> — CXL 重构内存架构，TSN 融合IT/OT，CAN-XL 面向自动驾驶

---

## <strong>小结与练习</strong>

| 要点 | 说明 |
|------|------|
| 核心概念 | 总线协议 = 电气规范 + 时序规范 + 协议规范 |
| 关键技能 | 根据速率/距离/拓扑/功耗四维度选型 |
| 常见误区 | 忽视信号完整性、混淆主从与对等模式 |

**练习**

1. 设计一个物联网网关的总线架构，需同时连接传感器、WiFi模块、存储和调试口，列出各接口的总线选择及理由。
2. 比较 I2C 和 SPI 在速率、布线、多主支持上的差异，什么场景选 I2C，什么场景选 SPI？
3. 分析 PCIe 从 1.0 到 6.0 的演进路线，每一代的核心改进是什么？

---

## 快速导航

- [基础外设通信总线](基础外设通信总线/README.md)
- [片内SoC总线](片内SoC总线/README.md)
- [高速外设扩展总线](高速外设扩展总线/README.md)
- [存储设备专用总线](存储设备专用总线/README.md)
- [车载与网络互联总线](车载与网络互联总线/README.md)
- [工业现场总线](工业现场总线/README.md)
- [音视频专用总线](音视频专用总线/README.md)
- [调试与跟踪专用总线](调试与跟踪专用总线/README.md)
