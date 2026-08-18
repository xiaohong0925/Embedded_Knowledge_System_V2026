# B-C.8.1 eMMC 协议深度解析

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[I] | 预计阅读时间：35 分钟

## 本节导读

eMMC（Embedded MultiMediaCard）是嵌入式领域最主流的板载闪存方案：一颗焊在主板上的 BGA 芯片，内部封装了 NAND Flash 裸片和一个专用控制器。手机、平板、工业网关、车载中控里的系统存储，大量都是它。与 SD 卡不同，eMMC 焊死在板子上，没有插拔、没有写保护开关，天生为嵌入式设备设计。

软件工程师接触 eMMC 通常从三个问题开始：Bootloader 怎么从这颗芯片里被加载的（Boot 分区）；固件的防回滚、密钥怎么存（RPMB 分区）；芯片快写坏了系统能不能提前知道（寿命监测）。这三个问题的答案都在 eMMC 的协议与 EXT_CSD 寄存器里。

本节覆盖：eMMC 的物理接口与速度模式、JEDEC 标准演进、四大分区的结构与用途、RPMB 的防重放机制、初始化流程与核心命令集、EXT_CSD 寄存器的关键字段。

## 物理接口与速度模式

eMMC 标准封装是 153-ball BGA，尺寸仅 11.5mm × 13mm，但真正与主控通信的只有 11 根信号线：

| 引脚 | 方向 | 功能 |
|------|------|------|
| CLK | Input | 时钟，所有数据传输由它同步 |
| CMD | 双向 | 命令通道：主控发命令、eMMC 回响应都走这根线 |
| DAT0~DAT7 | 双向 | 8 位数据总线 |
| VDD / VDDQ | 电源 | 核心供电（3.3V/1.8V）/ IO 供电（3.3V/1.8V/1.2V） |
| VSS / VSSQ | 地 | — |
| RST_n | Input | 硬件复位（eMMC 4.41 起可选） |
| DS | Output | 数据选通信号，仅 HS400 模式使用 |

> BGA（Ball Grid Array）：球栅阵列封装——芯片底部以焊球阵列代替引脚，焊接后所有连接都在芯片正下方。优点是引脚密度高、信号路径短；代价是无法手工焊接和飞线，硬件调试只能依赖预留测试点。

8 位数据线是 eMMC 相对 SD 卡（通常 4 位）的核心优势：同频率下理论带宽翻倍。协议规定了四种速度模式：

| 模式 | 时钟范围 | 采样方式 | 8-bit 理论峰值 |
|------|---------|---------|---------------|
| Legacy | 0~26 MHz | 单沿 | 26 MB/s |
| High Speed SDR | 0~52 MHz | 单沿 | 52 MB/s |
| HS200 | 0~200 MHz | 单沿 | 200 MB/s |
| HS400 | 0~200 MHz | 双沿 + DS 选通 | 400 MB/s |

> SDR / DDR：单沿采样（Single Data Rate）在时钟上升沿采样一次数据；双沿采样（Double Data Rate）在上升沿和下降沿各采一次，同样频率下带宽翻倍。HS400 的 400 MB/s 就是 200MHz × 8bit × 2（DDR）算出来的。

上电后 eMMC 一律以 Legacy 模式工作，主控确认双方能力后用 CMD6 逐级切换到更高速率。这个"从低速握手起步"的设计保证了任何年代的主控和芯片都能先建立通信。

> ⚠️ HS400 对 PCB 走线要求苛刻：DAT0~DAT7 与 DS 的长度差要控制在 ±1mm 量级，否则 200MHz 双沿下采样窗口直接被偏移吃掉。硬件同事画板时如果这组线没做等长，现象就是高速模式读写报错、降到 HS200 就正常——遇到"降速就好"的存储问题，先怀疑走线。

## JEDEC 标准演进

eMMC 标准由 JEDEC 制定，目前（2026 年）市场主流仍是 eMMC 5.1（JESD84-B51）：

| 版本 | 年份 | 最高速度模式 | 关键特性 |
|------|------|-------------|---------|
| v4.3 | 2009 | 52MHz HS | 引入 RST_n 复位引脚 |
| v4.4/4.41 | 2010 | 52MHz HS | Cache 功能、Boot 分区增强 |
| v4.5 | 2011 | HS200 | HS200 模式、命令队列雏形 |
| v5.0 | 2013 | HS400 | DDR 模式 + Data Strobe |
| v5.1 | 2015 | HS400 | 现场固件更新（FFU）、增强 Cache、寿命监测 |

eMMC 5.1 之后 JEDEC 没有再推 eMMC 大版本——更高性能的板载存储需求由 UFS 接棒（见 B-C.8.3）。eMMC 5.1 定义的分区管理和寿命监测是本篇后半的重点。

## 分区结构：一块闪存，四个世界

出厂时 eMMC 的闪存空间就被划分成四个独立区域，彼此物理隔离、独立寻址：

```
┌─────────────────────────────────────────────────────────────┐
│                    eMMC Flash 物理分区                        │
├─────────────────────────────────────────────────────────────┤
│  Boot Area Partition 1   4MB / 8MB / 16MB（可配置）           │
│  Boot Area Partition 2   4MB / 8MB / 16MB（可配置）           │
│  RPMB                    与 Boot 分区同尺寸                    │
│  User Data Area          剩余全部容量（GPT/MBR 分区表在此划分）  │
├─────────────────────────────────────────────────────────────┤
│  可选：GPP 通用分区（最多 4 个）、Enhanced User Area（pSLC）    │
└─────────────────────────────────────────────────────────────┘
```

| 分区 | 典型大小 | 用途 | 访问方式 |
|------|---------|------|---------|
| Boot1 | 4MB | 第一阶段 Bootloader（SPL 等） | CMD6 设 `PARTITION_CONFIG` 后读写 |
| Boot2 | 4MB | 备份 Bootloader | 同上 |
| RPMB | 4MB | 密钥、指纹模板、防回滚计数器 | 需认证密钥 + 写计数器，按 512B 帧读写 |
| User Data Area | 剩余全部 | 内核、根文件系统、用户数据 | 普通块设备读写，系统默认看到的区域 |

Boot 分区的价值在于**启动零依赖**：主控芯片上电后若配置为 eMMC 启动，Boot ROM 直接从 Boot 分区读取 Bootloader——这个过程由 eMMC 控制器硬件完成，不需要任何驱动参与。所以嵌入式设备的启动链（Boot ROM → SPL → U-Boot → 内核）可以完整放在一颗 eMMC 里。

双 Boot 分区还支撑了一个重要的升级策略：OTA 升级 Bootloader 时，新固件写入当前未启用的那个 Boot 分区，校验通过后切换 `BOOT_PARTITION_ENABLE`（EXT_CSD[179] 的 bit[5:3]：`0x1` = Boot1、`0x2` = Boot2、`0x7` = User Area），重启生效；新固件起不来就切回去。这是一次原子切换，避免"刷 Boot 变砖"。

### RPMB：防重放攻击的保险柜

RPMB（Replay Protected Memory Block）存在的唯一目的是**防止数据被回滚到旧版本**。

> 重放攻击（Replay Attack）：攻击者把之前截获的合法数据原样再发一遍，欺骗接收方。对存储设备而言，"把旧版本固件/旧计数器写回去"就是重放——设备无法分辨这份旧数据是不是被恶意刷入的。

典型场景：系统升级修补了安全漏洞，攻击者想刷回旧固件利用漏洞。系统在 RPMB 里存一个单调递增的版本计数器，每次启动校验——计数器变小了，说明数据被回滚，拒绝启动。

RPMB 的安全来自三层结构：认证密钥（Key）只能烧录一次，烧完芯片内不可读；每次写操作携带基于密钥的 HMAC-SHA256 签名，覆盖数据 + 地址 + 写计数器；写计数器单调递增，签名绑定计数器值，旧数据即使被完整抄走也无法通过新一次的认证。

```
主控 (SoC)                          eMMC (RPMB)
   │                                    │
   │── 1. 写请求 + HMAC 签名 ──────────>│
   │<─ 2. 返回当前写计数器 ─────────────│
   │── 3. 数据 + 新签名 ──────────────>│   签名覆盖：数据+计数器+地址
   │<─ 4. 写结果（成功/认证失败）───────│
```

> 🔴 RPMB Key 只能写一次，写错或丢失则 RPMB 永久不可用。产线烧录 Key 时务必：Key 值正确且有离线备份；写入过程保证不断电；先在工程板上验证整个 Key 生成-烧录流程，再上量产线。OP-TEE 等方案支持在 Secure World 内派生 RPMB Key，Key 不离开安全世界，是最稳妥的做法。

RPMB 按 512 字节帧组织：256B 数据 + 8B 随机数 + 2B 写计数器 + 2B 地址 + 32B HMAC。Linux 内核本身不直接访问 RPMB，实际产品里由 OP-TEE（开源可信执行环境）管理 Key 和认证流程，内核经 TEE Supplicant 转发请求。

### Enhanced Area 与 GPP

eMMC 5.1 还提供两种可选分区：

- **Enhanced User Data Area**：把 User Area 的一部分配置为 pSLC 模式，换取更高的可靠性和寿命，适合放关键系统数据。
- **GPP（General Purpose Partitions）**：最多 4 个通用分区，可独立配置大小与属性，相当于在 User Area 内做硬件级划分。

> SLC / MLC / TLC：NAND Flash 的三种存储密度。SLC 每个存储单元存 1bit，MLC 存 2bit，TLC 存 3bit。密度越高容量越大越便宜，但电压窗口越窄、擦写寿命越短（SLC 约 10 万次，TLC 只有几千次）。pSLC 模式是让 TLC 单元"只用一半电压窗口当 SLC 用"，牺牲容量换寿命。

> ⚠️ 配置 Enhanced Area 和 GPP 是**破坏性操作**：配置生效时 User Area 全部数据被擦除，且配置本身有次数限制。产线上必须在烧录固件之前完成，量产设备运行中绝不触碰。

## 命令集与初始化流程

eMMC 命令集与 SD 卡同源，核心命令如下：

| 命令 | 名称 | 功能 |
|------|------|------|
| CMD0 | GO_IDLE_STATE | 软件复位，进入 Idle 状态 |
| CMD1 | SEND_OP_COND | 协商电压，查询就绪状态 |
| CMD2 | ALL_SEND_CID | 读 CID（128 位卡唯一标识） |
| CMD3 | SET_RELATIVE_ADDR | 主控分配相对地址 RCA |
| CMD6 | SWITCH | 切速度/总线宽度/分区，或写 EXT_CSD 单字节 |
| CMD7 | SELECT/DESELECT_CARD | 选中/取消选中卡片 |
| CMD8 | SEND_EXT_CSD | 读 512 字节 EXT_CSD |
| CMD13 | SEND_STATUS | 查询当前状态 |
| CMD17/CMD18 | READ_(SINGLE\|MULTIPLE)_BLOCK | 读数据块 |
| CMD24/CMD25 | WRITE_(SINGLE\|MULTIPLE)_BLOCK | 写数据块 |

CMD6 是其中最灵活的命令，一身二任：模式切换（速度、总线宽度）和写 EXT_CSD 的指定字节。CMD6 的响应只表示"命令被接受"，切换是否真的成功要再查 EXT_CSD 里的 SWITCH_ERROR 位。

上电初始化有严格的命令顺序：

```
上电 → Idle 状态
  │  CMD0：软件复位
  ▼
  CMD1：协商电压、轮询 OCR 的 power-up 位，直到 bit31=1
  ▼  Ready 状态
  CMD2：读 CID（128 位卡识别号）
  ▼  Identification 状态
  CMD3：主控分配 RCA（通常 0x0001）
  ▼  Stand-by 状态
  CMD9：读 CSD 寄存器
  CMD7(RCA)：选中卡片
  ▼  Transfer 状态（此后才能读写数据）
  CMD8：读 EXT_CSD（512 字节能力清单）
  CMD6：切总线宽度 8-bit、切速度模式 HS200/HS400
  ▼
  就绪：CMD17/18 读，CMD24/25 写
```

三个要点：

1. **CMD1 必须轮询**：上电后 eMMC 内部的 NAND 控制器需要时间自检，主控反复发 CMD1，直到 OCR 寄存器的 bit31（power up status）变 1 才能继续。
2. **RCA 由主控分配**：这点与 SD 卡不同（SD 卡是自己申请 RCA）。主控通常给 eMMC 分 0x0001。
3. **CMD7 选中后才进 Transfer 状态**：只有 Transfer 状态下数据读写命令才有效。

## EXT_CSD：512 字节的能力与配置中心

EXT_CSD 是一个 512 字节寄存器，通过 CMD8 读、CMD6 写。分三段：

| 偏移范围 | 名称 | 说明 |
|---------|------|------|
| [0-191] | Properties | 只读，描述芯片固定能力 |
| [192-301] | Attributes | 可读写，运行时配置 |
| [302-511] | Vendor/Reserved | 厂商自定义与保留 |

关键字段：

| 偏移 | 名称 | 功能 | 典型值 |
|------|------|------|--------|
| [14] | BOOT_PARTITION_SIZE | 每个 Boot 分区大小 = 128KB × 此值 | 0x20（4MB） |
| [53:56] | SEC_COUNT | User Area 扇区数 | 容量相关 |
| [126] | BOOT_BUS_CONDITIONS | Boot 时总线模式 | 0x01 |
| [179] | PARTITION_CONFIG | 分区访问选择 + 启动分区选择 | 见下文 |
| [183] | RST_n_FUNCTION | RST_n 引脚使能 | 0x01 |
| [187] | BUS_WIDTH | 当前总线宽度 | 0x02（8-bit） |
| [196] | CARD_TYPE | 支持的速度模式位图 | 0x57 |
| [241] | LIFE_TIME_EST_A | Boot 分区寿命估计 | 0x01 |
| [242] | LIFE_TIME_EST_B | User Area 寿命估计 | 0x01 |
| [262] | HS_TIMING | 高速时序配置 | 0x01=HS200, 0x03=HS400 |
| [502] | BKOPS_STATUS | 后台操作状态 + SWITCH 错误标志 | 动态 |

PARTITION_CONFIG（偏移 179）是分区管理的核心：

```
bit[7:6]  ACK                  Boot 期间是否发送 BOOT-ACK
bit[5:3]  BOOT_PARTITION_ENABLE  上电从哪个分区加载启动代码
          001=Boot1  010=Boot2  111=User Area
bit[2:0]  PARTITION_ACCESS     当前读写访问的目标分区
          000=User  001=Boot1  010=Boot2  011=RPMB  100~111=GPP0-3
```

读写 Boot 分区的标准操作序列：CMD6 写 [179] 的 bit[2:0]=001（目标切到 Boot1）→ 正常 CMD17/CMD24 读写 → 写完把 bit[2:0] 改回 000 切回 User Area。

> ⚠️ 操作完 Boot 分区忘了切回 User Area，后续读写会全部落在 Boot 分区上——轻则数据错位，重则覆盖 Bootloader 变砖。Linux 驱动的 `mmc_select_partition()` 会处理切换；裸机代码里自己操作时，切回这一步必须显式写。

### 寿命监测：LIFE_TIME_EST_A/B

EXT_CSD[241] 和 [242] 以 10% 粒度报告 NAND 磨损程度：

| 值 | 含义 | 建议动作 |
|----|------|---------|
| 0x01 | 已用寿命 0~10% | 健康 |
| 0x02~0x0A | 已用 10%~100% | 按梯度关注 |
| 0x0B | 超过额定寿命 | 数据丢失风险，安排更换 |

A 反映 Boot 分区磨损，B 反映 User Area 磨损。IoT 设备运维里可以定期读取这两个值上报云端做预测性维护——超过 0x08 触发预警，让运维在设备坏掉之前介入。这比等设备返修便宜得多。Linux 下不用自己发 CMD8，`mmc extcsd read /dev/mmcblk0`（mmc-utils 工具）即可读出全部字段，具体用法见 B-C.8.5 实战篇。

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| 物理接口 | 说出 eMMC 的 11 根信号线分工，解释 8-bit 总线相对 SD 卡的优势 |
| 速度模式 | 列出 Legacy/HS SDR/HS200/HS400 四档及其峰值，解释 HS400 为什么需要 DS 信号和等长走线 |
| 分区结构 | 画出 Boot1/Boot2/RPMB/User Area 的布局，说明各自的典型用途 |
| 启动机制 | 解释 Boot 分区如何让设备零依赖启动，以及双 Boot 如何实现 OTA 原子切换 |
| RPMB | 说清防重放的三层机制（一次性 Key、HMAC 签名、单调计数器） |
| 初始化流程 | 按顺序写出 CMD0→CMD1→CMD2→CMD3→CMD7→CMD8→CMD6 的初始化链 |
| EXT_CSD | 用 PARTITION_CONFIG 说明 Boot 分区读写的切换步骤，指出忘切回的后果 |
| 寿命监测 | 用 LIFE_TIME_EST_A/B 设计一个预测性维护方案 |

## 配套资源

- JEDEC JESD84-B51：eMMC 5.1 标准原文（需 JEDEC 会员）
- 内核源码：`drivers/mmc/core/`（`mmc.c` 里就是本篇的初始化流程）
- U-Boot 源码：`drivers/mmc/mmc.c`（裸机环境初始化代码）
- mmc-utils 工具：`mmc extcsd read` 的源码里能看到每个字段的解析
- OP-TEE 文档：https://optee.readthedocs.io/（RPMB Key 管理与安全存储）
- Micron eMMC 5.1 Product Manual（公开，含详细时序图）
