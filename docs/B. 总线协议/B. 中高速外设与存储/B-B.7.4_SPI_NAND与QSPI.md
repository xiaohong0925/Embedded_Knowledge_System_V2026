# B-B.7.4 SPI NAND与QSPI

> 所属章节：第五部 B. 总线协议 > B-B.7 SPI系列
>
> 难度：[E] Expert | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

你已经在前面的章节掌握了标准SPI的四线结构和基本读写时序。但在真实的嵌入式产品中，SPI接口的Flash存储器远比"SPI EEPROM"复杂得多。本节把目光投向工业界最常用的三种SPI存储方案：**SPI NOR Flash**（存储启动代码）、**SPI NAND Flash**（大容量低成本存储）和**QSPI/OSPI**（四线/八线高速扩展）。<br><br>
你将理解为什么路由器用NOR存U-Boot却用NAND存固件、Linux的MTD子系统如何统一管理这些"裸"Flash设备、以及QSPI如何让SPI速率翻4倍。行业实例会带你配置一个真实的产品级双Flash系统——W25Q128 NOR负责启动，SPI NAND承载整个文件系统。

## <span class="blue"> SPI NOR Flash：启动代码的保险箱 [E]

SPI NOR Flash是嵌入式系统中最常见的启动存储器。它的核心特点是**字节随机读取**——CPU可以直接从任意地址取指令执行（XIP，eXecute In Place），不需要先复制到RAM。<br><br>
NOR的结构类似传统的并行NOR Flash，每个存储单元是浮栅晶体管，通过热电子注入写入、隧道效应擦除。这带来了两个关键特性：

- **读取快**：像读SRAM一样，几纳秒到几十纳秒的访问延迟
- **写入慢、擦除更慢**：按扇区（Sector，通常4KB）擦除，擦除时间几十到几百毫秒；写入（Program）通常256字节为一页，每页0.3~2ms

典型的SPI NOR容量从512KB到256MB不等。常见的型号有华邦W25Q系列、旺宏MX25L系列、兆易创新GD25Q系列。一颗W25Q128JV有16MB容量，采用标准SPI/Dual SPI/Quad SPI三种模式，最高支持133MHz时钟。<br><br>
SPI NOR的寿命指标通常是**10万次擦写、20年数据保持**。它的可靠性高、坏块极少，所以分区后可以直接用JFFS2、SQUASHFS等文件系统，甚至直接XIP运行裸代码。

> 💡 **提示**：选SPI NOR时关注三个参数——容量（是否装得下U-Boot+Kernel+DTB）、最高时钟（决定启动速度）、擦写寿命（OTA升级次数）。

## <span class="blue"> SPI NAND Flash：大容量低成本存储 [E]

SPI NAND Flash的出现是为了填补SPI NOR和并行NAND之间的空白。它用SPI接口替代了并行的8位数据总线+控制线，大幅减少了PCB走线数量；同时保留了NAND的高密度、低成本优势。<br><br>
与NOR的核心区别：

- **结构不同**：NAND以页（Page，通常2KB或4KB）和块（Block，通常128KB或256KB）为单位组织，不能随机字节寻址
- **读取必须整页**：先发送读命令和页地址，等待tR（约25μs），然后才能从缓存寄存器串行读出整页数据
- **存在坏块**：出厂时就可能有2%~4%的坏块，使用中还会新增，**必须做坏块管理**
- **需要ECC**：NAND数据容易出错，每页都需要硬件ECC（Error Correcting Code，通常4bit/8bit ECC）

SPI NAND容量从128MB到8GB都有，单价只有同容量NOR的1/5到1/10。常见型号如旺宏MX35LF、兆易创新GD5F、东芝TC58CVG。它非常适合存储rootfs、用户数据、日志等大容量内容。<br><br>
但注意：**SPI NAND不能直接写文件系统**。因为坏块的存在，你必须在MTD之上再加一层坏块管理和擦写均衡——UBI（Unsorted Block Images）+ UBIFS就是标准方案。

> ⚠️ **陷阱**：SPI NAND有坏块→需要坏块管理→不能直接写→要用UBI/UBIFS文件系统。如果你在SPI NAND上直接格式化为ext4，第一个坏块出现就会让文件系统崩溃！

## <span class="blue"> QSPI与OSPI：速率翻倍的秘密 [E]

标准SPI只有1根数据线（MOSI发、MISO收），全双工但带宽受限。QSPI（Quad SPI）把数据线扩展到4根，OSPI（Octal SPI）扩展到8根——这就是速率翻倍的秘密。

### QSPI（Quad SPI）

QSPI使用4根数据线（通常标记为IO0~IO3或SI/IO0、SO/IO1、WP/IO2、HOLD/IO3）。在Quad Output Read模式下，命令和地址仍用单线发送，但数据阶段4线并行传输；在Quad I/O模式下，连地址和虚拟周期也走4线，进一步提升效率。<br><br>
理论峰值带宽 = 4 × 单线SPI。比如100MHz时钟下，标准SPI是12.5MB/s，QSPI就是50MB/s。绝大多数现代SPI NOR都支持QSPI，SPI NAND也普遍支持Quad模式读取。

### OSPI（Octal SPI）

OSPI是JEDEC xSPI标准的一部分，使用8根数据线。它把理论带宽再翻一倍——8 × 单线SPI。典型时钟200MHz（DDR模式下等效400MHz），带宽可达100MB/s以上，已经接近并行NOR/DDR接口的水平。<br><br>
支持OSPI的芯片如赛普拉斯/英飞凌的Semper Flash、旺宏MX66UM系列。ARM的CMSIS和Linux内核的spi-mem框架都对OSPI提供了良好支持。

> 💡 **提示**：QSPI的4根IO线往往和SPI Flash的WP（写保护）和HOLD引脚复用。用QSPI前必须通过状态寄存器把这两个功能禁用，否则IO2/IO3会被当成WP/HOLD处理！

### 速率对比表

| 模式 | 数据线数 | 速率倍数 | 100MHz时钟带宽 | 典型芯片 |
|------|---------|---------|--------------|---------|
| 标准SPI | 1（发+收各1） | 1× | ~12.5 MB/s | 所有SPI Flash |
| Dual SPI | 2 | 2× | ~25 MB/s | W25Q128（DIO模式） |
| **QSPI** | **4** | **4×** | **~50 MB/s** | **W25Q128（QIO模式）** |
| QSPI+DTR | 4 + 双倍数据率 | 8× | ~100 MB/s | 高端SPI NOR |
| **OSPI** | **8** | **8×** | **~100 MB/s** | **Semper Flash** |
| OSPI+DTR | 8 + 双倍数据率 | 16× | ~200 MB/s | MX66UM1G45G |

<br>

```
┌─────────────────────────────────────────────────────┐
│                    速率演进图                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  单线SPI     ████  12.5MB/s                          │
│  Dual SPI    ████████  25MB/s                       │
│  QSPI        ████████████████  50MB/s               │
│  QSPI+DTR    ████████████████████████  100MB/s      │
│  OSPI        ████████████████████████  100MB/s      │
│  OSPI+DTR    ████████████████████████████████████   │
│                                          200MB/s    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## <span class="blue"> SPI NOR vs SPI NAND 全面对比 [E]

| 维度 | SPI NOR Flash | SPI NAND Flash | 说明 |
|------|---------------|----------------|------|
| **存储结构** | 字节可寻址，随机读取 | 页/块结构，顺序读取 | NOR可以XIP执行，NAND不行 |
| **读取速度** | 快（几十ns延迟） | 较慢（先加载页到缓存~25μs） | 启动代码选NOR |
| **写入速度** | 慢（按字节/页写入） | 较快（按页写入，块擦除） | NAND写入吞吐更高 |
| **擦除单位** | 4KB~64KB扇区 | 128KB~256KB块 | NAND擦除粒度大 |
| **容量范围** | 512KB ~ 256MB | 128MB ~ 8GB+ | NAND容量大得多 |
| **价格/GB** | 高（~$1-2/GB） | 低（~$0.1-0.3/GB） | NAND便宜5~10倍 |
| **坏块** | 极少（几乎无） | 有（2~4%出厂坏块+新增） | NAND必须坏块管理 |
| **ECC** | 不需要 | 必须（4bit/8bit ECC） | NAND控制器需集成ECC |
| **接口** | SPI/Dual/QSPI | SPI/Quad SPI | 都兼容SPI控制器 |
| **典型用途** | U-Boot、Kernel、DTB | Rootfs、用户数据、日志 | 双Flash方案最常见 |
| **Linux文件系统** | JFFS2、SQUASHFS、XIP | UBIFS（via UBI层） | ⚠️ NAND不能用JFFS2！ |
| **寿命** | 10万擦写 | 3000~10万擦写（看类型） | SLC NAND寿命较长 |

<br>

```
┌─────────────────────────────────────────────────────────────┐
│                    典型双Flash产品架构                        │
│                                                             │
│   ┌─────────────┐     ┌──────────────┐     ┌──────────┐    │
│   │   CPU/SoC   │────▶│  SPI NOR     │     │  DDR RAM │    │
│   │             │ qspi│  W25Q128JV   │     │          │    │
│   │   ┌─────┐   │ ───▶│  16MB        │     │  Kernel  │    │
│   │   │ SPI │   │     │  U-Boot+DTB  │     │ 运行时   │    │
│   │   │ 0   │   │     └──────────────┘     └──────────┘    │
│   │   └─────┘   │     ┌──────────────┐                    │
│   │             │spi  │  SPI NAND    │                    │
│   │   ┌─────┐   │ ───▶│  128MB-1GB   │                    │
│   │   │ SPI │   │     │  Rootfs+Data │                    │
│   │   │ 1   │   │     └──────────────┘                    │
│   │   └─────┘   │                                           │
│   └─────────────┘                                           │
│                                                             │
│   启动流程：                                                 │
│   ① SoC上电 → 从SPI NOR读取U-Boot → 运行U-Boot             │
│   ② U-Boot从SPI NAND加载Kernel+DTB到DDR                    │
│   ③ Kernel启动，挂载SPI NAND上的UBIFS根文件系统              │
└─────────────────────────────────────────────────────────────┘
```

## <span class="blue"> Linux MTD子系统：统一管理"裸"Flash [E]

MTD（Memory Technology Device）是Linux内核中专门管理Flash存储器的子系统。它位于块设备层之下、硬件驱动之上，把各种Flash芯片抽象为统一的设备接口。<br><br>
MTD的核心数据结构是`mtd_info`——每个Flash芯片（或分区）对应一个mtd_info实例。关键字段包括：

- `type`：MTD_NORFLASH、MTD_NANDFLASH、MTD_DATAFLASH等
- `size`：总容量
- `erasesize`：最小擦除单位大小
- `writesize`：最小写入单位（页大小）
- `oobsize`：OOB（Out Of Band）区域大小（NAND特有，存ECC和坏块标记）
- `_read()` / `_write()` / `_erase()`：底层操作函数

当MTD设备被分区后，每个分区生成一个`mtd_part`，它包装了父mtd_info并限制了操作范围。你可以在用户空间看到它们：

```bash
# cat /proc/mtd
dev:    size   erasesize  name
mtd0: 00100000 00010000 "u-boot"        # 1MB  U-Boot
td1: 00080000 00010000 "dtb"           # 512KB 设备树
mtd2: 00700000 00010000 "kernel"       # 7MB  内核
mtd3: 07400000 00020000 "rootfs"       # 116MB 根文件系统
mtd4: 00a00000 00020000 "userdata"     # 10MB 用户数据
```

每个`/dev/mtdN`（字符设备）和`/dev/mtdblockN`（块设备）对应一个分区。字符设备用于擦除和烧录（flash_erase、flashcp），块设备用于挂载文件系统。

## <span class="blue"> spi-nor框架：JEDEC ID + SFDP自动识别 [E]

Linux的spi-nor子系统专门管理SPI NOR Flash。它的核心是`spi_nor`结构体和驱动框架。

### JEDEC ID识别

上电后，驱动向Flash发送`0x9F`（Read JEDEC ID）命令，返回3字节ID：
- 第1字节：Manufacturer ID（如0xEF=华邦，0xC2=旺宏，0xC8=兆易创新）
- 第2-3字节：Device ID（容量和型号）

内核维护了一张巨大的`spi_nor_ids[]`表，根据JEDEC ID匹配对应的芯片参数。

### SFDP（Serial Flash Discoverable Parameters）

SFDP是JEDEC JESD216标准定义的一套参数表，存在Flash内部的只读区域。驱动通过`0x5A`命令读取SFDP，自动获取：

- 基本参数：地址模式、页大小、擦除扇区大小和命令
- 读指令支持：Fast Read、Dual/Quad/Octal I/O模式
- 时序参数：最大时钟频率、dummy cycles数量
- 4字节地址模式支持（>128MB的Flash需要）

```
┌─────────────────────────────────────────┐
│           SFDP 参数表结构                │
├─────────────────────────────────────────┤
│  SFDP Header (8 bytes)                  │
│  ├── Signature: 'SFDP' (4 bytes)        │
│  ├── Minor/Major Version                │
│  └── Number of Parameter Headers        │
├─────────────────────────────────────────┤
│  Parameter Header 1 → JEDEC Basic       │
│  (地址/页大小/擦除命令/支持的读模式)      │
├─────────────────────────────────────────┤
│  Parameter Header 2 → Sector Map        │
│  (不均匀扇区大小的映射表)                 │
├─────────────────────────────────────────┤
│  Parameter Header 3 → 4-Byte Address    │
│  (支持>128MB的4字节地址模式)              │
├─────────────────────────────────────────┤
│  Parameter Header N → Vendor Specific   │
│  (厂商自定义扩展参数)                     │
└─────────────────────────────────────────┘
```

SFDP的巨大好处是**一颗驱动支持所有Flash**。只要芯片有SFDP，驱动就不需要硬编码参数。连新出的芯片也能即插即用。

> 💡 **提示**：调试spi-nor时，先看SFDP是否被正确读取。`dmesg | grep spi-nor`里找"sfdp"关键字——如果显示"SFDP probe failed"，驱动会fallback到硬编码参数表，可能导致性能不达标或功能异常。

## <span class="blue"> spi-nand框架：ONFI参数表与坏块管理 [E]

Linux的spi-nand子系统是NAND子系统的一部分，使用`spi_nand`结构体和`nand_chip`来表示一颗SPI NAND芯片。

### ONFI参数表

ONFI（Open NAND Flash Interface）是NAND Flash的行业标准。SPI NAND通常把ONFI参数存在芯片内部，驱动读取后自动配置：

- 页大小（2KB/4KB）
- 块大小（128KB/256KB）
- OOB大小和布局
- 支持的ECC强度
- 坏块标记位置

### 坏块管理

spi-nand框架内置了坏块检测和管理：

1. **坏块检测**：读取每个块的第一个/第二个页的OOB区域，检查坏块标记字节（通常0x00表示坏块）
2. **坏块表（BBT）**：在内存中维护坏块表，避免每次扫描
3. **预留块**：预留一定数量的好块用于替换坏块
4. **ECC**：spi-nand驱动与NAND控制器协作，每页读写时自动计算和校验ECC

但注意：**spi-nand框架只提供底层的坏块检测和ECC，不做擦写均衡**。如果你直接把文件系统放在mtdblock上，文件系统根本不知道坏块的存在。这就是为什么SPI NAND必须用UBI——UBI在MTD之上建立逻辑到物理的映射层，屏蔽了坏块。

## <span class="blue"> 行业实例：W25Q128 NOR + SPI NAND 双Flash系统

这是一个典型的工业路由器/物联网网关存储方案。W25Q128JV（16MB SPI NOR）存启动代码，一颗128MB SPI NAND存整个系统。

### 完整设备树配置

```dts
&spi0 {
    pinctrl-names = "default";
    pinctrl-0 = <&spi0_pins>;
    status = "okay";

    /* CS0: W25Q128JV SPI NOR Flash - 存U-Boot+Kernel+DTB */
    flash_nor: spi-nor@0 {
        compatible = "jedec,spi-nor";
        reg = <0>;                    /* CS0 */
        spi-max-frequency = <104000000>; /* 104MHz */
        spi-tx-bus-width = <4>;       /* QSPI模式发送 */
        spi-rx-bus-width = <4>;       /* QSPI模式接收 */

        /* MTD分区表 */
        partitions {
            compatible = "fixed-partitions";
            #address-cells = <1>;
            #size-cells = <1>;

            u-boot@0 {
                label = "u-boot";
                reg = <0x0 0x100000>;       /* 1MB */
            };

            dtb@100000 {
                label = "dtb";
                reg = <0x100000 0x80000>;   /* 512KB */
            };

            kernel@180000 {
                label = "kernel";
                reg = <0x180000 0x700000>;  /* 7MB */
            };

            nor_userdata@880000 {
                label = "nor_userdata";
                reg = <0x880000 0x780000>;  /* 7.5MB剩余 */
            };
        };
    };
};

&spi1 {
    pinctrl-names = "default";
    pinctrl-0 = <&spi1_pins>;
    status = "okay";

    /* CS0: SPI NAND Flash - 存Rootfs+用户数据 */
    flash_nand: spi-nand@0 {
        compatible = "spi-nand";
        reg = <0>;                    /* CS0 */
        spi-max-frequency = <80000000>; /* 80MHz */
        spi-tx-bus-width = <4>;       /* Quad模式 */
        spi-rx-bus-width = <4>;       /* Quad模式 */

        partitions {
            compatible = "fixed-partitions";
            #address-cells = <1>;
            #size-cells = <1>;

            rootfs@0 {
                label = "rootfs";
                reg = <0x0 0x7400000>;      /* 116MB */
            };

            nand_userdata@7400000 {
                label = "nand_userdata";
                reg = <0x7400000 0xa00000>; /* 10MB */
            };
        };
    };
};
```

### MTD分区规划

| 分区名 | 大小 | 所在Flash | 用途 | 说明 |
|--------|------|----------|------|------|
| u-boot | 1MB | SPI NOR | U-Boot启动代码 | XIP执行，必须NOR |
| dtb | 512KB | SPI NOR | 设备树二进制 | U-Boot加载时读取 |
| kernel | 7MB | SPI NOR | Linux内核镜像 | 可压缩，7MB通常够 |
| rootfs | 116MB | SPI NAND | UBIFS根文件系统 | UBI层管理坏块 |
| userdata | 10MB | SPI NAND | 用户配置/日志 | UBIFS分区 |
| nor_userdata | 7.5MB | SPI NOR | 关键小数据 | 可靠性高的小数据 |

### flashcp烧录命令

```bash
# ========== 烧录 SPI NOR ==========
# 1. 先擦除分区
flash_erase /dev/mtd0 0 16          # 擦除u-boot分区（16个64KB扇区）

# 2. 烧录U-Boot
flashcp u-boot.bin /dev/mtd0         # 自动擦除+写入+校验

# 3. 烧录设备树
flashcp kernel.dtb /dev/mtd1

# 4. 烧录内核
flashcp zImage /dev/mtd2

# ========== 烧录 SPI NAND（UBI镜像）==========
# NAND必须先擦除再写入
flash_erase /dev/mtd3 0 0           # 擦除整个rootfs分区

# 烧录预制的UBIFS镜像
flashcp rootfs.ubi /dev/mtd3

# ========== 挂载 NAND 上的 UBIFS ==========
# 方法1：通过UBIattach后挂载
ubiformat /dev/mtd3                 # 格式化（首次）
ubiattach /dev/ubi_ctrl -m 3        # 附加mtd3到ubi层
ubimkvol /dev/ubi0 -N rootfs -m     # 创建UBI卷
mount -t ubifs ubi0:rootfs /mnt     # 挂载

# 方法2：内核参数直接挂载（bootargs）
# ubi.mtd=3 root=ubi0:rootfs rootfstype=ubifs
```

### 调试命令大全

```bash
# ========== 查看MTD设备信息 ==========
cat /proc/mtd                        # 查看所有MTD分区和大小
cat /proc/partitions                 # 块设备视角
mtdinfo /dev/mtd0                    # 单个MTD详细信息
mtdinfo /dev/mtd3 --ubi              # 查看UBI层信息

# ========== spi-nor 调试 ==========
dmesg | grep spi-nor                 # 看识别日志
# 输出示例：
# spi-nor spi0.0: w25q128 (16384 Kbytes)
# spi-nor spi0.0: BFPT validation failed, please fix the profile!
# spi-nor spi0.0: sfdp: SFDP probe failed, use hardcoded parameters

dmesg | grep mtd                     # 看MTD注册日志

# 读ID确认芯片型号（用户空间直接用spi工具）
flashrom -p linux_spi:dev=/dev/spidev0.0 --flash-name

# ========== spi-nand 调试 ==========
dmesg | grep spi-nand                # 看NAND识别和ECC信息
dmesg | grep "Bad eraseblock"        # 看坏块报告

# 查看ECC统计（如果驱动支持）
cat /sys/class/mtd/mtd3/ecc_stats   # 校正/错误计数

# 扫描坏块
flash_erase /dev/mtd3 -N 1           # 干跑模式，只扫描不擦除

# ========== UBI/UBIFS 调试 ==========
ubinfo /dev/ubi0                     # UBI设备信息
ubihealth -d /dev/ubi0               # UBI坏块和健康状态
ubidetach /dev/ubi_ctrl -m 3         # 分离UBI设备

# ========== 性能测试 ==========
# NOR读取速度测试
dd if=/dev/mtdblock2 of=/dev/null bs=1M count=7

# NAND读写测试
dd if=/dev/zero of=/mnt/test.bin bs=1M count=10 conv=fsync
dd if=/mnt/test.bin of=/dev/null bs=1M count=10

# ========== 示波器触发要点 ==========
# - 用CS（片选）下降沿触发
# - 看IO0~IO3是否同时翻转（确认QSPI模式生效）
# - 时钟频率是否达到配置值（量SCK周期）
# - 数据窗口是否对齐时钟沿（检查DTR模式相位）
```

> 💡 **提示**：SPI NOR用JFFS2/SQUASHFS → SPI NAND用UBIFS → 选对文件系统很重要。NOR上可以用SQUASHFS做只读根文件系统，配合overlayfs做可写层，这是路由器的经典组合。NAND上必须用UBIFS，它的原子写、压缩、坏块管理都是为NAND量身定做的。

## <span class="blue"> 本节总结

```
┌─────────────────────────────────────────────────────────────────┐
│                      本节核心要点总结                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. SPI NOR = 启动代码存储（XIP、随机读、无坏块）                  │
│     → 文件系统：JFFS2 / SQUASHFS                                 │
│                                                                  │
│  2. SPI NAND = 大容量存储（便宜、大容量、有坏块）                  │
│     → 必须通过UBI+UBIFS（坏块管理+ECC）                           │
│                                                                  │
│  3. QSPI = 4线数据 → 4×带宽（最常用）                            │
│     OSPI = 8线数据 → 8×带宽（高端场景）                           │
│     关键在于IO线复用需要先禁用WP/HOLD功能                          │
│                                                                  │
│  4. Linux MTD统一抽象：mtd_info → 字符/块设备 → 分区             │
│     spi-nor：JEDEC ID + SFDP自动识别                             │
│     spi-nand：ONFI参数 + 内置坏块检测 + ECC                       │
│                                                                  │
│  5. 双Flash方案（工业标准）：                                     │
│     SPI NOR (16MB): U-Boot + DTB + Kernel                        │
│     SPI NAND (128MB+): UBIFS Rootfs + User Data                  │
│                                                                  │
│  6. 调试三板斧：cat /proc/mtd + dmesg|grep spi-nor + flashcp     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

| 概念 | 一句话记住 |
|------|-----------|
| SPI NOR | 贵但可靠，启动代码存这里 |
| SPI NAND | 便宜容量大，存数据但要用UBIFS |
| QSPI | 4根数据线，速率翻4倍 |
| OSPI | 8根数据线，速率翻8倍 |
| MTD | Linux对"裸"Flash的统一抽象层 |
| SFDP | Flash的"自我介绍"参数表 |
| UBI/UBIFS | NAND上必须有的坏块管理层 |

## <span class="blue"> 下一步

SPI协议族到这里就告一段落了。你掌握了从基础四线SPI到QSPI/OSPI高速扩展，从EEPROM到NOR/NAND Flash的完整知识体系。下一节我们将进入一个全新的领域——**B-B.8.1 MIPI D-PHY物理层**，这是现代嵌入式显示和摄像头接口的物理基础。MIPI D-PHY的低压差分信号（LP/HS模式切换）与SPI完全不同，它为DSI（显示）和CSI（摄像头）提供了高带宽的物理层传输能力。

## <span class="blue"> 配套资源

- JEDEC JESD216 SFDP标准文档：https://www.jedec.org/
- Linux MTD文档：`Documentation/mtd/`（内核源码树）
- UBI/UBIFS官方指南：http://www.linux-mtd.infradead.org/
- W25Q128JV数据手册：华邦官网 https://www.winbond.com/
- flashcp/flash_erase工具：mtd-utils包（`apt install mtd-utils`）

---

> 📌 **自测问题**：
> 1. 为什么SPI NAND不能直接格式化为ext4？必须在上面加什么层？
> 2. SFDP解决了什么问题？如果没有SFDP，驱动会怎样？
> 3. QSPI的4根IO线原本是什么功能？用QSPI前必须做什么？
> 4. 一个典型双Flash产品的启动流程是怎样的？（从SPI NOR到SPI NAND）
