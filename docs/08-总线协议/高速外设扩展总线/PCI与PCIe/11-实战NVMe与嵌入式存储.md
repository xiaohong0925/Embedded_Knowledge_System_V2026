# 实战NVMe与嵌入式存储

<span class="badge-e">[Expert]</span>

<span class="red">NVMe（Non-Volatile Memory Express）</span> 是专为闪存设计的主机控制器接口标准，通过 PCIe 提供超低延迟、高并发的存储访问。

---

## <strong>基础认知</strong>

### <strong>为什么 NVMe 替代 AHCI</strong>

| 特性 | AHCI（SATA） | NVMe（PCIe） |
|------|-------------|--------------|
| 队列深度 | 1（32命令） | 64K 队列 × 64K 命令 |
| 延迟 | ~6μs | ~2.5μs |
| 并发 | 单队列 | 多队列并行 |
|  CPU 开销 | 高（中断频繁） | 低（ Doorbell + MSI-X） |

<span class="blue">NVMe 专为 SSD 并行架构设计</span>，彻底摆脱旋转磁盘的单队列思维。

---

## <strong>原理解析</strong>

### <strong>SQ/CQ 机制</strong>

```
Host                          Controller
  │                             │
  │── 写入命令到 SQ ───────────▶│
  │── 写 Doorbell（Tail Doorbell）▶│
  │                             │ 处理命令
  │                             │── 完成命令 ───▶ CQ
  │◀── MSI-X 中断 ─────────────│
  │── 读 CQ Head Doorbell ◀────│
```

<span class="red">每个 CPU 核心可拥有独立的 SQ/CQ 对</span>，消除锁竞争。

### <strong>嵌入式 NVMe 控制器</strong>

| 控制器 | 接口 | 性能 | 适用场景 |
|--------|------|------|----------|
| Phison E12S | PCIe 3.0 x4 | 3.5GB/s | 高端嵌入式 |
| Silicon Motion SM2263 | PCIe 3.0 x4 | 2.4GB/s | 中端工业 |
| Innogrit Rainier | PCIe 4.0 x4 | 7.0GB/s | 数据中心边缘 |
| 国产联芸 MAP1602 | PCIe 4.0 x4 | 7.4GB/s | 信创替代 |

---

## <strong>技术教学</strong>

### <strong>NVMe 设备识别</strong>

```bash
# 查看 NVMe 设备
nvme list
# Node          SN         Model          Namespace  Size
# /dev/nvme0n1  ABC123     Samsung SSD    1          1TB

# 查看控制器信息
nvme id-ctrl /dev/nvme0
# vid: 0x144d (Samsung)
# ssvid: 0x144d
# mn: Samsung SSD 970 EVO Plus
# sn: S4J4NX0R123456
```

### <strong>性能测试</strong>

```bash
# 测试 4K 随机读 IOPS
fio --name=randread --ioengine=libaio --iodepth=32     --rw=randread --bs=4k --direct=1 --size=1G     --numjobs=4 --runtime=60 --group_reporting     --filename=/dev/nvme0n1
```

---

## <strong>软硬件实战</strong>

### <strong>场景：嵌入式平台 NVMe 启动</strong>

```bash
# U-Boot 配置 NVMe 启动
setenv bootcmd 'nvme scan; load nvme 0:1 ${kernel_addr_r} boot/Image; booti ${kernel_addr_r} - ${fdt_addr}'
```

<span class="blue">现代 U-Boot 支持 NVMe 作为启动介质</span>，无需传统 SATA/eMMC。

---

## <strong>历史演进</strong>

- <span class="green">2011 年 NVMe 1.0</span> — 定义寄存器接口和命令集<br>
- <span class="green">2014 年 NVMe 1.2</span> — 引入多命名空间、SR-IOV 支持<br>
- <span class="green">2021 年 NVMe 2.0</span> — 模块化架构、ZNS、KV 命令集<br>
- <span class="green">2024 年 NVMe 2.1</span> — CXL 内存池支持、性能追踪扩展

---

## 小结与练习

| 要点 | 说明 |
|------|------|
| 核心概念 | NVMe 通过多队列并行机制释放闪存性能潜力 |
| 关键技能 | 配置 SQ/CQ、调优中断亲和性、选择合适控制器 |

**练习**

1. 计算 NVMe 理论最大 IOPS（假设 2.5μs 延迟，忽略传输时间）。
2. 比较 NVMe-oF（RDMA/TCP）在嵌入式边缘场景的可行性。
3. 设计一个 NVMe RAID 0 阵列的性能监控方案。
