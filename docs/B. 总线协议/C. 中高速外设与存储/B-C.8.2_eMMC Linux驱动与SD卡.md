# B-C.8.2 eMMC Linux 驱动与 SD 卡

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[I] | 预计阅读时间：35 分钟

## 本节导读

上一节讲了 eMMC 的协议与寄存器——芯片这一侧。本节进入内核：Linux 的 MMC 子系统如何用同一套框架同时驱动焊死的 eMMC 和可插拔的 SD 卡，设备树怎么把一颗 eMMC 描述给内核，高速模式怎么协商，以及 U-Boot 阶段怎么把引导程序烧进 Boot 分区。

这一节是"用起来"的一篇：读完你应该能独立完成从产品设备树配置到 Boot 分区烧录、rootfs 部署、性能验证的完整流程。

本节覆盖：MMC 子系统的三层架构与三个核心数据结构、eMMC/SD 的设备树配置要点、HS200 与 HS400 的差异与协商行为、SD 模式与 SPI 模式、eMMC 与 SD 卡的选型对比、U-Boot 下 mmc 命令实战、Boot1 烧录 + User Area 部署 rootfs 的完整案例。

## Linux MMC 子系统架构

MMC 子系统分三层，核心由三个数据结构撑起：

```
┌─────────────────────────────────────────────────────────────┐
│                    用户空间（mount / dd）                       │
├─────────────────────────────────────────────────────────────┤
│              块设备层：/dev/mmcblk0、/dev/mmcblk0boot0 ...      │
├─────────────────────────────────────────────────────────────┤
│                  MMC 核心层（mmc_core）                        │
│   mmc_host（控制器）  mmc_card（卡）  mmc_bus_ops（操作集）      │
├─────────────────────────────────────────────────────────────┤
│        控制器驱动：dw_mmc / sdhci / mtk-mmc / omap_hsmmc       │
├─────────────────────────────────────────────────────────────┤
│                  硬件：SoC MMC 控制器 ←→ eMMC/SD               │
└─────────────────────────────────────────────────────────────┘
```

**`mmc_host`** 代表 MMC 控制器本身，每个控制器实例对应一个结构体，描述其能力：支持的总线宽度（1/4/8-bit）、最高时钟、是否支持 DDR、DMA 能力等。控制器驱动调 `mmc_add_host()` 注册进核心层。

**`mmc_card`** 代表总线上检测到的卡（eMMC 或 SD 卡），记录 CID、CSD、EXT_CSD（仅 eMMC）、容量、当前速度模式等全部设备信息，通过 `host` 指针关联到所在控制器。

**`mmc_bus_ops`** 是核心层与控制器驱动之间的标准操作集：

| 函数指针 | 作用 |
|---------|------|
| `set_ios` | 设置总线参数：时钟、总线宽度、时序模式 |
| `request` | 向控制器提交一次命令/数据传输 |
| `card_event` | 处理卡插入/移除等异步事件 |

这套分层让"检测卡 → 跑 B-C.8.1 的初始化流程 → 协商速度 → 注册块设备"的全过程对上层透明——上层只看到 `/dev/mmcblkN`，不关心下面接的是 eMMC 还是 SD 卡、跑在什么模式。

## 设备树：eMMC 节点怎么写

```dts
&mmc1 {                                     /* SoC 的第 2 个 MMC 控制器 */
    pinctrl-names = "default", "state_uhs";
    pinctrl-0 = <&mmc1_pins_default>;       /* 默认（低速）引脚状态 */
    pinctrl-1 = <&mmc1_pins_uhs>;           /* 高速模式引脚状态 */

    bus-width = <8>;                        /* 8-bit 数据总线 */
    non-removable;                          /* 焊死的，不做插拔检测 */
    no-sd;                                  /* 此槽不接 SD 卡 */
    no-sdio;                                /* 不接 SDIO 设备 */

    cap-mmc-highspeed;                      /* 52MHz HS */
    cap-mmc-hs200-1_8v;                     /* HS200，1.8V 信号 */
    mmc-hs400-1_8v;                         /* HS400，1.8V 信号 */

    vmmc-supply = <&vcc_3v3>;               /* VDD：卡核心/NAND 供电 */
    vqmmc-supply = <&vcc_1v8>;              /* VDDQ：IO 信号电平供电 */

    max-frequency = <200000000>;
    status = "okay";
};
```

关键属性逐条说：

- **`bus-width = <8>`**：eMMC 用满 8 根数据线；SD 卡槽位写 `<4>`。
- **`non-removable`**：告诉驱动这是固定焊接设备，不轮询卡检测引脚，掉电即系统故障而不是"卡被拔了"。
- **`cap-mmc-hs200-1_8v` / `mmc-hs400-1_8v`**：声明控制器的高速能力。核心层会拿它们与卡的 CARD_TYPE 位图取交集，协商出双方都会的最高模式。
- **双路供电**：`vmmc` 对应 eMMC 的 VDD（核心与 NAND，3.3V），`vqmmc` 对应 VDDQ（IO 信号电平）。HS200/HS400 要求信号电平切到 1.8V，所以 vqmmc 必须挂 1.8V 电源——这两路搞反或漏配，现象就是低速模式正常、切高速失败。

pinctrl 里高速状态组通常配更高的 slew-rate（压摆率）和驱动强度：200MHz 下信号边沿必须足够陡，否则采样窗口内电平还没翻转到位。

## HS200 与 HS400：差在 DATA STROBE

| 维度 | HS200 | HS400 |
|------|-------|-------|
| 时钟 | 200MHz，SDR 单沿采样 | 200MHz，DDR 双沿采样 |
| 理论带宽（8-bit） | 200 MB/s | 400 MB/s |
| 信号电平 | 1.8V | 1.8V |
| 数据选通 | 无 | DS（Data Strobe）信号 |
| eMMC 版本要求 | v4.5+ | v5.0+ |
| 实际吞吐量 | 150~180 MB/s | 280~350 MB/s |

HS400 的 DS 信号解决的是高速下的采样对齐问题。SDR 模式里控制器拿自己的时钟沿去采数据，但 200MHz 时一个时钟周期只有 5ns，PCB 走线的延迟差已经能把采样点推出数据有效窗口。HS400 让 eMMC 发数据时同步发出 DS 信号，控制器用 DS 的沿来锁存数据——DS 和数据走了同样的路径、经受同样的延迟，于是对齐关系天然成立，走线延迟被抵消。

协商行为是自动降级的：设备树声明了 `mmc-hs400-1_8v`，核心层先试 HS400；卡不支持或初始化失败就降到 HS200，再不行继续降。内核日志里的协商结果一眼可见：

```
mmc1: new HS400 MMC card at address 0001
```

> 💡 板子实测速度远低于预期时，先看这行日志确认协商到了什么模式。协商到了 HS400 但速度还是低，查 vqmmc 供电是否真给了 1.8V、示波器看信号质量；只协商到 HS200 或更低，查设备树 capability 声明和卡本身的 CARD_TYPE。

## SD 卡：SD 模式与 SPI 模式

SD 卡支持两种通信模式。**SD 模式**是原生模式：CMD 传命令、DAT0~DAT3 传数据、CLK 同步，支持完整命令集，Linux 下默认走这条。**SPI 模式**通过特定的复位序列（CMD0 时拉低 CS）进入，卡表现得像个 SPI 从设备，任何带 SPI 控制器的 MCU 都能驱动——代价是只有单 bit 数据、速度上限约 20~25 Mbit/s、不支持 SDHC/SDXC 的高级特性。嵌入式 Linux 里几乎总是 SD 模式，SPI 模式的主场是没有 SD 控制器的单片机。

SD 卡与 eMMC 在驱动层面的最大区别是**可插拔**。卡槽的机械开关接在 CD（Card Detect）引脚上，插拔产生中断，核心层经 `card_event` 完成卡的探测与注销：

```dts
&mmc2 {                                     /* SD 卡槽 */
    bus-width = <4>;
    cd-gpios = <&gpio2 12 GPIO_ACTIVE_LOW>; /* 卡检测引脚 */
    cap-sd-highspeed;
    vmmc-supply = <&vcc_sd>;                /* 可控制上下电的供电 */
    status = "okay";
};
```

## eMMC 与 SD 卡：选型对比

| 维度 | eMMC | SD 卡 |
|------|------|-------|
| 物理连接 | BGA 焊接固定 | 插槽可插拔 |
| 总线宽度 | 8-bit | 4-bit（SD 模式） |
| Boot 分区 | 有（Boot1/Boot2/RPMB） | 无 |
| 最高速度 | HS400 400 MB/s | UHS-I 104 MB/s |
| 可靠性 | 有工业级宽温（-40~85°C）选项 | 消费级为主 |
| 成本（同容量） | 略高 | 较低 |
| 典型场景 | 手机、车载、工业板的系统盘 | 数据交换、可移介质、树莓派系统盘 |

两者内部都是"NAND + 专用控制器"的结构，坏块管理、磨损均衡、ECC 纠错都由卡内控制器完成，对 SoC 透明。选型逻辑很直接：系统启动盘、要求可靠性和速度 → eMMC；需要用户自己换卡导数据 → SD 卡。

> ⚠️ 消费级 SD 卡长期读写后常出现"突然变只读"——这是卡内控制器检测到大量坏块后触发的最后保护手段，数据还能读出、写入全部拒绝。工业产品若不得不用 SD 卡存系统，选型时认准工业级（宽温 + pSLC + 寿命监测），并设计成"系统只读、数据分区可写、配合只读保护预案"的架构。

## U-Boot 下的 mmc 命令

烧录与调试 eMMC 的主战场在 U-Boot 命令行：

| 命令 | 功能 | 示例 |
|------|------|------|
| `mmc list` | 列出所有 MMC 设备 | — |
| `mmc dev <n> [part]` | 切换当前设备/分区 | `mmc dev 1 1` 切到设备 1 的 Boot1 |
| `mmc info` | 显示当前设备详情 | 容量、总线宽度、速度模式 |
| `mmc read <addr> <blk> <cnt>` | 读到内存 | `mmc read 0x82000000 0 0x10` |
| `mmc write <addr> <blk> <cnt>` | 从内存写入 | `mmc write 0x80800000 0 0x800` |
| `mmc erase <blk> <cnt>` | 擦除 | — |
| `mmc bootpart enable <p> <ack> <dev>` | 配置启动分区 | `mmc bootpart enable 1 0 1` |
| `mmc partconf <dev> <ack> <part> <access>` | 写 PARTITION_CONFIG | `mmc partconf 1 1 1 0` |

`mmc bootpart enable` 的三个参数：分区号（0=关闭、1=Boot1、2=Boot2）、是否发 BOOT-ACK、设备号。它最终改写的就是 B-C.8.1 讲的 EXT_CSD[179] PARTITION_CONFIG。

> ⚠️ Boot 分区写保护是最隐蔽的坑：部分 eMMC 出厂默认带临时写保护，此时 `mmc write` 返回成功但数据根本没进去——烧完启动后加载的还是旧固件。烧录前先 `mmc bootpart enable 0 0 <dev>` 清保护，写完用"读回比较"验证，不要相信"写入成功"的返回。

## 实战：Boot1 烧 U-Boot + User Area 部署 rootfs

场景：工业网关，8GB eMMC（三星 KLMAG1JETD），要求 Boot1 放 U-Boot，User Area 用 GPT 划分 kernel + rootfs 两个分区。

### 设备树（RK3568 示例）

```dts
&sdmmc1 {
    compatible = "rockchip,rk3568-dw-mshc";
    reg = <0x0 0xfe2b0000 0x0 0x4000>;
    interrupts = <GIC_SPI 98 IRQ_TYPE_LEVEL_HIGH>;
    clocks = <&cru HCLK_SDMMC1>, <&cru CLK_SDMMC1>,
             <&cru SCLK_SDMMC1_DRV>, <&cru SCLK_SDMMC1_SAMPLE>;
    clock-names = "biu", "ciu", "ciu_drv", "ciu_sample";
    fifo-depth = <0x100>;

    pinctrl-names = "default";
    pinctrl-0 = <&emmc_bus8 &emmc_clk &emmc_cmd &emmc_rstn>;

    bus-width = <8>;
    non-removable;
    no-sd;
    no-sdio;

    cap-mmc-highspeed;
    cap-mmc-hs200-1_8v;
    mmc-hs400-1_8v;
    mmc-hs400-enhanced-strobe;              /* HS400 增强选通 */

    vmmc-supply = <&vcc3v3_sys>;            /* VDD：3.3V */
    vqmmc-supply = <&vcc1v8_emmc>;          /* VDDQ：1.8V */

    max-frequency = <200000000>;
    reset-gpios = <&gpio0 RK_PA0 GPIO_ACTIVE_LOW>;  /* eMMC RST_n */
    status = "okay";
};
```

### U-Boot 烧录流程

```bash
# 1. 找到 eMMC
=> mmc list
FSL_SDHC: 0 (SD)
FSL_SDHC: 1 (eMMC)

# 2. 切到 eMMC 并查看信息
=> mmc dev 1
=> mmc info
```

```
Name: 8GPD3
Timing Interface: HS400
Capacity: 7.3 GiB
Bus Width: 8-bit
Boot Capacity: 4 MiB ENH
RPMB Capacity: 4 MiB ENH
```

```bash
# 3. 把 U-Boot 镜像加载到内存（TFTP 或从 SD 卡读）
=> tftp 0x80800000 u-boot-dtb.img

# 4. 清 Boot 分区写保护（关键步骤）
=> mmc bootpart enable 0 0 1

# 5. 写入 Boot1（先切分区再写）
=> mmc dev 1 1
=> mmc write 0x80800000 0 0x800

# 6. 切回 User Area，配置从 Boot1 启动
=> mmc dev 1 0
=> mmc bootpart enable 1 0 1
=> mmc partconf 1 1 1 0

# 7. 验证：读回与原数据逐字节比较
=> mmc dev 1 1
=> mmc read 0x82000000 0 0x10
=> cmp.b 0x80800000 0x82000000 0x4000
total of 16384 byte(s) were the same
```

### User Area：GPT 分区与 rootfs 部署

进 Linux 后，eMMC 的设备节点全景：`/dev/mmcblk0`（User Area 整体）、`/dev/mmcblk0boot0`、`/dev/mmcblk0boot1`、`/dev/mmcblk0rpmb`——四个硬件分区各自暴露为独立块设备，User Area 内再用 GPT 细分出 `mmcblk0p1/p2`：

```bash
# 创建 GPT 分区表：kernel(FAT32) + rootfs(ext4)
parted /dev/mmcblk0 mklabel gpt
parted -a optimal /dev/mmcblk0 mkpart primary fat32 4MiB 68MiB
parted -a optimal /dev/mmcblk0 mkpart primary ext4 68MiB 100%

mkfs.vfat -F 32 /dev/mmcblk0p1
mkfs.ext4 /dev/mmcblk0p2

# 部署 rootfs
mkdir -p /mnt/rootfs
mount /dev/mmcblk0p2 /mnt/rootfs
tar xf rootfs.tar.gz -C /mnt/rootfs/
sync
umount /mnt/rootfs
```

### 性能验证与状态检查

```bash
# 写性能（conv=fsync 保证数据真正落盘后才计时）
dd if=/dev/zero of=/root/test.bin bs=1M count=100 conv=fsync

# 读性能（先清页缓存，否则读到的是内存缓存）
echo 3 > /proc/sys/vm/drop_caches
dd if=/root/test.bin of=/dev/null bs=1M count=100

# 绕过页缓存的原始设备写（更贴近真实器件速度，小心选对设备）
dd if=/dev/zero of=/dev/mmcblk0 bs=1M count=100 oflag=direct
```

HS400 协商成功的 8GB eMMC，典型结果在写 250~300 MB/s、读 300+ MB/s 量级。如果只有几十 MB/s，按前面"协商模式 → vqmmc 供电 → 信号质量"的顺序查。

```bash
# 内核日志确认初始化与协商
dmesg | grep mmc
```

```
mmc1: new HS400 MMC card at address 0001
mmcblk1: mmc1:0001 8GPD3 7.28 GiB
mmcblk1: p1 p2
mmcblk1boot0: mmc1:0001 8GPD3 partition 1 4.00 MiB
mmcblk1boot1: mmc1:0001 8GPD3 partition 2 4.00 MiB
mmcblk1rpmb: mmc1:0001 8GPD3 partition 3 4.00 MiB
```

### 寿命监测落地

B-C.8.1 讲的 LIFE_TIME_EST_A/B 在用户态用 mmc-utils 直接读：

```bash
mmc extcsd read /dev/mmcblk0 | grep -i life
```

```
Device life time estimation type A [...]: 0x01
Device life time estimation type B [...]: 0x01
```

0x01 = 已用寿命 0~10%，每加 1 多耗 10%，0x0A 表示 90~100%，0x0B 表示超额定寿命。一个简单的周期检查脚本：

```bash
#!/bin/sh
# /usr/local/bin/emmc_health_check.sh —— 建议 cron 每日执行
LIFE=$(mmc extcsd read /dev/mmcblk0 | grep "LIFE_TIME_EST_TYP_A" | awk '{print $NF}')
LIFE_DEC=$((LIFE))
if [ "$LIFE_DEC" -ge 8 ]; then
    logger -p daemon.crit "CRITICAL: eMMC 寿命已用约 $((LIFE_DEC * 10))%，尽快安排更换"
elif [ "$LIFE_DEC" -ge 5 ]; then
    logger -p daemon.warn "WARNING: eMMC 寿命已用约 $((LIFE_DEC * 10))%，密切关注"
fi
```

量产产品里把这个值上报到运维平台，配合设备序列号做批次寿命画像，往往还能发现某一批次芯片或某一种写模式的异常磨损。

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| 子系统架构 | 画出 MMC 子系统三层结构，说清 mmc_host/mmc_card/mmc_bus_ops 的分工 |
| 设备树 | 写出 eMMC 节点的完整属性集，解释 vmmc/vqmmc 两路供电的区别 |
| 高速协商 | 从 dmesg 确认协商模式，速度不达预期时按模式→供电→信号的顺序排查 |
| SD 卡差异 | 说出 SD/SPI 两种模式的取舍，写带卡检测的 SD 槽节点 |
| 选型 | 给定产品需求（可插拔？启动盘？温度范围？）在 eMMC 与 SD 间做选择 |
| 烧录 | 在 U-Boot 下完成 Boot1 写入、启动分区配置、读回验证三步 |
| 部署 | 用 parted + mkfs + tar 在 User Area 建好 kernel/rootfs 分区 |
| 运维 | 用 mmc-utils 读寿命估计并写进周期巡检脚本 |

## 配套资源

- JEDEC eMMC 5.1 规范（JESD84-B51）
- 内核设备树绑定文档：`Documentation/devicetree/bindings/mmc/`
- U-Boot mmc 命令参考：`doc/usage/mmc.rst`
- mmc-utils 源码：每个 EXT_CSD 字段的解析都在里面
- Rockchip RK3568 TRM 的 SDMMC 控制器章节
