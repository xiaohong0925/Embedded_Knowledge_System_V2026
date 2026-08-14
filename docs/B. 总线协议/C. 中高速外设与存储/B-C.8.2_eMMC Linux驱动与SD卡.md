# B-C.8.2 eMMC Linux驱动与SD卡

> 所属章节：第五部 B. 总线协议 > B-C.8 存储总线
>
> 难度：[I] Intermediate | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

eMMC和SD卡是嵌入式系统中最主流的两种可移动/嵌入式存储方案。它们共享相同的电气协议基础（MMC协议），但在物理形态、使用场景和Linux驱动架构上又有明显差异。本节将带你深入Linux MMC子系统的核心数据结构，掌握从设备树配置到高速模式调优的完整流程。你将学会如何在eMMC上同时部署Boot分区（烧录U-Boot）和User Data分区（挂载rootfs），并通过行业实例理解实际产品中的分区管理策略。我们还会对比HS200与HS400两种高速模式，以及eMMC与SD卡的关键差异，帮助你在选型时做出正确决策。

<br>

## <span class="blue"> Linux MMC子系统架构 [I]

Linux内核的MMC子系统采用分层设计，核心由三个数据结构组成：

```
┌─────────────────────────────────────────────────────────────┐
│                    用户空间 (mount/dd)                         │
├─────────────────────────────────────────────────────────────┤
│                   块设备层 (mmcblk)                            │
│              /dev/mmcblk0  /dev/mmcblk0boot0                  │
├─────────────────────────────────────────────────────────────┤
│                  MMC核心层 (mmc_core.ko)                       │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────────────────┐ │
│  │mmc_host  │  │mmc_card  │  │       mmc_bus_ops           │ │
│  │(控制器)  │  │(设备卡)  │  │  (操作函数集: set_ios,     │ │
│  │          │  │          │  │   request, card_event)      │ │
│  └──────────┘  └──────────┘  └─────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                  主机控制器驱动层                              │
│      dw_mmc.ko / sdhci.ko / mtk-mmc.ko / omap_hsmmc.ko      │
├─────────────────────────────────────────────────────────────┤
│                     硬件 (SoC <──> eMMC/SD)                  │
└─────────────────────────────────────────────────────────────┘
```

**`mmc_host`** 代表MMC控制器本身，每个SoC上的MMC控制器实例对应一个`mmc_host`结构体。它描述了控制器的能力：支持的总线宽度（1/4/8-bit）、最高时钟频率、是否支持DDR模式、DMA能力等。当控制器驱动调用`mmc_add_host()`时，MMC核心层会将其注册到系统中。

**`mmc_card`** 代表插入的设备卡（eMMC或SD卡）。当MMC核心检测到总线上有设备存在时，会分配一个`mmc_card`结构体。它记录了设备的完整信息：CID（卡标识号）、CSD（卡特定数据）、EXT_CSD（扩展寄存器，仅eMMC）、容量、当前总线速度模式等。`mmc_card`通过`host`指针关联到其所在的`mmc_host`。

**`mmc_bus_ops`** 是一组操作函数指针的集合，定义了MMC核心与主机控制器之间的标准接口。三个关键成员是：

| 函数指针 | 作用 |
|----------|------|
| `set_ios` | 设置总线参数：时钟频率、总线宽度、时序模式 |
| `request` | 提交一个MMC命令/数据传输请求给控制器 |
| `card_event` | 处理卡插入/移除等异步事件 |

当MMC核心需要发送命令或切换速度模式时，通过这些函数指针调用到底层控制器驱动的具体实现。这种分层架构使得同一个控制器驱动可以与不同的eMMC/SD卡设备协同工作。

<br>

## <span class="blue"> 设备树mmc节点配置 [I]

eMMC在设备树中的配置需要指定pinctrl、总线宽度、不可移除等关键属性。以下是一个完整的eMMC设备树节点：

```dts
&mmc1 {                                        /* SoC上的第2个MMC控制器 */
    pinctrl-names = "default", "state_uhs";    /* 两种引脚状态 */
    pinctrl-0 = <&mmc1_pins_default>;          /* 默认模式引脚配置 */
    pinctrl-1 = <&mmc1_pins_uhs>;              /* 高速模式引脚配置 */

    bus-width = <8>;                           /* 8-bit数据总线 */
    non-removable;                             /* eMMC焊接固定，不可热插拔 */
    no-sd;                                     /* 不支持SD卡模式 */
    no-sdio;                                   /* 不支持SDIO设备 */

    cap-mmc-highspeed;                         /* 支持MMC高速模式(52MHz) */
    cap-mmc-hs200-1_8v;                        /* 支持HS200模式(1.8V) */
    mmc-hs400-1_8v;                            /* 支持HS400模式(1.8V) */
    mmc-ddr-1_8v;                              /* 支持DDR模式(1.8V) */

    vmmc-supply = <&vcc_3v3>;                  /* IO电源: 3.3V */
    vqmmc-supply = <&vcc_1v8>;                 /* 内核电源: 1.8V(高速模式需要) */

    max-frequency = <200000000>;               /* 最高时钟: 200MHz */
    
    /* eMMC特定的Boot分区配置 */
    mmc-bootpart-capable;                      /* 支持Boot分区访问 */

    status = "okay";
};

&pinctrl {
    mmc1_pins_default: mmc1-pins-default {
        groups = "mmc1_d0", "mmc1_d1", "mmc1_d2", "mmc1_d3",
                 "mmc1_d4", "mmc1_d5", "mmc1_d6", "mmc1_d7",
                 "mmc1_cmd", "mmc1_clk";
        function = "mmc1";
        slew-rate = <1>;                       /* 低速模式使用较低压摆率 */
    };

    mmc1_pins_uhs: mmc1-pins-uhs {
        groups = "mmc1_d0", "mmc1_d1", "mmc1_d2", "mmc1_d3",
                 "mmc1_d4", "mmc1_d5", "mmc1_d6", "mmc1_d7",
                 "mmc1_cmd", "mmc1_clk";
        function = "mmc1";
        slew-rate = <3>;                       /* 高速模式需要高压摆率 */
        drive-strength = <12>;                  /* 更强的驱动能力 */
    };
};
```

关键属性解读：

- `bus-width = <8>`：eMMC使用8位数据线（D0-D7），SD卡通常只用4位
- `non-removable`：告诉驱动这是一个固定焊接的设备，不需要轮询卡检测引脚
- `cap-mmc-hs200-1_8v` / `mmc-hs400-1_8v`：声明控制器支持的高速模式能力
- `vmmc-supply` 和 `vqmmc-supply`：HS200/HS400要求信号电平切换到1.8V，因此需要双路供电

<br>

## <span class="blue"> 高速模式：HS200 vs HS400 [I]

eMMC的高速模式经历了从HS到HS200再到HS400的演进。在JEDEC eMMC 5.0/5.1规范中，HS200和HS400是最常用的高速模式：

| 维度 | HS200 | HS400 | 差异说明 |
|------|-------|-------|----------|
| 时钟频率 | 200MHz SDR | 200MHz DDR | 两者时钟相同，但HS400在双边沿采样 |
| 理论带宽 | 200MB/s (8bit × 200MHz) | 400MB/s (8bit × 200MHz × 2) | HS400带宽翻倍 |
| 信号电平 | 1.8V | 1.8V | 都需要从3.3V切换到1.8V |
| 数据选通 | 无 | 有 (DATA STROBE) | HS400使用DQS信号精确对齐数据 |
| 控制器复杂度 | 较低 | 较高 | HS400需要DQS信号处理逻辑 |
| eMMC版本要求 | v4.5+ | v5.0+ | HS400需要更新的eMMC芯片 |
| 实际吞吐量 | ~150-180MB/s | ~280-350MB/s | 受文件系统和CPU影响 |

HS400的关键优势来自DATA STROBE信号。在SDR模式（HS200）下，控制器使用时钟的上升沿来采样数据。但高速时，时钟和数据之间的走线延迟差异会导致采样点偏移。HS400引入的DQS信号由eMMC设备在发送数据时同步发出，控制器利用DQS来精确锁存数据，而不是依赖时钟，从而消除了PCB走线延迟的影响。

> 💡 **提示**：并非所有SoC都同时支持HS200和HS400。在设备树中声明了`mmc-hs400-1_8v`后，MMC核心会优先尝试HS400。如果eMMC芯片不支持（如较老的v4.5器件），会自动降级到HS200。你可以在U-Boot或内核启动日志中看到协商结果：`mmc1: new HS400 MMC card at address 0001`。

<br>

## <span class="blue"> SD卡协议：SPI模式 vs SD模式 [I]

SD卡支持两种通信模式：

**SD模式（原生模式）**：使用完整的命令/响应协议，支持多bit数据线（1-bit或4-bit），是Linux MMC子系统的默认工作模式。CMD线传输命令，DAT0-DAT3传输数据，CLK提供时钟。这种模式速度高、功能完整，但需要专用的MMC控制器硬件。

**SPI模式**：SD卡可以通过发送特定的复位序列（CMD0 + CS拉低）进入SPI模式。在这种模式下，SD卡表现得像一个SPI从设备：使用MOSI/MISO/SCK/CS四线通信。优点是任何带SPI控制器的MCU都能驱动，缺点是：只支持单bit数据传输，速度上限约20-25Mbps，不支持SDHC/SDXC的一些高级特性。

在实际嵌入式Linux系统中，几乎总是使用SD模式，因为SoC都集成了专用的MMC/SD控制器。

**SD卡检测机制**：

SD卡槽通常有一个机械开关连接到CD（Card Detect）引脚。当卡插入时，CD引脚电平变化产生中断，MMC核心调用`card_event`通知驱动。驱动通过`gpio_cd`属性在设备树中指定检测引脚：

```dts
&mmc2 {                         /* SD卡槽通常接在第二个控制器 */
    bus-width = <4>;
    cd-gpios = <&gpio2 12 GPIO_ACTIVE_LOW>;  /* GPIO2_12作为卡检测 */
    cap-sd-highspeed;
    vmmc-supply = <&vcc_sd>;    /* SD卡供电，可控制上下电 */
    status = "okay";
};
```

<br>

## <span class="blue"> eMMC vs SD卡深度对比 [I]

| 维度 | eMMC | SD卡 | 说明 |
|------|------|------|------|
| 物理连接 | BGA焊接固定 | 插槽可插拔 | eMMC不可现场更换 |
| 总线宽度 | 8-bit | 4-bit (SD模式) | eMMC数据线更多，带宽更高 |
| Boot分区 | 有 (Boot1 + Boot2 + RPMB) | 无 | eMMC支持从Boot分区直接启动 |
| 最高速度模式 | HS400 (400MB/s) | UHS-I (104MB/s) | eMMC速度快3-4倍 |
| 容量范围 | 4GB ~ 256GB | 2GB ~ 1TB | SD卡在大容量上更有优势 |
| 可靠性 | 更高（工业级宽温） | 消费级为主 | eMMC有工业级(-40~85°C)选项 |
| 写保护 | 支持永久/临时写保护 | 有物理开关 | eMMC支持Boot分区写保护 |
| 成本(同容量) | 略高 | 较低 | SD卡因可重用而更经济 |
| 典型应用 | 手机、车载、工业板 | 相机、树莓派、数据交换 | 根据是否需要可插拔选择 |

从架构角度看，eMMC本质上就是一个把NAND Flash和MMC控制器封装在一起的标准化模块。它内部的控制器负责坏块管理、 wear-leveling（磨损均衡）、ECC纠错，这些工作对上层SoC是透明的。SD卡内部也有类似的控制器，但由于外置、可插拔，它更强调兼容性和即插即用。

> ⚠️ **陷阱**：SD卡在低质量或长时间使用后容易出现"变成只读"的现象，这通常是内部控制器检测到底层NAND出现大量坏块后触发的保护机制。eMMC也会有类似问题，但工业级eMMC的阈值更保守，预留的备用块更多。

<br>

## <span class="blue"> Linux MMC常用命令 [I]

在U-Boot和Linux用户空间中，有一组标准命令用于管理和调试MMC设备：

| 命令 | 功能 | 示例 | 输出解读 |
|------|------|------|----------|
| `mmc info` | 显示eMMC/SD卡详细信息 | `mmc info` (U-Boot) | 显示容量、总线宽度、当前速度模式 |
| `mmc dev` | 切换/显示当前MMC设备 | `mmc dev 1` | 切换到mmc1控制器 |
| `mmc read` | 从MMC读取数据到内存 | `mmc read 0x82000000 0x0 0x8000` | 从偏移0读取32KB到内存0x82000000 |
| `mmc write` | 从内存写入数据到MMC | `mmc write 0x82000000 0x0 0x8000` | 将内存数据写入eMMC偏移0 |
| `mmc erase` | 擦除MMC指定区域 | `mmc erase 0x0 0x10000` | 擦除64MB区域 |
| `mmc bootpart` | 配置Boot分区 | `mmc bootpart enable 1 0` | 启用Boot1分区，0表示不从Boot ACK |
| `mmc partconf` | 查看/配置分区属性 | `mmc partconf 1` | 显示当前分区配置字节 |
| `mmc rst n` | 发RST_N信号复位eMMC | `mmc rst n 1` | 硬件复位eMMC设备 |

`mmc bootpart enable` 的三个参数含义：

```
mmc bootpart enable <boot_partition> <send_ack> <device>
    boot_partition: 0=关闭Boot, 1=Boot1, 2=Boot2
    send_ack: 0=不发BOOT-ACK, 1=发BOOT-ACK
    device: MMC设备号
```

> ⚠️ **陷阱**：Boot分区写保护是常见的"坑"。eMMC的Boot分区可以通过`BOOT_WP`位启用写保护。如果写保护被激活，所有的`mmc write`操作看似正常执行，但实际数据并未写入。更棘手的是，有些eMMC在出厂时默认启用了临时写保护。在烧录U-Boot之前，务必先用`mmc bootpart enable 0 0 <dev>` 禁用写保护，确认`BOOT_WP`状态位已清除，然后再执行写操作。否则你会看到"写入成功"但实际启动时加载的还是旧版本的U-Boot。

<br>

## <span class="blue"> 行业实例：eMMC Boot分区烧录U-Boot + User Data分区挂载rootfs [I]

这是一个典型的嵌入式产品eMMC分区管理方案：Boot分区存放U-Boot引导程序，User Data分区存放Linux内核和rootfs。

### 实例场景

某工业网关使用8GB eMMC（Samsung KLMAG1JETD），需要：
1. 将U-Boot烧录到Boot1分区（64MB）
2. 在User Data区创建GPT分区表，包含kernel分区和rootfs分区
3. 启动时从Boot1加载U-Boot，U-Boot加载kernel，kernel挂载rootfs

### 完整设备树配置

```dts
/* arch/arm64/boot/dts/rockchip/rk3568-industrial-gateway.dts */

/ {
    aliases {
        mmc1 = &sdmmc1;       /* eMMC控制器别名 */
    };
};

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
    mmc-hs400-enhanced-strobe;    /* HS400增强选通模式 */

    vmmc-supply = <&vcc3v3_sys>;  /* eMMC VCC: 3.3V */
    vqmmc-supply = <&vcc1v8_emmc>; /* eMMC VCCQ: 1.8V (高速模式) */

    max-frequency = <200000000>;

    /* eMMC硬件复位引脚 */
    reset-gpios = <&gpio0 RK_PA0 GPIO_ACTIVE_LOW>;

    status = "okay";
};

&pinctrl {
    emmc {
        emmc_bus8: emmc-bus8 {
            rockchip,pins = <2 RK_PA3 1 &pcfg_pull_up_12ma>,   /* D0 */
                            <2 RK_PA4 1 &pcfg_pull_up_12ma>,   /* D1 */
                            <2 RK_PA5 1 &pcfg_pull_up_12ma>,   /* D2 */
                            <2 RK_PA6 1 &pcfg_pull_up_12ma>,   /* D3 */
                            <2 RK_PA7 1 &pcfg_pull_up_12ma>,   /* D4 */
                            <2 RK_PB0 1 &pcfg_pull_up_12ma>,   /* D5 */
                            <2 RK_PB1 1 &pcfg_pull_up_12ma>,   /* D6 */
                            <2 RK_PB2 1 &pcfg_pull_up_12ma>;   /* D7 */
        };
        emmc_clk: emmc-clk {
            rockchip,pins = <2 RK_PB3 1 &pcfg_pull_none_12ma>; /* CLK */
        };
        emmc_cmd: emmc-cmd {
            rockchip,pins = <2 RK_PB4 1 &pcfg_pull_up_12ma>;  /* CMD */
        };
        emmc_rstn: emmc-rstn {
            rockchip,pins = <0 RK_PA0 0 &pcfg_pull_none>;     /* RSTn */
        };
    };
};
```

### U-Boot烧录U-Boot到Boot1分区

在U-Boot命令行中，按以下步骤操作：

```bash
# === 第1步：确认当前eMMC设备 ===
=> mmc list
FSL_SDHC: 0 (SD)
FSL_SDHC: 1 (eMMC)      ← 我们的eMMC是mmc 1

# === 第2步：切换到eMMC设备 ===
=> mmc dev 1
switch to partitions #0, OK
mmc1(part 0) is current device

# === 第3步：查看eMMC信息 ===
=> mmc info
Device: FSL_SDHC
Manufacturer ID: 15
OEM: 100
Name: 8GPD3 
Timing Interface: HS400
Tran Speed: 200000000
Rd Block Len: 512
MMC version 5.1
High Capacity: Yes
Capacity: 7.3 GiB                ← 总容量8GB
Bus Width: 8-bit                 ← 8位总线
Erase Group Size: 512 KiB
HC WP Group Size: 8 MiB
User Capacity: 7.3 GiB WRREL
Boot Capacity: 4 MiB ENH         ← Boot1/Boot2各4MB
RPMB Capacity: 4 MiB ENH

# === 第4步：将U-Boot加载到DDR内存 ===
# 通过TFTP或从SD卡加载
=> tftp 0x80800000 u-boot-dtb.img
Bytes transferred = 1048576 (100000 hex)

# 或从SD卡加载
=> load mmc 0:1 0x80800000 u-boot-dtb.img

# === 第5步：禁用Boot分区写保护（关键！） ===
=> mmc bootpart enable 0 0 1     ← 先disable，清除写保护

# === 第6步：写入U-Boot到Boot1分区 ===
=> mmc dev 1 1                   ← 切换到Boot1分区 (partition 1)
=> mmc write 0x80800000 0 0x800  ← 写入1MB到Boot1分区起始
MMC write: dev # 1, block # 0, count 2048 ... 2048 blocks written: OK

# === 第7步：配置从Boot1分区启动 ===
=> mmc dev 1 0                   ← 切回User Data分区
=> mmc bootpart enable 1 0 1     ← 启用Boot1, 不发送ACK
=> mmc partconf 1 1 1 0         ← 配置分区字节: 从Boot1启动

# === 第8步：验证写入 ===
=> mmc dev 1 1
=> mmc read 0x82000000 0 0x10
=> cmp.b 0x80800000 0x82000000 0x4000   ← 比较原始数据和读出数据
total of 16384 byte(s) were the same    ← 写入成功！
```

### User Data分区：创建GPT分区表并挂载rootfs

从Linux系统（或U-Boot通过`gpt`命令）创建分区：

```bash
# === 在Linux中分区 ===
# eMMC User Data设备通常是 /dev/mmcblk0
# Boot分区设备分别是 /dev/mmcblk0boot0 和 /dev/mmcblk0boot1

root@industrial-gateway:~# ls /dev/mmcblk0*
/dev/mmcblk0      /dev/mmcblk0boot0   /dev/mmcblk0boot1
/dev/mmcblk0p1    /dev/mmcblk0p2      /dev/mmcblk0rpmb

# 创建GPT分区表
root@industrial-gateway:~# parted /dev/mmcblk0 mklabel gpt
root@industrial-gateway:~# parted -a optimal /dev/mmcblk0 mkpart primary fat32 4MiB 68MiB   # kernel
root@industrial-gateway:~# parted -a optimal /dev/mmcblk0 mkpart primary ext4 68MiB 100%      # rootfs

# 格式化分区
root@industrial-gateway:~# mkfs.vfat -F 32 /dev/mmcblk0p1
root@industrial-gateway:~# mkfs.ext4 /dev/mmcblk0p2

# 挂载rootfs并解压文件系统
root@industrial-gateway:~# mkdir -p /mnt/rootfs
root@industrial-gateway:~# mount /dev/mmcblk0p2 /mnt/rootfs
root@industrial-gateway:~# tar xf rootfs.tar.gz -C /mnt/rootfs/
root@industrial-gateway:~# sync
root@industrial-gateway:~# umount /mnt/rootfs
```

### 性能测试

使用`dd`命令测试eMMC的读写性能：

```bash
# === 写性能测试 ===
root@industrial-gateway:~# dd if=/dev/zero of=/mnt/test bs=1M count=100 conv=fsync
107374182400 bytes (107 GB, 100 GiB) copied, 30.2 s, 3.6 GB/s
# 实际结果示例（HS400模式）：
# 100+0 records in
# 100+0 records out
# 104857600 bytes (105 MB, 100 MiB) copied, 0.35212 s, 298 MB/s

# === 读性能测试 ===
root@industrial-gateway:~# dd if=/mnt/test of=/dev/null bs=1M count=100
# 100+0 records in
# 100+0 records out
# 104857600 bytes (105 MB, 100 MiB) copied, 0.31245 s, 336 MB/s

# === 使用oflag/direct测试原始写入 ===
root@industrial-gateway:~# dd if=/dev/zero of=/dev/mmcblk0 bs=1M count=100 oflag=direct
# 绕过页缓存，测试原始eMMC写入速度
```

### 调试与状态检查

```bash
# === 查看mmc信息 ===
root@industrial-gateway:~# mmc info /dev/mmcblk0
manfid: 0x000015 (Samsung)
hwrev: 0x1
fwrev: 0x3
serial: 0x12345678
capacity: 7.28 GiB (7,818,646,528 bytes)
bus width: 8-bit
timing: HS400 (Enhanced strobe)    ← 确认HS400增强模式

# === 查看内核日志中的MMC初始化过程 ===
root@industrial-gateway:~# dmesg | grep mmc
[    1.234567] mmc1: SDHCI controller on ff2b0000.sdmmc1 [ff2b0000.sdmmc1] using ADMA
[    2.345678] mmc1: new HS400 MMC card at address 0001
[    2.345890] mmcblk1: mmc1:0001 8GPD3 7.28 GiB
[    2.346012] mmcblk1: p1 p2
[    2.346123] mmcblk1boot0: mmc1:0001 8GPD3 partition 1 4.00 MiB
[    2.346234] mmcblk1boot1: mmc1:0001 8GPD3 partition 2 4.00 MiB
[    2.346345] mmcblk1rpmb: mmc1:0001 8GPD3 partition 3 4.00 MiB

# === 查看EXT_CSD中的寿命信息（关键！） ===
root@industrial-gateway:~# mmc extcsd read /dev/mmcblk0 | grep -i life
Device life time estimation type A [EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_A]: 0x01
  # 0x00=未定义, 0x01=0-10%寿命已使用, 0x0A=约100%寿命耗尽
  # 0x01-0x0A线性映射（1%=0x01, 10%=0x02, ..., 90%=0x0A）
Device life time estimation type B [EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_B]: 0x01
```

> 💡 **提示**：eMMC寿命管理是产品运维中的重要话题。EXT_CSD寄存器中的`LIFE_TIME_EST_TYP_A`和`LIFE_TIME_EST_TYP_B`分别反映基于两种不同算法的寿命估计（通常A是擦除计数，B是坏块率）。当这个值接近`0x0A`（约10%对应0x0A表示接近100%寿命耗尽）时，需要立即预警并安排更换。建议在系统中写一个crontab脚本定期读取这个值并上报给运维平台。

```bash
#!/bin/bash
# /usr/local/bin/emmc_health_check.sh
LIFE=$(mmc extcsd read /dev/mmcblk0 | grep "EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_A" | awk '{print $NF}')
LIFE_DEC=$((LIFE))
if [ "$LIFE_DEC" -ge 8 ]; then
    logger -p daemon.crit "CRITICAL: eMMC寿命仅剩约 $(( (10 - LIFE_DEC) * 10 ))%，请尽快更换！"
    echo "eMMC_CRIT life=$LIFE_DEC" | nc monitoring-server 514
elif [ "$LIFE_DEC" -ge 5 ]; then
    logger -p daemon.warn "WARNING: eMMC寿命已使用约 $(( LIFE_DEC * 10 ))%，请密切关注"
fi
```

<br>

## <span class="blue"> 本节总结

| 主题 | 核心要点 |
|------|----------|
| MMC子系统架构 | `mmc_host`管理控制器，`mmc_card`描述设备，`mmc_bus_ops`提供标准操作接口 |
| 设备树配置 | eMMC节点需指定`bus-width=8`、`non-removable`、高速模式capability、双路供电 |
| HS200 vs HS400 | 同为200MHz时钟，HS400使用DDR+DATA STROBE，带宽翻倍到400MB/s |
| SD模式 vs SPI模式 | SD模式用4-bit总线+专用控制器；SPI模式兼容性好但速度慢 |
| eMMC vs SD卡 | eMMC焊接固定、8-bit总线、有Boot分区、速度更快更可靠；SD卡可插拔更灵活 |
| Boot分区管理 | 用`mmc bootpart enable`配置启动分区，**务必先清除写保护再写入** |
| 寿命监控 | 定期读取EXT_CSD `LIFE_TIME_EST`，接近0x0A时预警更换 |
| 性能测试 | `dd`测试读写带宽，内核日志确认实际协商的速度模式 |

<br>

## <span class="blue"> 下一步

接下来我们将进入B-C.8.3节 —— **UFS闪存**。UFS（Universal Flash Storage）是eMMC的下一代替代方案，采用MIPI M-PHY物理层和SCSI协议栈，支持全双工通信和命令队列，顺序读取速度可达2GB/s以上。如果你正在设计高端手机或高性能嵌入式设备，UFS将是你的首选。

<br>

## <span class="blue"> 配套资源

- JEDEC eMMC 5.1 规范 (JESD84-B51)
- Linux内核文档：`Documentation/devicetree/bindings/mmc/mmc.txt`
- U-Boot命令参考：`doc/usage/mmc.rst`
- `mmc` 工具源码：`tools/mmc/mmc.c` (linux-mmc-utils)
- Samsung eMMC数据手册：KLMAG1JETD-B041 系列
- Rockchip RK3568 TRM 中 SDMMC控制器章节
