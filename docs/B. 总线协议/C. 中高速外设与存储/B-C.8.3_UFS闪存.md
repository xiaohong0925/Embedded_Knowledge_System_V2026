# B-C.8.3 UFS 闪存

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[E] | 预计阅读时间：30 分钟

## 本节导读

UFS（Universal Flash Storage）是 eMMC 的继任者，当前中高端手机、旗舰平板、高性能边缘计算设备的板载存储基本都是它。它不是 eMMC 的提速版，而是一套全新架构：物理层换成 MIPI M-PHY 差分串行，协议栈直接搬来了服务器领域用了几十年的 SCSI。

本篇要回答三个问题：UFS 凭什么比 eMMC 快 5 倍以上（全双工 + 命令队列）；它的分区模型（LU）和 eMMC 的物理分区有何不同；在 Linux 里它长什么样（SCSI 子系统、`/dev/sdX`），怎么配置和验证。

本节覆盖：UFS 四层协议栈、M-PHY 速率档位与双 lane 物理连接、SCSI 命令与 UTP 封装、LU 分区模型与 RPMB、UFS vs eMMC 全维度对比、ufshcd 驱动框架与设备树配置、初始化验证与性能测试。

## UFS 架构：一套为性能设计的协议栈

eMMC 用一套简单的 MMC 命令集跑在并行总线上；UFS 则是完整的四层协议栈，每层都为性能而存在：

```
┌─────────────────────────────────────┐
│        SCSI 应用层                    │  SCSI 命令集（READ_10/WRITE_10 等）
├─────────────────────────────────────┤
│    UFS 传输层（UTP）                  │  UPIU 数据包封装、任务队列
├─────────────────────────────────────┤
│    UFS 互连层（UIC）                  │  UniPro 协议（链路管理）
├─────────────────────────────────────┤
│    MIPI M-PHY（物理层）               │  差分串行，每向 1~2 lane
└─────────────────────────────────────┘
```

> SCSI（Small Computer System Interface）：服务器存储领域几十年的标准命令集与架构模型，Linux 的 SATA、SAS、USB Mass Storage、iSCSI 走的都是 SCSI 子系统。UFS 复用这套成熟栈，是它"出道即巅峰"的重要原因——内核侧的 ufshcd 驱动直接挂在 SCSI 框架下，上层的队列管理、错误恢复、电源管理全是现成的。

### M-PHY 物理层：Gear 档位

M-PHY 采用差分串行传输，速率按"Gear"分档：

| Gear | 每 lane 每方向速率 | 对应 UFS 版本 |
|------|------------------|--------------|
| Gear3 | 5.8 Gbit/s | UFS 2.1 |
| Gear4 | 11.6 Gbit/s | UFS 3.0/3.1 |
| Gear5 | 23.3 Gbit/s | UFS 4.0/4.1 |

以主流的 UFS 3.1（Gear4，每向 2 lane）算单向带宽：11.6 Gbit/s × 2 lane ≈ 23.2 Gbit/s ≈ 2.9 GB/s，扣除 8b/10b 编码与协议开销后，顺序读实测约 2100 MB/s。

### 物理连接：全双工的硬件基础

UFS 每向两条 lane，TX 和 RX 是**物理分离**的差分对，共 8 根数据线，外加一根独立参考时钟：

```
        19.2/38.4MHz
        REF_CLK ───────┐
                       ▼
              ┌──────────────┐         UFS Device
              │  UFS Host     │         (Flash 芯片)
              │  (SoC)        │
              │  TX_Lane0± ──┼──────► RX_Lane0±
              │  TX_Lane1± ──┼──────► RX_Lane1±
              │  RX_Lane0± ◄─┼──────── TX_Lane0±
              │  RX_Lane1± ◄─┼──────── TX_Lane1±
              │  DRESET# ────┼──────► 复位
              └──────────────┘
```

注意 REF_CLK：它是**独立参考时钟**，不从数据线恢复（M-PHY 是嵌入式时钟方案，REF_CLK 供 PHY 锁相环用）。这与 eMMC 的 CLK 线与数据同步翻转的机制完全不同。

> ⚠️ UFS 初始化失败的经典根因之一就是参考时钟：SoC 默认输出频率与 UFS 要求不符（比如默认 26MHz 而 PHY 配置按 38.4MHz），链路根本起不来，而且软件日志的报错往往指向别处。排查 UFS 链路问题，先用示波器确认 REF_CLK 的频率和摆幅，再进软件。

### 传输层：SCSI 命令 + 任务队列

UTP 层把 SCSI 命令封装成 UPIU（UFS Protocol Information Unit）数据包在链路上传输。常用命令：

| SCSI 命令 | 操作码 | 功能 |
|-----------|--------|------|
| INQUIRY | 0x12 | 查询设备型号、厂商 |
| READ_CAPACITY | 0x25 | 读总容量与块大小 |
| READ_10 / WRITE_10 | 0x28 / 0x2A | 数据读写 |
| START_STOP_UNIT | 0x1B | 控制电源状态 |

UTP 层的任务队列支持多达 32 条命令**乱序并发执行**——设备按 NAND 内部状态自行重排执行顺序，读完即可乱序返回。eMMC 同一时刻只处理一条命令；UFS 的队列让随机小 I/O 可以并发下压，这是它随机性能数量级领先的根本原因。

## 分区模型：LU 逻辑单元

UFS 支持最多 8 个逻辑单元（LU 0~7），每个 LU 独立寻址、独立配置写保护和块大小：

| LU | 典型用途 |
|----|---------|
| LU 0 | Boot LU A（Bootloader） |
| LU 1 | Boot LU B（A/B 升级备份） |
| LU 2~4 | 系统/厂商/用户数据分区 |
| LU 5 | RPMB（安全存储，机制与 eMMC RPMB 同源） |
| LU 6~7 | 保留/厂商自定义 |

> 逻辑单元（LU/LUN，Logical Unit）：SCSI 体系里的概念——同一物理设备内被独立编址、独立管理的逻辑盘。对操作系统来说每个 LU 像一个独立磁盘；对芯片来说它们是同一片 NAND 的不同逻辑视图。对比 eMMC：eMMC 的分区是**物理固化**的（Boot/RPMB/User 出厂划死），UFS 的 LU 划分灵活得多，容量可在产线配置。

Boot LU 的 A/B 双分区是手机"无缝更新"的硬件基础：OTA 新固件写未激活的 LU B，校验通过后切启动指向，失败则回退 LU A——与 eMMC 双 Boot 分区同理，但 UFS 把它做成了标准的 LU 语义。

## UFS vs eMMC：代际差距在哪

| 维度 | UFS 3.1 | eMMC 5.1 |
|------|---------|----------|
| 接口 | 串行差分（M-PHY） | 并行 8-bit |
| 传输模式 | **全双工** | 半双工 |
| 顺序读 | ~2100 MB/s | ~400 MB/s |
| 顺序写 | ~1200 MB/s | ~200 MB/s |
| 随机读 IOPS | ~100K | ~10K |
| 随机写 IOPS | ~70K | ~3K |
| 命令队列 | 32 条乱序 | 单命令 |
| 活跃功耗 | 略高 | 较低 |
| 深度睡眠功耗 | ~0.5 mW | ~2 mW |
| 单位容量成本 | 约 eMMC 的 2 倍 | 基准 |
| Linux 驱动 | ufshcd（SCSI 子系统） | mmcblk（MMC 子系统） |
| 设备节点 | `/dev/sdX` | `/dev/mmcblkN` |

三个差异值得展开：

**全双工是最本质的一条。** eMMC 的 8 根数据线同一时刻只能读或写；UFS 的 TX/RX 物理分离，读写可同时跑满。实际产品里大量场景是读写混合的——拍照时 ISP 连续写照片、相册同时读缩略图——eMMC 只能在两个方向间来回切换，UFS 两向互不干扰。

**随机性能差距比带宽差距更大（10~20 倍 vs 5 倍）。** 这正是"用起来卡不卡"的决定因素：App 启动、数据库操作、系统日志全是随机小 I/O。带宽决定拷大文件快不快，随机 IOPS 决定系统顺不顺。

**成本差距仍然存在。** 同容量 UFS 约贵一倍。对成本敏感的 IoT 与工控板，eMMC 仍是合理选择——不是因为性能够用，而是这 5 美元的差价在低毛利产品里是实打实的生死线。选型判据：产品是否有随机 I/O 密集负载（数据库、多应用并发）和对启动/响应速度的硬要求；有则 UFS，纯顺序大文件场景（数据记录仪）eMMC 足够。

## Linux ufshcd 驱动

UFS 控制器驱动在内核里是 `ufshcd`（`drivers/scsi/ufs/`），挂在 SCSI 子系统下。初始化主线的伪代码骨架：

```c
/* drivers/scsi/ufs/ufshcd.c 主线（简化示意） */

static int ufshcd_probe(struct platform_device *pdev)
{
    struct ufs_hba *hba;

    /* 1. 分配 host 结构，映射寄存器 */
    hba = kzalloc(sizeof(*hba), GFP_KERNEL);
    hba->mmio_base = devm_platform_ioremap_resource(pdev, 0);

    /* 2. 时钟：core_clk + ref_clk，ref_clk 必须先稳定 */
    ufshcd_init_clks(hba);

    /* 3. 配置 M-PHY 功率模式（Gear、lane 数） */
    ufshcd_init_pwr_info(hba);
    ufshcd_config_pwr_mode(hba, ...);

    /* 4. 控制器与链路启动（UniPro 层握手） */
    ufshcd_hba_stop(hba);
    ufshcd_hba_start(hba);
    ufshcd_dme_link_startup(hba);
    ufshcd_make_hba_operational(hba);

    /* 5. 注册进 SCSI 子系统，扫描 LU 0~7 */
    scsi_add_host(hba->host, hba->dev);
    scsi_scan_host(hba->host);

    /* 6. 读设备/几何/单元描述符，确定容量与 LU 配置 */
    ufshcd_read_device_desc(hba);
    ufshcd_read_geometry_desc(hba);
    ufshcd_read_unit_desc(hba);
    return 0;
}
```

数据路径一目了然：SCSI 层下来的读写命令 → UTP 封装成 UPIU → UIC（UniPro）链路传输 → M-PHY 发出。读写请求经 Doorbell 寄存器通知控制器，完成后中断回收。

> 💡 UFS 走 SCSI 子系统，设备节点是 `/dev/sda`、`/dev/sdb`。在嵌入式板子上看到 `/dev/sda` 却没有 SATA/SAS 硬盘，基本可以断定是 UFS。

### 设备树配置（高通平台示例）

```dts
&ufshc {
    compatible = "qcom,sm8250-ufshc";
    reg = <0x01d84000 0x3000>;
    interrupts = <GIC_SPI 264 IRQ_TYPE_LEVEL_HIGH>;

    /* M-PHY：每向 2 lane */
    lanes-per-direction = <2>;

    clocks = <&gcc GCC_UFS_PHY_AXI_CLK>,
             <&gcc GCC_UFS_PHY_ICE_CORE_CLK>,
             <&gcc GCC_UFS_PHY_TX_SYMBOL_0_CLK>,
             <&gcc GCC_UFS_PHY_RX_SYMBOL_0_CLK>,
             <&gcc GCC_UFS_PHY_RX_SYMBOL_1_CLK>,
             <&rpmhcc RPMH_CXO_CLK>;          /* 38.4MHz 参考时钟 */
    clock-names = "core_clk", "ice_core",
                  "tx_lane0_sync_clk", "rx_lane0_sync_clk",
                  "rx_lane1_sync_clk", "ref_clk";

    freq-table-hz = <0 0>, <0 0>, <0 0>, <0 0>, <0 0>,
                    <38400000>;               /* ref_clk 固定 38.4MHz */

    phys = <&ufsphy>;
    phy-names = "ufsphy";
    resets = <&gcc GCC_UFS_BCR>;

    vcc-supply = <&vreg_l13a_1p8>;
    vccq-supply = <&vreg_l19a_1p2>;
    vccq2-supply = <&vreg_l28a_1p2>;
    vcc-max-microamp = <800000>;
    vccq-max-microamp = <600000>;

    status = "okay";
};
```

要点：`lanes-per-direction` 决定 lane 数（写成 1 带宽直接减半，是常见的配置失误）；`ref_clk` 频率必须与硬件实际晶振一致；三路供电对应 UFS 的 VCC（核心）/ VCCQ（IO）/ VCCQ2（第二路 IO）。

## 实战验证：从初始化日志到性能基准

以一台搭载三星 128GB UFS 3.1（KLUDG4UHDB）的设备为例，验证四步：

**1. 确认链路与设备识别**

```bash
dmesg | grep -i "ufs\|scsi"
```

```
ufshcd-qcom 1d84000.ufshc: UFS link up: Gear4, 2 lanes
scsi 0:0:0:0: Direct-Access SAMSUNG KLUDG4UHDB-B2E1 0606 PQ: 0 ANSI: 6
sd 0:0:0:0: [sda] 249737216 512-byte logical blocks (128 GB)
```

`Gear4, 2 lanes` 是关键行——不是这个组合说明协商降级了。

**2. 确认工作参数**

```bash
cat /sys/class/scsi_disk/0:0:0:0/device/model     # 芯片型号
lsblk                                             # 分区挂载全貌
```

**3. 性能基准**

```bash
# 顺序读带宽：128K 块、direct I/O
fio --name=seqread --filename=/dev/sda --bs=128k \
    --rw=read --direct=1 --runtime=30

# 随机读 IOPS：4K 块、队列深度 32（吃满 UFS 命令队列）
fio --name=randread --filename=/dev/sda --bs=4k \
    --rw=randread --direct=1 --iodepth=32 --numjobs=4 --runtime=30
```

UFS 3.1 的预期量级：顺序读约 2000 MB/s，随机读 80K~100K IOPS。`iodepth=32` 这个参数不是随便写的——它就是对着 UFS 的 32 深度命令队列设计的；用默认 QD=1 测随机，测出来的结果会低估芯片一个数量级。fio 的完整用法（含掉电可靠性测试）在 B-C.8.5 实战篇展开。

**4. 对照排障**

| 症状 | 第一怀疑 |
|------|---------|
| dmesg 无 UFS 任何输出 | ref_clk 频率/幅度不对；VCCQ 供电缺失 |
| link up 但 Gear 低于预期 | 设备树 lanes/Gear 配置；PCB 走线质量 |
| 只有 1 lane | `lanes-per-direction` 写错，或 lane1 焊接/走线问题 |
| 性能远低于标称 | fio 队列深度太小；确认 direct=1 绕开页缓存 |

## 本节总结

| 自查项 | 读完本节你应能独立做到 |
|--------|----------------------|
| 协议栈 | 画出 UFS 四层栈并说清每层职责，解释复用 SCSI 的收益 |
| 物理层 | 说出 Gear3/4/5 的速率，解释 TX/RX 分离为何构成全双工 |
| 性能认知 | 解释 UFS 随机 IOPS 领先 eMMC 一个数量级的机制（命令队列），知道 fio 的 iodepth 为什么要配 32 |
| 分区模型 | 对比 LU 与 eMMC 物理分区的差异，说明 Boot LU A/B 升级流程 |
| 驱动框架 | 认出 `/dev/sdX` 背后的 ufshcd + SCSI 路径，读出初始化日志里的关键行 |
| 设备树 | 配出一个 UFS 控制器节点，指出 lanes-per-direction 和 ref_clk 写错的后果 |
| 选型 | 给定产品在 UFS 与 eMMC 之间做出有理据的选择 |

## 配套资源

- JEDEC 标准：JESD220F（UFS 4.0）、JESD223D（UniPro）
- 内核源码：`drivers/scsi/ufs/`（ufshcd.c 为核心）
- 内核文档：`Documentation/scsi/ufs.rst`
- Samsung UFS 应用笔记（AN-UFS-001）、Micron UFS 设计指南
