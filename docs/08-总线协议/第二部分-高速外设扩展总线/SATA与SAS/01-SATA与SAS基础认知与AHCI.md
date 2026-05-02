# SATA 与 SAS 基础认知与 AHCI [E]

> **本章学习目标**：
> - 理解 <span class="red">SATA（Serial ATA）</span> 从并行 ATA 演进的动机
> - 掌握 <span class="red">AHCI（Advanced Host Controller Interface）</span> 与 NCQ 原理解析
> - 了解 SAS（Serial Attached SCSI）在企业级存储中的定位

---

## SATA 的诞生：从并行走线噩梦到串行优雅

---

### <strong>为什么需要 SATA：PATA 的物理极限</strong>

<span class="red">SATA</span>由 <span class="green">Intel</span> 主导设计，<span class="green">2003 年</span>正式发布（SATA 1.0，1.5Gbps）。
<br>
前身是 <span class="green">PATA（Parallel ATA）</span>，即 IDE 接口。
<br>

PATA 的物理问题在 <span class="green">2000 年</span>已无法解决：
<br>
* 40 根并行数据线（80 根含地线），PCB 走线密集
<br>
* 信号串扰严重，最高仅支持 <span class="blue">133 MB/s（ATA-7）</span>
<br>
* 排线宽大，阻碍机箱风道
<br>
* 不支持热插拔
<br>

<span class="blue">SATA 用 2 根差分线替代 40 根并行线，速度提升到 1.5Gbps（150MB/s），支持热插拔，线缆细软易布线。</span>
<br>

<span class="blue">类比：PATA 如同"40 车道的高速公路但所有车必须并排行驶"——车道再多，协调成本极高；SATA 如同"2 车道的地铁"——虽然车道少，但调度高效、速度更快。</span>
<br>

---

### <strong>SATA 的物理层：7-pin 数据 + 15-pin 电源</strong>

<span class="red">SATA</span>连接器分为数据和电源两部分：
<br>

| 类型 | 引脚数 | 信号 | 说明 |
| --- | --- | --- | --- |
| 数据口 | 7 pin | 2 对差分（TX+/TX-, RX+/RX-）+ 3 地 | 热插拔设计 |
| 电源口 | 15 pin | +3.3V/+5V/+12V + 地 + 唤醒/活动灯 | 支持热插拔检测 |

```mermaid
flowchart TD
    HOST["SATA Host\nAHCI 控制器"]
    HDD["SATA HDD/SSD"]
    
    HOST --"TX+ / TX-"--\u003e HDD
    HDD --"RX+ / RX-"--\u003e HOST
    
    subgraph 差分信号
        TX["Host → Device\n发送数据"]
        RX["Device → Host\n接收数据"]
    end
```

<span class="blue">SATA 使用 8b/10b 编码：每 8 bit 数据编码为 10 bit 传输，保证 DC 平衡和时钟恢复。1.5Gbps 物理层实际吞吐量 = 1.5Gbps × 0.8 = 150MB/s。</span>
<br>

---

### <strong>AHCI 与 NCQ：从 IDE 到现代存储控制器</strong>

<span class="red">AHCI</span>是 Intel 2004 年提出的标准，定义了 SATA 控制器的寄存器接口：
<br>

| 特性 | IDE 模式 | AHCI 模式 | 差异 |
| --- | --- | --- | --- |
| 命令队列 | 单命令 | 32 命令 NCQ | 多命令并行 |
| 热插拔 | 不支持 | 支持 | 即插即用 |
| 端口数 | 2 个 | 32 个 | 扩展性 |
| 驱动模式 | 兼容旧驱动 | 需 AHCI 驱动 | 性能更好 |

<span class="blue">NCQ（Native Command Queuing）允许硬盘内部重排序命令，减少磁头寻道时间。机械硬盘提升 10~15% 性能，SSD 提升 IOPS。</span>
<br>

---

### <strong>SAS：企业级存储的串行 SCSI</strong>

<span class="red">SAS（Serial Attached SCSI）</span>是 SCSI 的串行版本，2004 年发布：
<br>
* 与 SATA 物理层兼容（SAS 控制器可接 SATA 硬盘）
<br>
* 支持双端口（冗余路径）
<br>
* 支持多 initiator（多主机共享存储）
<br>
* 速率从 3Gbps → 6Gbps → 12Gbps → 22.5Gbps
<br>

```mermaid
flowchart TD
    HBA["SAS HBA\nHost Bus Adapter"]
    EXP["SAS Expander\n扩展器"]
    DISK1["SAS HDD\n企业级"]
    DISK2["SATA SSD\n消费级"]
    
    HBA --"SAS Link"--\u003e EXP
    EXP --"SAS Link"--\u003e DISK1
    EXP --"SATA 兼容"--\u003e DISK2
```

---

## 本章小结

| 概念 | 一句话总结 |
| --- | --- |
| SATA | Intel 2003 年提出的串行 ATA，替代 PATA |
| AHCI | SATA 控制器的标准寄存器接口，支持 NCQ 和热插拔 |
| NCQ | 原生命令队列，硬盘内部重排序优化寻道 |
| SAS | SCSI 的串行版本，企业级存储，兼容 SATA |
| 8b/10b | 编码效率 80%，保证 DC 平衡 |

---

## 练习

1. 为什么 SATA 使用 8b/10b 编码而不是直接传输原始数据？
2. 在 Linux 内核中，如何确认 SATA 控制器工作在 AHCI 模式而不是 IDE 兼容模式？
3. 设计一个工业 NAS：8 盘位 SATA + SAS HBA，画出拓扑并标注速率。
