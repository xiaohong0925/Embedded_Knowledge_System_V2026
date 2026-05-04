# 虚拟化与SR-IOV

<span class="badge-e">[Expert]</span>

<span class="red">SR-IOV（Single Root I/O Virtualization）</span> 允许单个物理PCIe设备在硬件层面虚拟出多个VF（Virtual Function），供虚拟机直接访问。

---

## <strong>基础认知</strong>

### <strong>为什么需要SR-IOV</strong>

<span class="blue">传统虚拟化通过软件模拟设备，CPU开销高、延迟大。</span> SR-IOV 让硬件直接分配资源给虚拟机， bypass Hypervisor 数据路径。

| 方式 | 路径 | 延迟 | CPU 开销 |
|------|------|------|----------|
| 软件模拟 | VM -> Hypervisor -> 驱动 | 高 | 高 |
| VFIO 直通 | VM -> VF（硬件） | 低 | 低 |
| SR-IOV | VM -> VF，共享 PF 配置 | 低 | 极低 |

---

## <strong>原理解析</strong>

### <strong>PF 与 VF 架构</strong>

```
Physical Function (PF)
  ├── VF 0  → 分配给 VM 0
  ├── VF 1  → 分配给 VM 1
  ├── ...
  └── VF N  → 分配给 VM N

PF: 完整功能，管理所有 VF
VF: 轻量功能，仅数据路径
```

<span class="red">VF 共享 PF 的物理资源（MAC地址池、队列对）</span>，但拥有独立的配置空间和 BAR。

### <strong>BAR 在虚拟化中的映射</strong>

```c
// VF 的 BAR 是 PF BAR 的子集
// 例如：PF BAR0 = 256MB，每个 VF 分配 16MB
vf_bar_size = pf_bar_size / total_vfs;
vf0_base = pf_bar_base + 0 * vf_bar_size;
vf1_base = pf_bar_base + 1 * vf_bar_size;
```

### <strong>Linux VFIO 直通</strong>

```bash
# 绑定 VF 到 vfio-pci
echo "8086 1520" > /sys/bus/pci/drivers/vfio-pci/new_id
echo 0000:01:10.0 > /sys/bus/pci/devices/0000:01:10.0/driver/unbind
echo 0000:01:10.0 > /sys/bus/pci/drivers/vfio-pci/bind

# 启动 QEMU 直通
qemu-system-x86_64 -device vfio-pci,host=01:10.0 ...
```

---

## <strong>软硬件实战</strong>

### <strong>场景：嵌入式虚拟化</strong>

<span class="blue">车载域控制器中，SR-IOV 允许 GPU/网卡安全分配给多个域：</span>

```
Domain 0 (Linux)  ← PF
Domain 1 (RTOS)   ← VF 0
Domain 2 (Guest)  ← VF 1
```

---


```mermaid
graph LR
    A[虚拟化与SR-IOV核心] --> B[原理解析]
    B --> C[实战应用]
    C --> D[历史演进]
```

## <strong>历史演进</strong>

- <span class="green">2007 年 SR-IOV 规范</span> — PCI-SIG 发布，定义 PF/VF 模型<br>
- <span class="green">2012 年 Linux VFIO</span> — 内核引入安全的用户态设备访问<br>
- <span class="green">2020 年 Scalable IOV</span> — Intel 提出更细粒度虚拟化

---

## 小结与练习

| 要点 | 说明 |
|------|------|
| 核心概念 | SR-IOV 通过硬件虚拟化实现近原生性能的设备直通 |
| 关键技能 | 配置 PF/VF、VFIO 绑定、多域安全隔离 |

**练习**

1. 比较 SR-IOV 与 virtio 在延迟和 CPU 开销上的差异。
2. 分析为什么 VF 不能修改影响其他 VF 的全局配置。
3. 设计一个车载域控制器的 PCIe 虚拟化方案。
