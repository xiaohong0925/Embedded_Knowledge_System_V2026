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

## <span class="blue"> 常见陷阱

> ⚠️ `reg` 当成从机地址理解。SPI 的 `reg` 是片选号；总线上两个节点写同一个 `reg` 会争用同一根 CS，数据互串。

> ⚠️ `spi-cpol = <1>` 写法。布尔属性写了值，dtc 检查与维护阅读都别扭；规范写法是裸属性名。

> ⚠️ 栈变量做 DMA 传输缓冲。栈内存物理不连续且生命周期短，DMA 读写出垃圾。用 `kmalloc`/`devm_kzalloc`。

> ⚠️ 设备树直接写 `compatible = "spidev"` 期望通用。内核 4.x 后 spidev 要求明确允许（`spidev_of_match` 白名单），不在列表直接 probe 失败。量产产品不应依赖 spidev 节点。

> ⚠️ 在 `spi_async` 回调里睡眠。complete 回调运行在中断上下文，调用 `msleep`/`mutex_lock` 直接死锁。需要睡眠的操作丢给 workqueue。

---

## <span class="blue"> 动手练习

1. **拓扑观察**：开发板执行 `ls /sys/bus/spi/devices/`，确认各设备的总线号.片选号命名；`cat /sys/bus/spi/devices/spi1.0/modalias` 看匹配的 compatible。
2. **设备树比对**：在板级 dts 找一个 SPI 子节点，核对 `reg`/`spi-max-frequency`/模式属性三项；到 `/proc/device-tree/` 确认实例化。
3. **回环验证**：MOSI 短接 MISO，`spidev_test -D /dev/spidev1.0` 应原样收回数据，验证控制器与 pinctrl。
4. **无硬件后备**：阅读内核 `drivers/mtd/spi-nor/core.c` 的 probe 路径，看 `jedec,spi-nor` 如何从设备树节点变成 MTD 设备；或阅读 `drivers/spi/spidev.c` 中 `SPI_IOC_MESSAGE` 的处理函数 `spidev_ioctl()`。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 分层 | Core / controller / driver 三层与内核路径 |
| 结构体 | controller=控制器、device=从设备、message=事务、transfer=段 |
| 设备树 | `reg`=片选号、布尔模式属性、max-frequency 必填 |
| 传输模型 | 多段 transfer 同 CS 周期；三段式帧的代码映射 |
| API 选型 | 默认 spi_sync；write_then_read 覆盖寄存器型交互 |
| 现成路径 | spi-nor→MTD 等框架优先原则 |
| spidev | ioctl 三件套与适用边界、白名单约束 |

---

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/spi/spi-summary.rst`
- **内核源码**：`drivers/spi/spi.c`、`drivers/spi/spi-rockchip.c`、`drivers/spi/spidev.c`
- **绑定文档**：`Documentation/devicetree/bindings/spi/rockchip,spi.yaml`

---

## <span class="blue"> 下一步

框架之后是排障：**B-B.4.4 SPI 调试与选型**——spidev_test 与波形抓包的组合用法、多从设备共享总线的 CS 与信号完整性、从传感器到 Flash 到显示屏的选型决策。随后 **B-B.4.5 实战篇**用 W25Qxx 走通"设备树 → spi-nor → MTD → 烧录校验"全链路。

> 💡 螺旋衔接：本篇分层架构与 B-B.3.3 I2C 框架同构，对照读可固化"总线子系统"通用模型；compatible 匹配机制回看第 11 章设备模型；自研驱动的完整工程写法在 D 扩展驱动专题。
