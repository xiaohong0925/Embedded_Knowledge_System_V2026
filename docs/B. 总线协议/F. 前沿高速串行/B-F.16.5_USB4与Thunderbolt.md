# B-F.16.5 USB4 与 Thunderbolt

> 所属章节：第五部 B. 总线协议 > F. 前沿高速串行
>
> 难度：[M] | 预计阅读时间：35 分钟

## 本节导读

USB4 是 USB 家族的一次架构革命：它不再是"一种更快的 USB"，而是一台**协议隧道交换机**——同一根 Type-C 线缆里，PCIe、DisplayPort、USB 3.2 三种协议的流量被打包成隧道包分时复用。一个扩展坞插上去，显示器、网卡、NVMe 硬盘同时工作，靠的就是这套隧道机制。

它与前代 USB 的关系、与 Thunderbolt 的血缘，是理解它的两条主线：USB4 的技术底子是 Intel 2019 年捐给 USB-IF 的 Thunderbolt 3；Thunderbolt 4/5 则是在 USB4 基础上加强制认证要求的"满血版"。对嵌入式工程师来说，USB4 的意义在于它正在下放——新 SoC 开始集成 USB4 控制器，Type-C 一线通（数据+显示+供电）正在成为高端嵌入式设备的标配。

本节覆盖：隧道化架构与三种隧道路径、速率档位与编码、USB4 与 Thunderbolt 的版本对照、DP Alt Mode 与 DP 隧道的关系、Linux 的 thunderbolt 驱动与安全级别、嵌入式场景的选型与排障。

先修：B-C.7 USB 子系统（枚举与描述符）、B-D.10.1 PCIe（隧道载荷之一）。

## 隧道化架构：一根线里的三条高速公路

传统 USB 是单一协议总线：线上跑的永远是 USB 包。USB4 改换了思路——它自己定义一套链路层，把**其他协议的数据封装成隧道包**在线上传输，到对端再还原：

```
                    ┌─────────────────────────────┐
   PCIe 事务 ──────►│ PCIe 隧道适配器              │
                    │      ↓ 封装                 │
   DP 视频流 ──────►│ DP 隧道适配器  ──► USB4 路由器 ──► Type-C 链路
                    │      ↓ 封装                 │      （20/40/80G）
   USB 3.2 数据 ───►│ USB3 隧道适配器              │
                    └─────────────────────────────┘

   对端还原：USB4 路由器按包类型分流 → 各协议适配器解封装 → 原生协议出口
```

> 隧道（Tunneling）：把 A 协议的完整数据包当作"货物"装进 B 协议的包格式里传输，到目的地拆封还原。对 PCIe/DP 来说，它们根本不知道自己经过了 USB4——就像集装箱里的货物不知道自己坐的是船还是火车。这是 USB4 与"USB 兼容模式"的本质区别：不是转接，是原样搬运。

三类隧道的分工：

| 隧道 | 载荷 | 典型应用 |
|------|------|---------|
| PCIe 隧道 | 原生 PCIe 事务（TLP） | 扩展坞里的网卡/NVMe/万兆网口、外置显卡 |
| DP 隧道 | DisplayPort 视频流 | 一根线带 4K/8K 显示器 |
| USB3 隧道 | USB 3.2 数据 | 兼容传统 USB 设备 |

> 💡 PCIe 隧道的推论非常重要：扩展坞里的设备对操作系统就是**普通 PCIe 设备**。插上 USB4 扩展坞，Linux 的 `lspci` 会多出一串设备，驱动照常加载——不需要任何"USB4 设备驱动"。理解这一点，USB4 的神秘感就消失了。

链路中还必须有**时间同步**机制：所有隧道共享一条物理链路，USB4 用时分复用 + 精确时钟同步（精度要求 ns 级）保证视频流这类等时流量的延迟确定性。

## 速率档位与编码

| 版本 | 速率 | 编码 | 对称性 |
|------|------|------|--------|
| USB4 Gen 2×2 | 20 Gbit/s | 64b/66b | 对称 |
| USB4 Gen 3×2 | 40 Gbit/s | 64b/66b | 对称 |
| USB4 v2 Gen 4×2 | 80 Gbit/s | **PAM3**（3 电平） | 对称 |
| USB4 v2 Gen 4 非对称 | 120/40 Gbit/s | PAM3 | 显示优先时单向提速 |

两个值得注意的点。一是 USB4 只用 Type-C 接口，Type-A 物理上不存在 USB4——Type-C 的两组高速差分对（TX1/RX1、TX2/RX2）正好支撑"×2"双通道。二是 v2 上 80G 靠的是**编码升级而非频率翻倍**：PAM3 用 3 个电平每符号传约 1.58bit，在相同波特率下比 NRZ 多传 58%——这就是 B-F.16.1 讲的"带宽不够时先升级调制"的典型应用。

## USB4 与 Thunderbolt：一张血缘图

| 维度 | USB4 v1/v2 | Thunderbolt 3 | Thunderbolt 4 | Thunderbolt 5 |
|------|-----------|---------------|---------------|---------------|
| 发布 | 2019 / 2022 | 2015 | 2020 | 2023 |
| 最高速率 | 40 / 80 Gbit/s | 40 Gbit/s | 40 Gbit/s | 80 / 120 Gbit/s |
| PCIe 隧道 | 可选 | 强制 | 强制（32Gbit/s 保底） | 强制（64Gbit/s 保底） |
| DP 支持 | 可选 | 强制 | 强制双 4K | 强制多 8K |
| 认证 | USB-IF 可选 | Intel 强制认证 | 同左 | 同左 |

关系一句话：**USB4 是 Thunderbolt 3 的开放版，Thunderbolt 4/5 是 USB4 的强制满血认证版**。USB4 把大部分特性定为"可选"，所以同样是标 USB4 的口，不同设备能力差距可能很大——选型时要看规格书的具体条目（PCIe 隧道支持与否、DP 几路），不能只看"USB4"三个字。

## DP Alt Mode 与 DP 隧道：别混淆

Type-C 上的视频有两条完全不同的路径：

- **DP Alt Mode（替代模式）**：Type-C 的高速差分对**直接改接**到 DP 信号源，物理切换（ mux ），不经过 USB4 链路。USB 2.0 时代的方案，USB4 之前所有 Type-C 视频输出都是它。
- **DP 隧道**：DP 流封装进 USB4 隧道包，与 PCIe/USB3 流量共存于同一链路。这是 USB4 时代的方式。

区分它们的意义在排障：Alt Mode 下视频不通是 mux/配置问题（CC 逻辑没协商对）；隧道模式下视频不通是链路训练或带宽分配问题。两者的 dmesg 日志路径完全不同。

> CC 逻辑（Configuration Channel）：Type-C 接口上用于协商"谁供电、谁受电、谁是 Host、进什么 Alt Mode"的专用配置通道（B-C.7.1 提到过的 CC 线）。所有 Type-C 高级功能的入口协商都发生在 CC 上，它不通，后面一切免谈。

## Linux 支持：thunderbolt 驱动与安全级别

内核的 `thunderbolt` 驱动同时管 USB4 和 Thunderbolt（代码同源）。用户态的可见面：

```bash
# 设备与拓扑
cat /sys/bus/thunderbolt/devices/*/device_name
lsusb -t                        # USB4 控制器以 xhci 形式出现
lspci                           # 隧道过来的 PCIe 设备直接可见

# 连接管理（安全级别）
cat /sys/bus/thunderbolt/devices/domain0/security
```

> 安全级别（Security Level）：Thunderbolt/USB4 的 PCIe 隧道意味着外设可以直接 DMA 访问内存——插上一个恶意扩展坞等于把内存交出去。为此定义了 SL0~SL3 等级：SL0 不设防；SL1 用户确认；SL2 设备需预授权；SL3 仅 USB/DP 隧道，禁 PCIe。桌面发行版用 `bolt` 守护进程管理授权，嵌入式产品通常固化 SL0 或 SL3，按产品威胁模型选。

设备树层面，USB4 控制器节点与 xHCI 类似（参考时钟、PHY、retimer 描述），差异化部分由各家 SoC 厂商定义；多数嵌入式场景下原厂 BSP 已配好，工程师的工作是验证与排障而非从零 bring-up。

## 嵌入式视角：什么时候会碰到 USB4

| 场景 | USB4 的角色 |
|------|------------|
| 高端单板计算机/模块化电脑 | 一线通扩展：底座里放 NVMe、网卡、显示输出 |
| 数通/仪器前面板 | 调试口同时承担数据 + 显示 + 供电 |
| 机器人/AGV 主控 | 传感器坞站快速插拔（PCIe 隧道接采集卡） |
| 测试测量设备 | 高速数据回传主机（40G 链路跑 PCIe 隧道，等效外插卡） |

选型关注点：SoC 的 USB4 控制器支持哪些隧道（很多只支持 DP + USB3，不支持 PCIe 隧道）；线缆——被动线 0.8m 上限（40G），更长要主动线（内置 redriver/retimer，见 B-F.16.1 器件谱系）；认证状态影响兼容性，工业定制场景可接受非认证方案，消费场景不行。

## 排障速查

| 症状 | 第一怀疑 |
|------|---------|
| 设备只当 USB 2.0 用 | CC 协商失败 / 用了无 E-Marker 的劣质线 |
| 40G 链路只协商到 20G | 线缆不达标（被动线超长）；retimer 固件 |
| 扩展坞里 PCIe 设备不出现 | 安全级别拦截（查 `domain0/security` 与 bolt 状态） |
| 视频无输出但数据正常 | DP Alt Mode 与 DP 隧道路径选错；mux 配置 |
| 插拔后链路不恢复 | 连接管理器固件；换端口复现定位 |

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| 隧道架构 | 画出三类隧道经路由器复用一条链路的结构，解释"不是转接是搬运" |
| 版本血缘 | 说清 USB4 v1/v2 与 Thunderbolt 3/4/5 的对应与强制项差异 |
| 视频路径 | 区分 DP Alt Mode 与 DP 隧道，并说明排障时的不同切入点 |
| 编码演进 | 解释 USB4 v2 靠 PAM3 而非频率翻倍到 80G |
| Linux 面 | 用 sysfs/lspci/bolt 验证隧道设备与安全级别 |
| 选型 | 评审一个 USB4 方案时列出必查项（隧道支持、线缆、认证） |

## 配套资源

- USB4 Specification v1.0/v2.0（usb.org，公开下载）
- Intel Thunderbolt 技术简报（thunderbolttechnology.net）
- 内核文档：`Documentation/admin-guide/thunderbolt.rst`
- bolt 项目（用户态授权管理）：https://gitlab.freedesktop.org/bolt/bolt
- Type-C 与 PD 规范：USB Type-C Specification Release 2.x
