# B-C.8.4 SPI NAND 与 QSPI

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[E] | 预计阅读时间：35 分钟

## 本节导读

B 板块讲过标准 SPI 的四线结构与读写时序，但真实产品里挂在 SPI 上的存储器远比"SPI EEPROM"复杂。工业界最常用的是三种方案：**SPI NOR**（存启动代码）、**SPI NAND**（大容量低成本存储）、以及把速率翻倍的 **QSPI/OSPI**（四线/八线扩展）。路由器、IoT 网关、工控板的存储几乎都是这三样的组合。

本篇要建立的判断力是：一颗板子上"启动代码放哪、文件系统放哪"不是随便定的——它由 NOR 能随机读、NAND 有坏块这两个物理事实直接决定。理解了这两点，双 Flash 方案、UBI/UBIFS 的强制搭配、QSPI 的引脚复用问题，全都是顺理成章的推论。

本节覆盖：SPI NOR 与 SPI NAND 的物理特性与差异、QSPI/OSPI 的扩线提速原理、Linux MTD 子系统的抽象模型、spi-nor 的 JEDEC ID + SFDP 自动识别、spi-nand 的坏块管理与 ECC、一个"NOR 启动 + NAND 存系统"的完整双 Flash 产品实例。

## SPI NOR：启动代码的保险箱

SPI NOR 的核心特性是**字节级随机读取**——CPU 可以像读内存一样从任意地址直接取指，这就是 XIP 的基础。

> XIP（eXecute In Place）：就地执行——代码不复制到 RAM，CPU 直接从 Flash 上取指运行。只有支持字节随机寻址的 NOR 能做到；NAND 按页读取，无法 XIP。

NOR 的存储单元是浮栅晶体管，热电子注入写入、隧道效应擦除。由此带来一组不对称的性能画像：

- **读快**：访问延迟几十纳秒级，接近 SRAM
- **写慢**：按页（256B）编程，每页 0.3~2ms
- **擦更慢**：按扇区（通常 4KB）擦除，几十到几百毫秒

容量 512KB~256MB，常见型号华邦 W25Q、旺宏 MX25L、兆易创新 GD25Q。寿命指标典型为 10 万次擦写、20 年数据保持，几乎无坏块，可以直接承载 JFFS2/SquashFS 甚至裸 XIP 代码。

选型关注三个参数：容量（装不装得下 U-Boot + Kernel + DTB）、最高时钟（决定启动速度）、擦写寿命（撑不撑得住产品生命周期内的 OTA 次数）。

## SPI NAND：便宜大碗，但有坏块

SPI NAND 填补了 SPI NOR 与并行 NAND 之间的空白：用 SPI 接口替代并行 NAND 的 8 位数据总线加一大把控制线，省下 PCB 走线；同时保留 NAND 的高密度低成本。

它与 NOR 的差异是结构性的：

| 特性 | SPI NOR | SPI NAND |
|------|---------|---------|
| 存储结构 | 字节可寻址 | 页（2/4KB）+ 块（128/256KB）组织 |
| 读取 | 随机、纳秒级 | 整页读入缓存（tR 约 25μs）再串行移出 |
| 坏块 | 几乎没有 | 出厂即有 2%~4%，使用中还会新增 |
| ECC | 不需要 | 必须（每页 4bit/8bit 纠错） |
| 容量 | ≤256MB | 128MB~8GB |
| 单价 | 基准 | 同容量 NOR 的 1/5~1/10 |

> ECC（Error Correcting Code）：纠错码。NAND 的存储单元会因漏电、干扰、磨损产生比特翻转，每页数据写入时计算 ECC 校验码存入页的 OOB 区域，读出时重新计算比对——错几个比特内自动纠正，超过纠错能力才报错。NAND 离了 ECC 不可用。

> 坏块（Bad Block）：NAND 制造缺陷和使用磨损导致的不可修复块。出厂就存在（厂商在块的 OOB 区打标记），使用中磨损产生新坏块。任何 NAND 存储方案都必须有坏块管理机制：识别、跳过、用好块替补。

这两个事实推出一条铁律：**SPI NAND 不能直接跑 ext4/JFFS2**。通用文件系统不知道坏块的存在，第一个坏块出现在元数据区，文件系统就崩了。正确结构是 MTD → UBI（坏块管理 + 磨损均衡）→ UBIFS，后文展开。

## QSPI 与 OSPI：数据线加倍，带宽加倍

标准 SPI 数据走单线（MOSI/MISO 各一根）。QSPI 把数据线扩到 4 根（IO0~IO3），OSPI（JEDEC xSPI 标准）扩到 8 根，带宽随线数线性翻倍：

| 模式 | 数据线 | 带宽倍数 | 100MHz 时钟下 |
|------|--------|---------|--------------|
| 标准 SPI | 1+1 | 1× | ~12.5 MB/s |
| Dual SPI | 2 | 2× | ~25 MB/s |
| QSPI | 4 | 4× | ~50 MB/s |
| QSPI + DTR | 4（双沿） | 8× | ~100 MB/s |
| OSPI | 8 | 8× | ~100 MB/s |
| OSPI + DTR | 8（双沿） | 16× | ~200 MB/s |

QSPI 的 4 根 IO 线与 Flash 的 WP（写保护）和 HOLD（暂停）引脚复用：IO2 平时是 WP、IO3 平时是 HOLD。进 Quad 模式前必须通过状态寄存器把这两个功能关掉，否则 IO2/IO3 被芯片当成 WP/HOLD 处理，Quad 传输直接失败。这是 QSPI 调试的第一经典坑。

OSPI + DTR（双沿）200MHz 下等效 400MHz 采样、8 线并行，带宽过 200MB/s，已接近并行接口水平——高端场景（XIP 跑大固件、FPGA 配置）的选择。Linux 的 spi-mem 框架对 QSPI/OSPI 有完整支持。

## MTD：裸 Flash 的统一抽象

MTD（Memory Technology Device）是 Linux 管理裸 Flash 的子系统，位于块设备层之下、驱动之上。它存在的意义：eMMC/UFS 内部有控制器做坏块管理和磨损均衡，暴露的是标准块设备；而 NOR/NAND 是"裸"的，这些管理要内核来做——MTD 就是干这个的层。

每个 Flash 芯片（或分区）对应一个 `mtd_info` 实例，关键字段：`type`（NOR/NAND）、`size`、`erasesize`（最小擦除单位）、`writesize`（页大小）、`oobsize`（NAND 的 OOB 区大小）、`_read/_write/_erase` 操作函数。分区后每个分区再包一层 `mtd_part`。用户态看到的样子：

```bash
cat /proc/mtd
```

```
dev:    size   erasesize  name
mtd0: 00100000 00010000 "u-boot"
mtd1: 00080000 00010000 "dtb"
mtd2: 00700000 00010000 "kernel"
mtd3: 07400000 00020000 "rootfs"
mtd4: 00a00000 00020000 "userdata"
```

每个分区有两个设备节点：`/dev/mtdN`（字符设备，用于擦除与烧录）和 `/dev/mtdblockN`（块设备，用于挂载文件系统）。

## spi-nor：JEDEC ID + SFDP 自动识别

spi-nor 框架识别一颗 NOR 分两步。第一步发 `0x9F`（Read JEDEC ID）拿 3 字节 ID：第 1 字节厂商（0xEF 华邦、0xC2 旺宏、0xC8 兆易创新），后两字节是型号与容量。内核用 ID 在 `spi_nor_ids[]` 表里查参数。

第二步读 SFDP（Serial Flash Discoverable Parameters，JEDEC JESD216 标准）：Flash 内部只读区存着一张标准参数表，驱动发 `0x5A` 命令读出来，自动获得页大小、擦除扇区类型、支持的读模式（Fast/Dual/Quad/Octal）、最大时钟、dummy cycle 数、4 字节地址模式支持等全部工作参数。

> dummy cycle（哑周期）：高速读模式下，发完地址后 Flash 内部需要若干时钟周期准备数据，这段时间总线上传的是无效占位时钟。dummy cycle 数必须和芯片要求一致——配少了读到错位数据，配多了浪费带宽。SFDP 自动给出正确值，是它最大的实用价值之一。

SFDP 的意义是**一颗驱动支持所有合规芯片**：新出的 Flash 只要有 SFDP，内核不用加一行代码就能即插即用。

> 💡 调试 spi-nor 识别问题，先看 `dmesg | grep spi-nor`：正常会看到型号和容量（`spi-nor spi0.0: w25q128 (16384 Kbytes)`）；出现 `SFDP probe failed` 说明读表失败，驱动回退到硬编码参数表，能用但可能跑不到最高速或功能不全——此时对照数据手册检查 SPI 模式（CPOL/CPHA）和时钟。

## spi-nand：ONFI 参数与坏块管理

spi-nand 框架把 SPI NAND 纳入内核 NAND 子系统。芯片参数来自 ONFI（Open NAND Flash Interface）标准参数页：页/块大小、OOB 布局、ECC 强度、坏块标记位置，驱动读出后自动配置。

框架内置的坏块管理包括：扫描每个块首两页 OOB 区的坏块标记建内存坏块表（BBT）、预留好块替补、读写时自动计算校验 ECC。但要注意边界：**框架只做坏块检测和 ECC，不做磨损均衡与逻辑映射**。直接往 mtdblock 上放文件系统，坏块照样会击穿文件系统——所以 SPI NAND 的标准栈必须是：

```
UBIFS 文件系统（原子写、压缩、掉电安全）
    │
UBI 层（逻辑块 ↔ 物理块映射、磨损均衡、坏块透明替换）
    │
MTD（/dev/mtdN 字符设备）
    │
spi-nand 驱动（坏块检测、ECC、ONFI 参数）
```

> UBI（Unsorted Block Images）：MTD 之上的卷管理层。它把物理擦除块映射成逻辑块，文件系统看到的永远是无坏块的连续空间；同时在后台做磨损均衡——把写操作均匀摊到所有块上，避免某些块被集中写死。NAND 上的"文件系统可靠性"几乎全部是 UBI 这一层提供的。

## 实战：W25Q128 NOR + 128MB SPI NAND 双 Flash 系统

典型工业路由器/IoT 网关方案：SPI NOR（16MB）存启动链，SPI NAND（128MB）存系统与数据。

启动流程：SoC 上电从 SPI NOR 读出 U-Boot 执行 → U-Boot 从 SPI NAND 加载内核与 DTB 到 DDR → 内核挂载 SPI NAND 上的 UBIFS 根文件系统。

### 设备树

```dts
&spi0 {
    pinctrl-names = "default";
    pinctrl-0 = <&spi0_pins>;
    status = "okay";

    /* CS0：W25Q128JV SPI NOR，存 U-Boot + DTB + Kernel */
    flash_nor: spi-nor@0 {
        compatible = "jedec,spi-nor";
        reg = <0>;
        spi-max-frequency = <104000000>;
        spi-tx-bus-width = <4>;        /* QSPI 发送 */
        spi-rx-bus-width = <4>;        /* QSPI 接收 */

        partitions {
            compatible = "fixed-partitions";
            #address-cells = <1>;
            #size-cells = <1>;

            u-boot@0 {
                label = "u-boot";
                reg = <0x0 0x100000>;        /* 1MB */
            };
            dtb@100000 {
                label = "dtb";
                reg = <0x100000 0x80000>;    /* 512KB */
            };
            kernel@180000 {
                label = "kernel";
                reg = <0x180000 0x700000>;   /* 7MB */
            };
            nor_userdata@880000 {
                label = "nor_userdata";
                reg = <0x880000 0x780000>;   /* 7.5MB */
            };
        };
    };
};

&spi1 {
    pinctrl-names = "default";
    pinctrl-0 = <&spi1_pins>;
    status = "okay";

    /* CS0：SPI NAND，存 rootfs + 用户数据 */
    flash_nand: spi-nand@0 {
        compatible = "spi-nand";
        reg = <0>;
        spi-max-frequency = <80000000>;
        spi-tx-bus-width = <4>;
        spi-rx-bus-width = <4>;

        partitions {
            compatible = "fixed-partitions";
            #address-cells = <1>;
            #size-cells = <1>;

            rootfs@0 {
                label = "rootfs";
                reg = <0x0 0x7400000>;       /* 116MB */
            };
            nand_userdata@7400000 {
                label = "nand_userdata";
                reg = <0x7400000 0xa00000>;  /* 10MB */
            };
        };
    };
};
```

分区规划的分工逻辑：启动链（u-boot/dtb/kernel）全部在 NOR——可靠、无坏块、U-Boot 里驱动简单；大容量可写数据全部在 NAND + UBIFS——便宜、有坏块管理。NOR 上再留一个小分区放关键配置，利用 NOR 的高可靠性兜底。

### 烧录与挂载

```bash
# ===== SPI NOR 烧录 =====
flash_erase /dev/mtd0 0 16           # 擦除 u-boot 分区
flashcp u-boot.bin /dev/mtd0         # flashcp = 擦除+写入+校验 一步完成
flashcp kernel.dtb /dev/mtd1
flashcp zImage /dev/mtd2

# ===== SPI NAND：UBI 镜像烧录 =====
ubiformat /dev/mtd3                  # 首次格式化（建 UBI 层）
flashcp rootfs.ubi /dev/mtd3         # 或直接烧预制 UBI 镜像

# ===== 挂载 NAND 上的 UBIFS =====
ubiattach /dev/ubi_ctrl -m 3         # mtd3 附加到 UBI 层
ubimkvol /dev/ubi0 -N rootfs -m      # 建 UBI 卷
mount -t ubifs ubi0:rootfs /mnt

# 或用内核参数开机直接挂：ubi.mtd=3 root=ubi0:rootfs rootfstype=ubifs
```

### 调试命令

```bash
# MTD 全景
cat /proc/mtd
mtdinfo /dev/mtd0

# 芯片识别日志
dmesg | grep spi-nor        # NOR 型号与 SFDP 状态
dmesg | grep spi-nand       # NAND 参数与 ECC 信息
dmesg | grep "Bad eraseblock"   # 坏块报告

# NAND 健康
cat /sys/class/mtd/mtd3/ecc_stats    # ECC 校正/失败计数
ubinfo /dev/ubi0                     # UBI 层状态
ubihealth -d /dev/ubi0               # 坏块与磨损概况

# 性能抽测
dd if=/dev/mtdblock2 of=/dev/null bs=1M count=7            # NOR 读
dd if=/dev/zero of=/mnt/test.bin bs=1M count=10 conv=fsync # NAND 写
```

> 💡 文件系统搭配速记：NOR → SquashFS（只读根）+ overlayfs（可写层）或 JFFS2；NAND → UBI + UBIFS。路由器经典的"SquashFS + overlayfs"组合只在 NOR 上成立；NAND 上必须 UBIFS，它的原子写、压缩、坏块透明化都是为 NAND 物理特性设计的。

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| NOR/NAND 特性 | 从"能否随机读、有无坏块、是否要 ECC"三问推出两者的用途分工 |
| 文件系统搭配 | 解释 NAND 为什么必须 UBI+UBIFS，直接 ext4 会在哪里崩 |
| QSPI/OSPI | 说出扩线与 DTR 的提速机制，指出 WP/HOLD 复用引脚这个坑 |
| MTD 模型 | 画出 文件系统→UBI→MTD→spi-nand 的栈，读懂 /proc/mtd 输出 |
| 自动识别 | 说清 JEDEC ID 与 SFDP 各自提供什么、SFDP 失败的后果 |
| 双 Flash 设计 | 为一个 IoT 网关设计 NOR+NAND 分区方案并给出设备树 |
| 烧录调试 | 用 flashcp/ubiformat/ubiattach 完成烧录与挂载，用 mtdinfo/ecc_stats 查健康 |

## 配套资源

- JEDEC JESD216（SFDP 标准）
- 内核 MTD 文档：`Documentation/mtd/`
- UBI/UBIFS 官方指南：http://www.linux-mtd.infradead.org/
- W25Q128JV 数据手册（华邦官网）
- mtd-utils 工具包（flashcp/flash_erase/ubi* 全家桶）
