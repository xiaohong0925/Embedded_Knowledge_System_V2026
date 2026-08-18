# B-C.8.5 实战：eMMC 分区、掉电可靠性与 fio 性能/寿命测试

> 所属章节：第五部 B. 总线协议 > C. 中高速外设与存储
>
> 难度：[M] | 预计阅读时间：40 分钟（含动手 60~90 分钟）

## 本节导读

前两节讲了 eMMC 的协议和 Linux 驱动——都是"它是什么"。这一节解决"怎么用得放心"：嵌入式产品的存储翻车，十有八九不在读写速度，而在**分区规划不合理**（Bootloader 升级变砖）、**掉电丢数据**（日志写一半断电，文件系统损坏）、**寿命耗尽无预警**（设备在客户现场批量死亡）。

本实战在一块真实开发板上完成四件事：按产品标准规划并创建 eMMC 分区；用 mmc-utils 读写 EXT_CSD、操作 Boot 分区；用 fio 做标准化性能基准，并对比"页缓存"与"裸设备"两种结果背后的含义；最后做一个大多数工程师从没做过的实验——**写入过程中直接断电**，观察文件系统的真实表现，据此设计掉电保护策略。

本节覆盖：产品级 eMMC 分区布局设计、mmc-utils 的 EXT_CSD/Boot 分区/寿命读取、fio 的四种标准测试模式与结果解读、掉电实验的设计与数据保护方案选型。

## 准备工作

硬件：任意一块以 eMMC 为系统盘的开发板（RK3566/3568、i.MX8M、树莓派 CM4 等均可）。软件：

```bash
# Debian/Ubuntu 系（含 Buildroot 选配）
apt install mmc-utils fio parted
```

Buildroot 里对应 `BR2_PACKAGE_MMC_UTILS`、`BR2_PACKAGE_FIO`。

> ⚠️ 本实战的所有破坏性操作（分区、写裸设备、断电）都只针对**实验板**。先确认 `lsblk` 里 eMMC 设备名（通常 `/dev/mmcblk0` 或 `mmcblk1`），下面命令里的设备名按你的实际情况替换。写错设备名把 SD 卡或 U 盘格了，别怪没人提醒。

## 任务一：产品级分区布局

先想清楚再动手。一个要 OTA 升级、要记日志的工业设备，eMMC User Area 的分区应该长这样：

```
/dev/mmcblk0（User Data Area，GPT 分区表）
├─ p1  boot_a     64MB   FAT32   内核+DTB（A 槽）
├─ p2  boot_b     64MB   FAT32   内核+DTB（B 槽，OTA 双备份）
├─ p3  rootfs_a  512MB   ext4    根文件系统 A 槽（只读挂载）
├─ p4  rootfs_b  512MB   ext4    根文件系统 B 槽
├─ p5  data      剩余    ext4    应用数据、日志（可写）
└─ （Bootloader 在硬件 Boot1/Boot2 分区，不占 User Area）
```

设计逻辑三条：boot 和 rootfs 都做 A/B 双槽，升级写非活动槽、校验后切换，任意时刻都有一个能启动的系统；rootfs 平时只读挂载，掉电不会损坏只读文件系统；所有"经常写"的东西（日志、数据库、配置）集中在 data 分区，把磨损和掉电风险隔离在一个分区内。

创建（在板子上执行）：

```bash
parted /dev/mmcblk0 mklabel gpt
parted -a optimal /dev/mmcblk0 mkpart boot_a  fat32   4MiB   68MiB
parted -a optimal /dev/mmcblk0 mkpart boot_b  fat32  68MiB  132MiB
parted -a optimal /dev/mmcblk0 mkpart rootfs_a ext4 132MiB  644MiB
parted -a optimal /dev/mmcblk0 mkpart rootfs_b ext4 644MiB 1156MiB
parted -a optimal /dev/mmcblk0 mkpart data     ext4 1156MiB  100%

# 第一个分区从 4MiB 起而不是 0：给 GPT 头和可能的 SPL 预留空间，
# 且 4MiB 对齐正好落在 eMMC 擦除块边界上，避免跨块写放大
for p in 1 2;   do mkfs.vfat -F 32 /dev/mmcblk0p$p; done
for p in 3 4 5; do mkfs.ext4 /dev/mmcblk0p$p; done
```

> 写放大（Write Amplification）：文件系统写 4KB，NAND 实际擦写的数据量却远大于 4KB——因为 NAND 只能整块（如 512KB）擦除，改一小块要先读出整块、擦掉、重写。分区对齐擦除块边界、文件系统块大小匹配，都能压低写放大，直接延长 eMMC 寿命。

验证：

```bash
lsblk /dev/mmcblk0
parted /dev/mmcblk0 print
```

## 任务二：EXT_CSD 与 Boot 分区实操

mmc-utils 是用户态操作 eMMC 的瑞士军刀，它把 B-C.8.1 讲的 CMD6/CMD8 包装成了命令。

### 读 EXT_CSD，核对关键字段

```bash
mmc extcsd read /dev/mmcblk0 | grep -E "LIFE_TIME|PARTITION_CONFIG|BUS_WIDTH|HS_TIMING|CARD_TYPE"
```

```
Device life time estimation type A [EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_A]: 0x01
Device life time estimation type B [EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_B]: 0x01
Boot configuration [EXT_CSD_PART_CONFIG]: 0x48
Card Type [EXT_CSD_CARD_TYPE]: 0x57
Bus Width [EXT_CSD_BUS_WIDTH]: 0x02
High Speed Timing [EXT_CSD_HS_TIMING]: 0x03
```

对照 B-C.8.1 的字段表逐项解读：`0x03` HS_TIMING = HS400、`0x02` BUS_WIDTH = 8-bit、`0x57` CARD_TYPE 位图。这一步的目的是建立直觉：**芯片当前工作在什么状态，寄存器里全写着，随时可查。**

### Boot 分区读写与启动配置

```bash
# 看当前从哪个分区启动
mmc bootpart enable --help   # 先看用法
mmc extcsd read /dev/mmcblk0 | grep PART_CONFIG

# 读 Boot1 前 4KB 到文件（确认 Bootloader 在里面）
dd if=/dev/mmcblk0boot0 of=/tmp/boot1_head.bin bs=4096 count=1
hexdump -C /tmp/boot1_head.bin | head -5
```

写 Boot 分区（OTA 场景写入新 Bootloader 的标准动作）：

```bash
# 1. 解除写保护
mmc writeprotect none /dev/mmcblk0boot1

# 2. 写入（目标是非活动分区 boot1，即 mmcblk0boot1）
dd if=u-boot-new.img of=/dev/mmcblk0boot1 bs=4096 conv=fsync
sync

# 3. 读回比对——烧录的铁律：不信返回码，信 cmp
dd if=/dev/mmcblk0boot1 of=/tmp/boot1_verify.bin bs=4096 count=$(stat -c%s u-boot-new.img | awk '{print int(($1+4095)/4096)}')
cmp u-boot-new.img /tmp/boot1_verify.bin && echo "写入验证通过"

# 4. 切换启动分区（EXT_CSD[179]，下次上电生效）
mmc bootpart enable 2 0 /dev/mmcblk0    # 2=Boot2，不发 ACK
```

> 🔴 `mmc bootpart enable` 改的是芯片里的**一次性可写有限次**的配置位（严格说 EXT_CSD 的启动配置可改次数受芯片限制）。产线流程里这一步要做进防呆脚本：写错目标分区、写错 ACK 位，后果是批量变砖。

### 寿命读取与巡检

```bash
mmc extcsd read /dev/mmcblk0 | grep -E "LIFE_TIME|PRE_EOL"
```

`PRE_EOL_INFO` 是更早期的预警字段（0x01 正常，0x02 = 80% 保留块已消耗，0x03 = 危险）。巡检脚本把三个值都记下来，趋势比单点值更有诊断价值——某个月 LIFE_TIME 从 0x03 跳到 0x05，说明这两个月写入量异常，该去查是不是哪个服务在疯狂写日志。

## 任务三：fio 标准化性能测试

`dd` 只能测顺序吞吐，而且容易被页缓存骗。fio（Flexible I/O Tester）是存储性能测试的行业标准工具，四个测试构成一套完整基准：

```bash
mkdir -p /mnt/data && mount /dev/mmcblk0p5 /mnt/data
cd /mnt/data

# ① 顺序写带宽（模拟刷固件、拷大文件）
fio --name=seqwrite --filename=testfile --size=1G \
    --bs=1M --rw=write --direct=1 --runtime=30 --time_based --group_reporting

# ② 顺序读带宽（模拟读大文件）
fio --name=seqread --filename=testfile --size=1G \
    --bs=1M --rw=read --direct=1 --runtime=30 --time_based --group_reporting

# ③ 随机读 IOPS（模拟系统启动、应用加载——体验卡顿的关键指标）
fio --name=randread --filename=testfile --size=1G \
    --bs=4k --rw=randread --direct=1 --iodepth=32 --runtime=30 --time_based --group_reporting

# ④ 随机写 IOPS（模拟日志、数据库写入）
fio --name=randwrite --filename=testfile --size=1G \
    --bs=4k --rw=randwrite --direct=1 --iodepth=32 --runtime=30 --time_based --group_reporting
```

关键参数的含义：

| 参数 | 作用 | 不用的后果 |
|------|------|-----------|
| `direct=1` | 绕过页缓存直读写设备 | 不测会读到内存缓存，结果虚高一个数量级 |
| `iodepth=32` | 异步队列深度 32 | 深度 1 时测的是延迟而非设备并发能力 |
| `bs=4k` | 块大小 4KB | 随机测试的行业标准块大小 |
| `--time_based --runtime=30` | 跑满 30 秒 | 文件写完就停，时间太短结果不稳 |

结果解读看输出末尾的汇总行：`WRITE: bw=xxx MiB/s` 是带宽；随机测试看 `IOPS=xx.xk`。HS400 的 eMMC 5.1 参考量级：顺序读 250~330 MB/s，顺序写 100~200 MB/s，随机读 8~15K IOPS，随机写 4~10K IOPS。**拿到手先和这几个数对一遍**——差一个数量级就是哪里不对（协商模式、direct 没开、电源管理干扰），差两三倍可能是芯片档次或写放大。

顺带做一个对照实验加深理解：把 `direct=1` 去掉重跑顺序读，会看到带宽"飙升"到 GB/s 级——那是页缓存的速度不是 eMMC 的速度。这个对照能让你以后看任何人的测试报告时先问一句：direct 开了吗？

## 任务四：掉电实验——直面嵌入式存储的头号杀手

实验室里跑得好好的设备，到现场批量死机，最大的单一原因是**写入中断电**。这个实验就是要在可控环境下把它复现出来，看清楚地层发生了什么。

### 实验设计

```bash
# 终端 1：持续写文件（模拟日志写入）
mount /dev/mmcblk0p5 /mnt/data
while true; do
    echo "$(date +%s.%N) sensor_data_packet" >> /mnt/data/log.txt
    usleep 10000 2>/dev/null || sleep 0.01
done
```

终端 2 数 3~5 秒后**直接拔电源**（不是 reboot、不是关机——拔电）。等 10 秒，重新上电，检查现场：

```bash
mount /dev/mmcblk0p5 /mnt/data
tail -5 /mnt/data/log.txt         # 末尾数据完整吗？
dumpe2fs /dev/mmcblk0p5 | grep -i "state\|error"   # 文件系统状态
dmesg | grep -i "ext4\|mmc"       # 有没有恢复日志
```

### 可能观察到的现象与解读

| 现象 | 原因 | 严重程度 |
|------|------|---------|
| 一切正常，日志末尾只丢最后几行 | ext4 journal 扛住了，页缓存里没落盘的数据丢了 | 正常损耗 |
| 开机 fsck 修复若干 inode | 元数据写了一半 | journal 已兜住 |
| 文件末尾出现大段 `\0`（空洞） | 块已分配但数据未写入 | 应用读到假数据 |
| 文件系统损坏需人工 fsck | journal 本身被打断 + 元数据损坏 | 需要防护设计 |
| 反复断电后 eMMC 彻底只读 | 芯片保护机制触发 | 硬件级报废 |

跑 10~20 次循环统计分布，比跑一次更有说服力。

### 防护策略选型

实验做完，防护措施的取舍就有依据了：

| 措施 | 成本 | 保护范围 | 适用 |
|------|------|---------|------|
| 挂载选项 `sync` 或 `data=journal` | 性能下降 30%+ | 每次写都落盘 | 写入量小的场景 |
| 应用层 `fsync()` 关键数据后写标志位 | 代码改动 | 关键文件原子性 | 配置文件、数据库 |
| rootfs 只读 + data 分区隔离 | 架构改动 | 系统区永不损坏 | 绝大多数工业产品 |
| 超级电容/掉电检测 GPIO + 紧急 sync | BOM 增加 | 争取 50~200ms 收尾时间 | 高端设备 |
| 换用带断电保护（PLP）电容的工业 eMMC | 物料贵 20~50% | 芯片内写操作可完成 | 高可靠场景 |

工程上的标准答案几乎总是组合：rootfs 只读 + 数据分区隔离 + 应用层 fsync 纪律 + 寿命巡检。超级电容留给"数据丢了就出事故"的场景。

## 排障速查

| 症状 | 第一怀疑 |
|------|---------|
| fio 带宽只有几十 MB/s | 协商模式降级（查 dmesg 的 HS400 行）；忘加 `direct=1` 的反向——检查是否被缓存骗了 |
| 随机写 IOPS 极低且波动大 | eMMC Cache 没开（EXT_CSD 查 CACHE_CTRL）；写放大严重 |
| Boot 分区 dd 写不动 | 写保护没解：`mmc writeprotect none` |
| 掉电后必现 fsck 长修复 | 挂载缺 journal；考虑 data=journal 或换 F2FS/UBIFS |
| LIFE_TIME 增长异常快 | 找写入大户：`iostat -x 1` 看哪个进程在狂写 |

## 本节总结

| 自查项 | 完成本实战你应能独立做到 |
|--------|------------------------|
| 分区设计 | 为一个带 OTA 的产品设计 A/B 分区布局并说出每条设计理由 |
| Boot 操作 | 用 mmc-utils 完成 Boot 分区的解锁、写入、读回验证、启动切换 |
| 性能基准 | 用 fio 跑齐四种标准测试，解读结果并识别"页缓存骗局" |
| 掉电验证 | 设计并执行断电实验，把观察到的现象映射到根因 |
| 防护选型 | 针对给定产品的可靠性等级，给出分层的掉电保护组合方案 |
| 寿命运维 | 建立 PRE_EOL + LIFE_TIME 的巡检机制并设定预警阈值 |

## 配套资源

- mmc-utils 源码与 man 页（每个子命令都对应一条 MMC 命令）
- fio 官方文档：https://fio.readthedocs.io/
- 内核 ext4 挂载选项文档：`Documentation/filesystems/ext4/`（`data=journal`、`commit` 等）
- JEDEC JESD84-B51 第 6.6 节：断电通知与可靠写（Reliable Write）机制
