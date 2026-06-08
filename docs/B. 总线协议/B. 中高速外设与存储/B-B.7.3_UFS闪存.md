# B-B.7.3 UFS闪存

> 所属章节：第五部 B. 总线协议 > B-B.7 存储接口
>
> 难度：[E] Expert | 预计阅读时间：25分钟

## <span class="blue"> 本节导读

本节深入讲解UFS（Universal Flash Storage）闪存技术——eMMC的继任者。你所在的智能手机里很可能就有一块UFS芯片，它正是你打开APP秒速响应的幕后功臣。我们将从M-PHY物理层一路聊到Linux驱动框架，再给你一份真实的设备树配置和行业实例。读完本节，你会明白为什么高端嵌入式设备都在切UFS，以及为什么低端设备还在坚守eMMC。

## <span class="blue"> UFS架构与物理层 [E]

UFS不是简单的升级，而是全新的存储架构。它的设计灵感来自SCSI——没错，就是那个服务器上用了几十年的SCSI。

### 协议栈分层

```
┌─────────────────────────────────────┐
│        SCSI Application Layer        │  ← SCSI命令集（READ_10/WRITE_10等）
├─────────────────────────────────────┤
│    UFS Transport Layer (UTP)         │  ← UPIU数据包封装
├─────────────────────────────────────┤
│    UFS Interconnect Layer (UIC)      │  ← UniPro协议
├─────────────────────────────────────┤
│    MIPI M-PHY (物理层)                │  ← 差分信号，2 lane/4 lane
└─────────────────────────────────────┘
```

看到没有？UFS用了完整的四层协议栈，而eMMC只有简单的MMC命令集。这就是为什么UFS能跑那么快——每一层都为了性能而设计。

### MIPI M-PHY物理层

M-PHY是UFS的物理层基础，采用**差分信号传输**，支持全双工通信。M-PHY有多个速率档位（Gear）：

| Gear | 速率/方向 | 每Lane速率 | 推出年份 |
|:---:|:---:|:---:|:---:|
| M-PHY v1.0 | Gear2 | 2.9 Gbps/lane | 2011 |
| M-PHY v2.0 | Gear3 | 5.8 Gbps/lane | 2014 |
| M-PHY v3.0 | Gear4 | 11.6 Gbps/lane | 2017 |
| M-PHY v4.1 | Gear5 | 23.3 Gbps/lane | 2020 |

> 💡 **提示**：UFS 3.1使用Gear4（11.6 Gbps/lane），两条lane合计单向23.2 Gbps。注意这是**每方向**的速率——因为UFS是全双工的，TX和RX可以同时跑满。

UFS采用**双lane设计**，每个方向（TX/RX）各有两条差分对。这意味着总共需要 **8根数据线**：
- TX_Lane0+ / TX_Lane0-
- TX_Lane1+ / TX_Lane1-
- RX_Lane0+ / RX_Lane0-
- RX_Lane1+ / RX_Lane1-

### 物理连接图

```
                    ┌──────────────┐
                    │              │
   19.2MHz          │   UFS Host   │        UFS Device
   REF_CLK ─────────┤   (SoC)      │        (Flash芯片)
   (差分时钟)       │              │
                    │  TX_Lane0+ ──┼──────► RX_Lane0+
                    │  TX_Lane0- ──┼──────► RX_Lane0-
                    │  TX_Lane1+ ──┼──────► RX_Lane1+
                    │  TX_Lane1- ──┼──────► RX_Lane1-
                    │              │
                    │  RX_Lane0+ ◄─┼──────── TX_Lane0+
                    │  RX_Lane0- ◄─┼──────── TX_Lane0-
                    │  RX_Lane1+ ◄─┼──────── TX_Lane1+
                    │  RX_Lane1- ◄─┼──────── TX_Lane1-
                    │              │
                    │  DRESET# ────┼──────► 复位
                    └──────────────┘
```

注意这张图里的REF_CLK——它是**独立参考时钟**，不是从数据线里恢复的。这点和eMMC的CLK线完全不同。

> ⚠️ **陷阱**：UFS需要独立的参考时钟（19.2MHz或38.4MHz），且必须在上电时稳定。很多工程师遇到UFS初始化失败，排查半天才发现是时钟源配置错了——有的SoC默认输出26MHz，UFS根本不认！先用示波器确认REF_CLK频率和幅度（要求0.7V~1.2V差分摆幅），再查软件。

### SCSI命令与UTP传输层

UFS在传输层使用UTP（UFS Transport Protocol），将SCSI命令封装成UPIU（UFS Protocol Information Unit）数据包。常用的SCSI命令包括：

| SCSI命令 | 操作码 | 功能 |
|:---:|:---:|:---|
| READ_10 | 0x28 | 10字节地址读取 |
| WRITE_10 | 0x2A | 10字节地址写入 |
| INQUIRY | 0x12 | 查询设备信息 |
| READ_CAPACITY | 0x25 | 读取总容量 |
| START_STOP_UNIT | 0x1B | 控制设备电源状态 |

UTP层还实现了任务队列（Task Queue），支持多达32个命令的乱序执行，这是UFS随机性能远超eMMC的关键。

### 分区模型：LU（Logical Unit）

UFS支持最多 **8个逻辑单元（LU 0~7）**，每个LU独立寻址、独立管理。这与eMMC的单一分区不同：

| LU编号 | 用途 | 说明 |
|:---:|:---|:---|
| LU 0 | Boot LU A | 可启动分区，存放bootloader |
| LU 1 | Boot LU B | 备用启动分区（A/B升级用） |
| LU 2 | 用户数据（Userdata） | Android的/data分区 |
| LU 3 | 系统分区（System） | Android的/system分区 |
| LU 4 | Vendor分区 | Android的/vendor分区 |
| LU 5 | RPMB（Replay Protected Memory Block） | 安全存储，防回滚 |
| LU 6-7 | 保留/扩展 | 可由厂商自定义 |

每个LU有自己的**写保护**和**逻辑块大小**配置。RPMB LU是特殊的存在——它通过HMAC签名防止重放攻击，用于存储安全相关的数据（如DRM密钥、支付令牌）。

> 💡 **提示**：UFS的Boot LU支持A/B双分区机制。OTA升级时，新固件写入Boot LU B，验证成功后切换启动指向。升级失败也能回退，这是高端手机"无缝更新"的硬件基础。

## <span class="blue"> UFS vs eMMC：代际差距 [E]

UFS和eMMC不是同一代技术。下面从多个维度做全面对比：

| 对比维度 | UFS（3.1） | eMMC（5.1） | 差异说明 |
|:---|:---:|:---:|:---|
| **接口类型** | 串行MIPI M-PHY | 并行8-bit数据总线 | UFS串行抗干扰更强 |
| **传输模式** | **全双工** | **半双工** | 最关键的差异！ |
| **顺序读速率** | ~2100 MB/s | ~400 MB/s | **5x以上** |
| **顺序写速率** | ~1200 MB/s | ~200 MB/s | **6x** |
| **随机读IOPS** | ~100K | ~10K | **10x** |
| **随机写IOPS** | ~70K | ~3K | **23x** |
| **命令队列** | 32条乱序 | 无（单通道） | UFS支持多命令并行 |
| **功耗（活跃）** | ~500mW | ~400mW | UFS略高 |
| **功耗（DeepSleep）** | ~0.5mW | ~2mW | **UFS更省4x** |
| **引脚数** | 10根（2lane） | 11根（8data+CLK+CMD） | 几乎持平 |
| **BGA封装** | 153-ball 11.5x13mm | 153-ball 11.5x13mm | 兼容占位 |
| **单位容量成本** | ~$0.08/GB | ~$0.04/GB | UFS贵约2x |
| **Linux驱动** | ufshcd（SCSI子系统） | mmcblk（块设备层） | 架构完全不同 |

### 全双工 vs 半双工：本质区别

这是UFS碾压eMMC的核心原因。eMMC的8根数据线**同一时刻只能读或写**，就像单车道马路，来回车辆得轮流走。UFS则是**双向各两条独立lane**，就像高速公路的上下行分离，读写可以同时跑满。

实测场景：当你拍照时，ISP同时往存储写照片（大连续写），相册APP同时在读取缩略图（随机读）。eMMC得来回切换方向，UFS两边各跑各的——这就是高端手机拍照"零卡顿"的秘诀。

### 功耗：UFS反而更省电

活跃的UFS功耗确实比eMMC高一点（M-PHY收发器更复杂），但UFS的 **DeepSleep模式** 可以做到0.5mW以下。因为M-PHY支持低功耗状态（Hibernate/Sleep），而eMMC的并行总线始终有漏电流。

换算到手机续航上：锁屏待机8小时，UFS比eMMC省下的电量，大概能多刷20分钟短视频。

> 💡 **提示**：UFS是eMMC的继任者，新设计优先选UFS。但低端嵌入式仍用eMMC——不是因为性能够用，纯粹是UFS贵。一个128GB eMMC约$5，UFS约$10，对$20成本的IoT板子来说，这5美元的差价就是生死线。

## <span class="blue"> Linux UFSHCD驱动 [E]

### 设备树配置

```dts
/* UFS控制器节点示例 - 高通骁龙平台 */
&ufshc_mem {
    compatible = "qcom,sm8250-ufshc";
    reg = <0x01d84000 0x3000>;
    interrupts = <GIC_SPI 264 IRQ_TYPE_LEVEL_HIGH>;

    /* MIPI M-PHY - 2 lane配置 */
    lanes-per-direction = <2>;

    /* Gear4速率 = 11.6 Gbps/lane */
    /* rate = <A> 对应 M-PHY Gear4 */

    /* 参考时钟 38.4MHz */
    clocks = <&gcc GCC_UFS_PHY_AXI_CLK>,
             <&gcc GCC_UFS_PHY_ICE_CORE_CLK>,
             <&rpmhcc RPMH_CXO_CLK>;  /* 38.4MHz参考 */
    clock-names = "core_clk", "ice_core", "ref_clk";

    /* 连接UFS PHY */
    phys = <&ufsphy_mem>;
    phy-names = "ufsphy";

    /* 复位线 */
    resets = <&gcc GCC_UFS_BCR>;

    /* 工作电压 */
    vcc-supply = <&vreg_l13a_2p96>;
    vccq-supply = <&vreg_l19a_1p196>;
    vccq2-supply = <&vreg_l28a_1p196>;

    /* UFS设备子节点 */
    /* 固件会在probe时扫描SCSI LUN */
};
```

### 驱动框架

```c
/* Linux UFSHCD核心驱动（drivers/scsi/ufs/） */

static int ufshcd_probe(struct platform_device *pdev)
{
    struct ufs_hba *hba;

    /* 1. 分配host数据结构 */
    hba = kzalloc(sizeof(*hba), GFP_KERNEL);

    /* 2. 映射寄存器 - UFS寄存器 + UIC层寄存器 */
    hba->mmio_base = devm_platform_ioremap_resource(pdev, 0);

    /* 3. 初始化时钟（核心clk + ref_clk） */
    ufshcd_init_clks(hba);
    /* ⚠️ 这里ref_clk必须先于其他时钟稳定！ */

    /* 4. 初始化M-PHY */
    ufshcd_init_pwr_info(hba);
    ufshcd_config_pwr_mode(hba, /* Gear4, 2lane */);

    /* 5. 复位UFS设备 */
    ufshcd_hba_stop(hba);
    ufshcd_hba_start(hba);

    /* 6. 链路与设备初始化 */
    ufshcd_dme_link_startup(hba);   /* UniPro链路启动 */
    ufshcd_make_hba_operational(hba);

    /* 7. SCSI层注册 */
    scsi_add_host(hba->host, hba->dev);
    scsi_scan_host(hba->host);      /* 扫描LU 0-7 */

    /* 8. 读取设备描述符，配置LU */
    ufshcd_read_device_desc(hba);
    ufshcd_read_geometry_desc(hba); /* 容量/块大小 */
    ufshcd_read_unit_desc(hba);     /* LU配置 */

    dev_info(hba->dev, "UFS init OK: %dGB, Gear%d, %dlane\n",
             hba->capacity_gb, hba->pwr_info.gear_rx,
             hba->num_lanes);
    return 0;
}

/* 读操作：SCSI子系统 → UTP → UIC → M-PHY */
static int ufshcd_queuecommand(struct Scsi_Host *host,
                                struct scsi_cmnd *cmd)
{
    /* 构建UPIU数据包 */
    struct utp_upiu_req *req = /* ... */;
    req->header.transaction_code = UTP_UPIU_READ;
    req->cdb[0] = cmd->cmnd[0];  /* READ_10 */

    /* 发送UTRD到 Doorbell */
    ufshcd_send_command(hba, req);

    /* 中断到来时从UTRL提取响应 */
    return 0;
}
```

> 💡 **提示**：UFS在Linux里属于SCSI子系统，所以块设备名是`/dev/sda`（或`sdb`等），而不是eMMC的`/dev/mmcblk0`。如果你在嵌入式板子上看到`/dev/sda`却没有接SATA硬盘，恭喜你——大概率是UFS。

### 用户空间操作

```bash
# 查看UFS设备信息（通过SCSI接口）
$ cat /sys/class/scsi_disk/0:0:0:0/device/model
KLUDG4UHDB-B2E1          # Samsung UFS 3.1

# 查看容量
$ cat /sys/class/block/sda/size
249737216                  # 512-byte sectors

# RPMB LU操作（需要特权）
$ mmc rpmb read /dev/sda  # 读RPMB数据（有签名校验）

# 性能测试
$ fio --name=ufs-randread --filename=/dev/sda \
      --direct=1 --ioengine=libaio --iodepth=32 \
      --rw=randread --bs=4k --numjobs=4 --runtime=30
# 预期：随机读IOPS > 80K（UFS 3.1）

# dmesg中查看UFS初始化日志
$ dmesg | grep -i ufs
[    2.341] ufshcd-qcom 1d84000.ufshc: UFS link up: Gear4, 2 lanes
[    2.356] scsi 0:0:0:0: Direct-Access SAMSUNG KLUDG4UHDB-B2E1 0606 PQ: 0 ANSI: 6
[    2.367] sd 0:0:0:0: [sda] 249737216 512-byte logical blocks (128 GB)
```

### 调试命令速查

| 命令 | 用途 |
|:---|:---|
| `dmesg \| grep -i ufs` | 查看初始化日志 |
| `cat /sys/class/scsi_disk/*/device/model` | 识别UFS芯片型号 |
| `cat /sys/class/scsi_disk/*/device/vendor` | 查看厂商 |
| `cat /sys/class/ufs/ufs0/gear_mode` | 当前Gear档位 |
| `cat /sys/class/ufs/ufs0/lane_count` | 激活lane数 |
| `fio --bs=4k --rw=randread` | 随机读IOPS测试 |
| `fio --bs=128k --rw=read` | 顺序读带宽测试 |

## <span class="blue"> 行业实例：旗舰手机UFS 3.1存储配置 [E]

**场景**：某旗舰手机搭载三星128GB UFS 3.1芯片（KLUDG4UHDB），Android系统。

### 性能指标

| 测试项目 | 实测数据 | 说明 |
|:---:|:---:|:---|
| 顺序读取 | ~2100 MB/s | 128KB block, queue_depth=32 |
| 顺序写入 | ~1200 MB/s | 写入放大（WAF）约1.3x |
| 随机读取 | ~100K IOPS | 4KB, QD=32 |
| 随机写入 | ~70K IOPS | 4KB, QD=32 |
| 延迟（读） | ~10 μs | 4KB QD=1 |
| DeepSleep功耗 | ~0.5 mW | 锁屏待机时使用 |

### LU分区映射

| LU | 分区名 | 容量 | 用途 |
|:---:|:---|:---:|:---|
| LU 0 | Boot A | 64MB | Kernel + dtb + ramdisk |
| LU 1 | Boot B | 64MB | OTA备用启动 |
| LU 2 | System | 4GB | Android /system（只读） |
| LU 3 | Vendor | 2GB | 厂商HAL和驱动 |
| LU 4 | Userdata | 110GB | /data + 用户文件 |
| LU 5 | RPMB | 4MB | 安全密钥（TK + 设备证书） |

### 完整设备树节点

```dts
&ufshc {
    compatible = "qcom,sm8250-ufshc";
    reg = <0x01d84000 0x3000>;
    interrupts = <GIC_SPI 264 IRQ_TYPE_LEVEL_HIGH>;

    /* M-PHY: 2 lane, Gear4 */
    lanes-per-direction = <2>;

    clocks = <&gcc GCC_UFS_PHY_AXI_CLK>,
             <&gcc GCC_UFS_PHY_ICE_CORE_CLK>,
             <&gcc GCC_UFS_PHY_TX_SYMBOL_0_CLK>,
             <&gcc GCC_UFS_PHY_RX_SYMBOL_0_CLK>,
             <&gcc GCC_UFS_PHY_RX_SYMBOL_1_CLK>,
             <&rpmhcc RPMH_CXO_CLK>;  /* 38.4MHz */
    clock-names = "core_clk", "ice_core",
                  "tx_lane0_sync_clk", "rx_lane0_sync_clk",
                  "rx_lane1_sync_clk", "ref_clk";

    freq-table-hz = <0 0>,        /* core_clk: auto */
                    <0 0>,        /* ice_core: auto */
                    <0 0>, <0 0>, /* lane sync: auto */
                    <0 0>,        /* lane1 sync */
                    <38400000>;   /* ref_clk: fixed 38.4MHz */

    phys = <&ufsphy>;
    phy-names = "ufsphy";
    resets = <&gcc GCC_UFS_BCR>;

    /* 电源：1.8V IO + 1.2V core */
    vcc-supply = <&vreg_l13a_1p8>;
    vccq-supply = <&vreg_l19a_1p2>;
    vccq2-supply = <&vreg_l28a_1p2>;

    /* UFS限流保护 */
    vcc-max-microamp = <800000>;
    vccq-max-microamp = <600000>;

    status = "okay";
};
```

### 验证步骤

```bash
# 1. 确认UFS识别成功
$ dmesg | grep -i "ufs\|scsi"
[    2.341] ufshcd-qcom: UFS link up: Gear4, 2 lanes
[    2.356] scsi 0:0:0:0: SAMSUNG 128GB UFS 3.1

# 2. 检查当前Gear和lane数
$ cat /sys/class/ufs/ufs0/gear_mode
4
$ cat /sys/class/ufs/ufs0/lane_count
2

# 3. 分区验证 - 检查各LU挂载
$ lsblk | grep sd
sda    128G  0 disk
├─sda1  64M  0 part  /boot
├─sda2   4G  0 part  /system
├─sda3   2G  0 part  /vendor
└─sda4 110G  0 part  /data

# 4. 性能基准测试
$ fio --name=seqread --filename=/dev/sda --bs=128k \
      --rw=read --direct=1 --numjobs=1 --runtime=30
# 期望结果：READ: bw=2000MiB/s

# 5. RPMB验证（安全分区）
$ cat /sys/class/scsi_disk/0:0:0:5/device/type
0   # LU 5 = RPMB
```

> 💡 **提示**：如果你的UFS只跑到Gear1（2.9Gbps），先检查设备树里的`lanes-per-direction`是否为2。单lane模式下带宽直接减半——你以为买了UFS 3.1，实际体验跟UFS 2.1差不多。

## <span class="blue"> 本节总结

| 项目 | 内容 |
|:---|:---|
| **UFS全称** | Universal Flash Storage，eMMC继任者 |
| **物理层** | MIPI M-PHY，差分串行，全双工 |
| **速率版本** | UFS 2.1(Gear3/5.8G) → UFS 3.0(Gear4/11.6G) → UFS 3.1(Gear4+写加速) → UFS 4.0(Gear5/23.3G) |
| **协议栈** | SCSI命令 → UTP → UniPro → M-PHY |
| **关键优势** | 全双工 + 命令队列 = 随机读10x于eMMC |
| **分区模型** | LU 0~7，支持独立Boot LU和RPMB安全分区 |
| **Linux驱动** | ufshcd（SCSI子系统），设备名`/dev/sdX` |
| **调试要点** | 先确认REF_CLK频率 → 查Gear/lane → 看dmesg |
| **成本考量** | UFS比eMMC贵~2x，低端嵌入式仍选eMMC |
| **新设计建议** | 2024年起新设计优先UFS 3.1，成本可接受且生态成熟 |

## <span class="blue"> 配套资源

- **JEDEC标准**：JESD220F（UFS v4.0基线规范）、JESD223D（UniPro v2.0）
- **Linux源码**：`drivers/scsi/ufs/` —— ufshcd.c为核心文件
- **文档**：`Documentation/scsi/ufs.rst`
- **厂商资料**：Samsung UFS应用笔记（AN-UFS-001）、Micron UFS设计指南

## <span class="blue"> 下一步

下一节 **B-B.7.4 SPI NAND与QSPI** —— 我们将把目光转向小容量存储方案。NOR Flash的继任者SPI NAND如何用更少的引脚实现更大容量？QSPI四线模式又怎样把读取速率推到80MB/s以上？这些正是IoT设备、路由器和工控板最爱的廉价存储方案。
