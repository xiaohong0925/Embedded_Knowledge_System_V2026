# B-B.4.3 SPI Linux 驱动框架

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线
>
> 难度：[I] Intermediate | 预计阅读时间：35 分钟

## <span class="blue"> 本节导读

物理层和协议层讲清了线上的事，本节进入软件：Linux SPI 子系统如何组织代码。与 I2C 子系统同构——核心层、控制器驱动、设备驱动三层——但 SPI 的传输模型更灵活：一次 `spi_message` 可以串联多个 `spi_transfer`，天然匹配"命令+地址+数据"的三段式帧。理解这套模型，再看任何 SPI 驱动代码都只是填空。

本节覆盖：SPI 子系统分层与五个核心结构体、设备树节点写法、`spi_message`/`spi_transfer` 传输模型、核心 API 选型（`spi_sync`/`spi_write_then_read`）、spidev 用户态接口与适用边界、现成驱动路径（spi-nor/MTD）。

---

## <span class="blue"> 分层架构

```
┌──────────────────────────────────────────────────────┐
│  用户空间：/dev/spidev1.0（spidev）  /dev/mtd0（MTD） │
├──────────────────────────────────────────────────────┤
│  设备驱动层：spi-nor.c / fb_st7789.c / 自研驱动        │
│      struct spi_driver { probe, remove, of_match }   │
├──────────────────────────────────────────────────────┤
│  SPI Core：drivers/spi/spi.c                         │
│      spi_sync() / spi_async() / 注册与匹配            │
├──────────────────────────────────────────────────────┤
│  控制器驱动：drivers/spi/spi-rockchip.c               │
│      spi_controller → transfer_one_message()          │
├──────────────────────────────────────────────────────┤
│  硬件：RK3568 SPI 控制器（spi@fe620000 等）            │
└──────────────────────────────────────────────────────┘
```

### 五个核心结构体

| 结构体 | 角色 | 关键字段 |
|--------|------|----------|
| `spi_controller` | 一个 SPI 控制器（旧名 `spi_master`） | `bus_num`、`num_chipselect`、`transfer_one()` |
| `spi_device` | 挂在总线上的一个从设备 | `chip_select`、`max_speed_hz`、`mode`（CPOL/CPHA/LSB） |
| `spi_driver` | 设备驱动 | `probe`/`remove`、`of_match_table` |
| `spi_transfer` | 一段传输（单向或全双工） | `tx_buf`/`rx_buf`、`len`、`speed_hz`、`cs_change` |
| `spi_message` | 一次完整事务 = transfer 链表 | `transfers`、`complete` 回调 |

`spi_message` 串多个 `spi_transfer` 的价值：B-B.4.2 的三段式帧（命令+地址+数据）可以拆成多段 transfer 放在**同一次 CS 有效期间**完成——这正是 `cs_change` 字段控制的语义。

---

## <span class="blue"> 设备树节点写法

RK3568 的 `rk356x.dtsi` 已定义控制器（`spi1: spi@fe620000`，默认 disabled），板级 dts 使能并挂设备：

```dts
&spi1 {
    status = "okay";
    pinctrl-names = "default";
    pinctrl-0 = <&spi1m0_cs0 &spi1m0_pins>;

    flash@0 {
        compatible = "jedec,spi-nor";
        reg = <0>;                          /* 片选号，不是地址 */
        spi-max-frequency = <50000000>;     /* 按从设备上限与走线定 */
    };
};
```

与 I2C 设备树的差异点：

| 属性 | 含义 | 注意 |
|------|------|------|
| `reg` | **片选号**（0/1/2…），不是从机地址 | SPI 靠 CS 选人，无地址概念 |
| `spi-max-frequency` | 该设备 SCLK 上限 | 必填，按手册与走线取小 |
| `spi-cpol` / `spi-cpha` | 时钟极性/相位 | **布尔属性，存在即置 1**，不要写 `= <1>` |
| `spi-lsb-first` | 位序 | 默认 MSB-first |

> ⚠️ `spi-cpol = <1>` 编译不报错但语义不规范——布尔属性靠"存在/不存在"表达。需要 Mode 3 就写 `spi-cpol; spi-cpha;` 两行，需要 Mode 0 就什么都不写。

---

## <span class="blue"> 传输模型与 API 选型

### spi_message 组装

```c
struct spi_transfer t[2] = { 0 };
struct spi_message m;

t[0].tx_buf = cmd;      /* 段1：命令+地址（MOSI） */
t[0].len    = 4;
t[1].rx_buf = buf;      /* 段2：读数据（MISO） */
t[1].len    = len;

spi_message_init(&m);
spi_message_add_tail(&t[0], &m);
spi_message_add_tail(&t[1], &m);
ret = spi_sync(spi, &m);        /* 两段在同一 CS 周期内完成 */
```

### 核心 API

| 函数 | 用途 |
|------|------|
| `spi_sync(spi, msg)` | 同步传输，阻塞到完成；绝大多数场景用它 |
| `spi_async(spi, msg)` | 异步，提交即返回，`msg->complete` 回调（中断上下文，不能睡眠） |
| `spi_write_then_read(spi, tx, n_tx, rx, n_rx)` | "写命令再读数据"便捷封装，内部自动组双段 message |
| `spi_write()` / `spi_read()` | 单方向便捷封装 |

选型原则：**默认 `spi_sync`**；只有长数据流（显示屏帧、音频）且不能阻塞时才考虑 `spi_async` + 回调。`spi_write_then_read` 覆盖 80% 的寄存器型器件交互。

### 驱动注册匹配

与 I2C 完全同构：设备树子节点实例化为 `spi_device`，`spi_driver` 用 `of_match_table` 的 compatible 匹配，`module_spi_driver()` 注册，probe 里 `spi_setup()` 确认模式后注册上层接口。probe/remove 的完整工程写法属驱动专题（D 扩展），本篇不展开。

### cs_change：CS 行为的精确语义

CS 在什么时候拉高，由 message 边界和 `cs_change` 字段共同决定，规则比直觉更细：

- **同一 `spi_message` 内的多个 transfer，默认 CS 全程保持拉低**——三段式帧拆成多段 transfer 依然是一次完整事务，这正是拆段的合法性来源
- **message 结束（`spi_sync` 返回前）CS 拉高**，从设备状态机复位
- **`cs_change = 1` 表示"这段 transfer 结束后拉高 CS"**（语义是"改变 CS 当前状态"），用于需要段间拉高的特殊器件；下一段 transfer 开始前会再次拉低

绝大多数驱动不碰 `cs_change`，默认行为就是对的。需要动它的典型场景：某些触摸屏控制器（如 ADS7846）要求命令段与数据段之间 CS 翻转一次；多笔独立事务连续下发时，靠拆成多个 message 让 CS 自然拉高，而不是在一个 message 里手动翻转。

> ⚠️ 把多笔独立事务塞进一个 message：CS 全程低电平，从设备把它们当成一笔超长事务，状态机错位。反之，把一笔事务拆成两个 message：CS 中途拉高，从设备状态机中途复位（B-B.4.2 的 CS 毛刺问题在软件层的同构）。划分的标准只有一个——**手册时序图里 CS 在哪里拉高，message 边界就在哪里**。

---

## <span class="blue"> 现成驱动路径：多数 SPI 器件不用自己写驱动

与 AT24C02 一课相同的判断（B-B.3.5）：**先查内核有没有现成驱动，再决定写不写**。

| 器件类型 | 内核现成路径 | 用户态入口 |
|----------|--------------|-----------|
| SPI NOR Flash | `spi-nor` 子系统 → MTD | `/dev/mtdN`、`flashcp`/`flash_erase` |
| SPI 显示屏 | fbtft / DRM 驱动 | `/dev/fbN` |
| SPI ADC/DAC | IIO 子系统 | `/sys/bus/iio/` |
| SPI 网络芯片 | 网络驱动 | socket |

W25Q128 的设备树写 `compatible = "jedec,spi-nor"`，内核 probe 后 dmesg 直接报 `spi-nor spi1.0: w25q128 (16384 Kbytes)`，MTD 分区、擦写接口全部就绪——B-B.4.5 实战篇会完整走这条链路。自己写驱动只在两种情况下合理：器件无现成驱动，或现有框架确实装不下需求。

---

## <span class="blue"> spidev 用户态接口

spidev 把每个片选导出为 `/dev/spidevB.C`（B=总线号，C=片选号），用户态 `ioctl` 直接收发：

| ioctl | 功能 |
|-------|------|
| `SPI_IOC_WR_MODE` / `RD_MODE` | 设置/读取模式（SPI_MODE_0~3、SPI_LSB_FIRST 等位掩码） |
| `SPI_IOC_WR_MAX_SPEED_HZ` | 设置 SCLK 频率 |
| `SPI_IOC_MESSAGE(n)` | 执行 n 段 `spi_ioc_transfer`，核心命令 |

设备树中挂 `compatible = "spidev"` 的子节点即可启用（该 compatible 需加入内核允许列表，部分内核默认拒绝，见陷阱）。适用边界与 I2C 的 `/dev/i2c` 一致：

| 适合 | 不适合 |
|------|--------|
| 新器件评估、原型验证 | 中断驱动的设备 |
| 低频配置类访问 | 高吞吐数据流（每次 ioctl 都有用户态/内核态拷贝） |
| 产线测试、寄存器调试 | 需要 DMA 与内核缓冲的场景 |

---

## <span class="blue"> DMA 传输要点

- 缓冲区分水岭：**短传输（数十字节级）用 PIO 反而快**，DMA 有设置开销；长传输（帧数据、Flash 烧录）才体现 DMA 价值
- DMA 缓冲区必须物理连续：`kmalloc` 内存或 `dma_alloc_coherent`，不能用栈上变量/vmalloc 内存直接做 DMA
- 合并小传输：多段小 transfer 组进一个 `spi_message`，减少中断与 CS 切换次数

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| 现成框架（spi-nor/IIO） | 零开发、生态完整；代价是设备树绑定要规范、灵活性受框架约束 |
| 自研内核驱动 | 完全可控、可 DMA 批量缓冲；代价是开发与维护成本 |
| spidev 用户态 | 零驱动开发、验证快；代价是性能与并发能力弱 |
| spi_async + DMA | 高吞吐不阻塞；代价是回调上下文约束、内存生命周期管理复杂 |

---

## <span class="blue"> 排障速查

| 症状 | 根因 | 定位动作 |
|------|------|----------|
| 两个设备节点数据互串 | `reg` 当从机地址理解，两节点写了同一 `reg` 争用同一根 CS | `reg` 是片选号；核对各节点 reg 与实际 CS 接线 |
| 模式配置"写了但没生效"观感 | `spi-cpol = <1>` 带值写法，语义不规范 | 布尔属性裸写属性名：`spi-cpol; spi-cpha;` |
| DMA 传输读出垃圾数据 | 栈变量/vmalloc 内存做 DMA 缓冲，物理不连续 | 缓冲区用 `kmalloc`/`devm_kzalloc`/`dma_alloc_coherent` |
| spidev 节点 probe 失败 | `compatible = "spidev"` 不在内核白名单（4.x 后收紧） | 确认 `spidev_of_match`；量产产品写正式驱动 |
| `spi_async` 使用后系统死锁 | complete 回调（中断上下文）里调了 `msleep`/`mutex_lock` | 回调里只标记完成，睡眠操作丢 workqueue |
| 从设备把多笔事务当一笔、状态机错位 | 多笔独立事务塞进一个 message，CS 全程低 | 按手册时序图的 CS 拉高点划 message 边界 |

---

## <span class="blue"> 本节总结

SPI 子系统与 I2C 子系统是同一张图纸的两次施工：Core/controller/driver 三层，设备树节点实例化为 device，compatible 匹配触发 probe。真正属于 SPI 自己的知识只有两个：传输模型和 CS 语义。`spi_message` 串 `spi_transfer` 的模型让三段式帧有了天然的代码映射——命令、地址、数据各占一段，同一次 CS 有效期内完成；而"message 边界 = CS 拉高点"这条规则，是把手册时序图翻译成代码结构时唯一不能错的对应关系。

路径判断沿用 I2C 一课的结论并再推进一步：SPI 器件的现成框架比 I2C 更厚——Flash 有 spi-nor→MTD、显示屏有 fbtft/DRM、ADC/DAC 有 IIO，自研驱动的合理理由只剩"无现成驱动"和"框架装不下"两条。spidev 是评估期的跳板，白名单机制已经明确表达了内核社区的态度：它是调试工具，不是产品方案。

**速查表**

| 项 | 要点 |
|----|------|
| 分层 | Core（`spi.c`）/ controller（`spi-rockchip.c`）/ driver（设备驱动） |
| 结构体 | controller=控制器、device=从设备、message=事务、transfer=段 |
| 设备树 | `reg`=片选号、`spi-max-frequency` 必填、模式布尔属性裸写 |
| 传输模型 | 多段 transfer 同 CS 周期；message 边界 = CS 拉高点 |
| cs_change | 默认 message 内 CS 全程低；=1 表示该段后拉高；默认不动 |
| API | 默认 `spi_sync`；`spi_write_then_read` 覆盖寄存器型交互 |
| 现成路径 | spi-nor→MTD、fbtft/DRM、IIO；先查框架再写驱动 |
| spidev | `SPI_IOC_MESSAGE(n)` 核心 ioctl；白名单约束；非产品方案 |
| DMA | 短传输 PIO 更快；缓冲区必须物理连续 |

**本节自查**

1. `spi_message` 串多段 transfer 的价值是什么？它与三段式帧如何对应？
2. message 边界和 CS 行为是什么关系？把多笔独立事务塞进一个 message 会怎样？
3. 设备树里 `reg = <0>` 和 I2C 的 `reg = <0x50>` 语义有什么本质不同？
4. Mode 3 的设备树怎么写？为什么不能写 `spi-cpol = <1>`？
5. 什么场景该用 `spi_async`？它的回调里不能做什么？
6. W25Q128 接入产品，从零到可烧录要走哪条现成路径？哪一步都不用自己写代码？

---

## <span class="blue"> 下一步

框架之后是排障：**B-B.4.4 SPI 调试与选型**——spidev_test 与波形抓包的组合用法、多从设备共享总线的 CS 与信号完整性、从传感器到 Flash 到显示屏的选型决策。随后 **B-B.4.5 实战篇**用 W25Qxx 走通"设备树 → spi-nor → MTD → 烧录校验"全链路。

> 💡 螺旋衔接：本篇分层架构与 B-B.3.3 I2C 框架同构，对照读可固化"总线子系统"通用模型；compatible 匹配机制回看第 11 章设备模型；自研驱动的完整工程写法在 D 扩展驱动专题。
