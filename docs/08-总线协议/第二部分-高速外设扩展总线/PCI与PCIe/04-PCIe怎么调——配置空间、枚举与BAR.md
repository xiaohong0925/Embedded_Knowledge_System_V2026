# PCIe怎么调——配置空间、枚举与BAR

<span class="badge-b">[B]</span> <span class="badge-i">[I]</span> <span class="badge-e">[E]</span> <span class="badge-m">[M]</span>

PCIe 的配置空间是"软件可见硬件"的典范。
本章拆解 Type 0/Type 1 配置空间、DFS 枚举算法、BAR 分配机制，
以及 MSI/MSI-X 中断配置，让你能读懂 lspci -vvv 的每一行输出。

---

## 核心定义与价值

<span class="red">PCIe 配置空间</span> 是每个 PCIe 设备必须实现的 4KB（或更多）寄存器区域。
它包含设备的身份标识、能力列表、BAR 地址、中断配置等关键信息。

**配置空间的价值：**

- 枚举阶段：BIOS/UEFI/OS 通过配置空间发现所有设备
- 驱动加载：匹配 Vendor ID / Device ID 找到对应驱动
- 资源分配：分配 BAR 的内存/IO 地址窗口
- 中断配置：设置 MSI/MSI-X 的 Vector 数量和目标 CPU

---

### 类比：公司入职档案系统

PCIe 枚举像人力资源部给新员工建档：

- <span class="green">Type 0 配置头</span> = 基层员工的档案（Endpoint，具体干活的人）
- <span class="green">Type 1 配置头</span> = 部门经理的档案（Switch/Bridge，管人的）
- <span class="green">Vendor ID / Device ID</span> = 身份证号 + 工号（唯一标识）
- <span class="green">BAR</span> = 分配办公座位和储物柜（内存/IO 地址空间）
- <span class="green">Capability List</span> = 技能证书链表（MSI、MSI-X、PM、AER...）
- <span class="green">枚举算法</span> = HR 逐层走访每个部门，登记所有人

---

## 核心机制原理解析

### <strong>1. 配置空间：Type 0 vs Type 1 的精确字段映射</strong>

<br>

PCIe 配置空间前 64 byte 是标准头，剩余空间用于 Capability List 和 Extended Capability List。

**Type 0 Header（Endpoint）：**

| 偏移 | 字段 | 位宽 | 说明 |
|------|------|------|------|
| 0x00 | Vendor ID | 16 | 厂商 ID，如 Intel=0x8086, Realtek=0x10EC |
| 0x02 | Device ID | 16 | 设备 ID，厂商定义 |
| 0x04 | Command | 16 | 设备使能位：IO/Memory/Bus Master/Int Disable |
| 0x06 | Status | 16 | 设备状态：Cap List/66MHz/Parity Error |
| 0x08 | Revision ID | 8 | 硬件版本 |
| 0x09 | Class Code | 24 | 设备类别：Base/Sub/Programming Interface |
| 0x0C | Cache Line Size | 8 | 缓存行大小 |
| 0x0D | Latency Timer | 8 | 传统 PCI 延迟，PCIe 忽略 |
| 0x0E | Header Type | 8 | [7]=Multi-Function, [6:0]=00=Type0, 01=Type1 |
| 0x0F | BIST | 8 | 自检 |
| 0x10 | BAR0 | 32 | Base Address Register 0 |
| 0x14 | BAR1 | 32 | BAR1 |
| 0x18 | BAR2 | 32 | BAR2 |
| 0x1C | BAR3 | 32 | BAR3 |
| 0x20 | BAR4 | 32 | BAR4 |
| 0x24 | BAR5 | 32 | BAR5 |
| 0x28 | CardBus CIS Ptr | 32 | 仅 PC Card |
| 0x2C | Subsystem Vendor ID | 16 | 子系统厂商 |
| 0x2E | Subsystem ID | 16 | 子系统设备号 |
| 0x30 | Expansion ROM Base | 32 | 扩展 ROM 地址 |
| 0x34 | Capabilities Ptr | 8 | 指向 Capability List 首项 |
| 0x3C | Interrupt Line | 8 | 传统 IRQ 号（0-15），PCIe 通常填 0xFF |
| 0x3D | Interrupt Pin | 8 | INTA/B/C/D |

<br>

**Type 1 Header（Switch/Bridge）：**

| 偏移 | 字段 | 说明 |
|------|------|------|
| 0x00-0x0F | 同 Type 0 | Vendor/Command/Status/Class |
| 0x10-0x17 | BAR0/1 | 仅 Switch 自身使用（可选） |
| 0x18 | Primary Bus Number | 上游 Bus 号 |
| 0x19 | Secondary Bus Number | 本 Port 下游 Bus 号 |
| 0x1A | Subordinate Bus Number | 子树最大 Bus 号 |
| 0x1B | Secondary Latency Timer | 忽略 |
| 0x1C | IO Base / IO Limit | IO 端口窗口（低 12 bit 固定为 FFF/000） |
| 0x20 | Memory Base / Limit | 32-bit MMIO 窗口 |
| 0x24 | Prefetchable Base Low | 64-bit Prefetchable MMIO 低 32 bit |
| 0x28 | Prefetchable Limit Low | 64-bit Prefetchable MMIO 低 32 bit |
| 0x2C | Prefetchable Base High | 64-bit Prefetchable MMIO 高 32 bit |
| 0x30 | Prefetchable Limit High | 64-bit Prefetchable MMIO 高 32 bit |
| 0x34 | IO Base Upper / Limit Upper | IO 窗口高 16 bit |

<br>

<span class="blue">Class Code 的 3-byte 结构：[Base Class, Sub Class, Programming Interface]。
例如 NVMe SSD 的 Class Code = 0x010802（Mass Storage + Non-Volatile + NVMHCI）。
BIOS 和内核通过这个字段识别设备类型，不需要依赖 Vendor/Device ID。</span>

---

### <strong>2. 枚举算法：DFS 遍历与 Bus/Device/Function 分配</strong>

<br>

PCIe 枚举采用深度优先搜索（DFS）算法：

```mermaid
graph TD
    A[Bus 0, Root Complex] --
    B[Device 0, Root Port 0]
    B --
    C[Bus 1, Switch Upstream]
    C --
    D[Device 0, Downstream Port 0]
    D --
    E[Bus 2, Endpoint]
    C --
    F[Device 1, Downstream Port 1]
    F --
    G[Bus 3, Endpoint]
    A --
    H[Device 1, Root Port 1]
    H --
    I[Bus 4, Endpoint]
```

<br>

**枚举算法的伪代码：**

```c
/* Linux 内核 pci_scan_child_bus() 简化逻辑 */
int pci_scan_child_bus(struct pci_bus *bus)
{
    int devfn, fn, max;
    struct pci_dev *dev;

    max = bus->busn_res.start;

    for (devfn = 0; devfn < 0x100; devfn += 8) {
        /* 读取 Vendor ID */
        dev = pci_scan_single_device(bus, devfn);
        if (!dev)
            continue;

        /* 如果是 Multi-Function，扫描所有 Function */
        if (dev->multifunction) {
            for (fn = 1; fn < 8; fn++)
                pci_scan_single_device(bus, devfn + fn);
        }

        /* 如果是 Bridge/Switch，递归扫描下游 */
        if (dev->hdr_type == PCI_HEADER_TYPE_BRIDGE) {
            max = pci_scan_bridge(bus, dev, max);
        }
    }

    return max;
}
```

<br>

**枚举的精确步骤：**

| 步骤 | 操作 | 寄存器 |
|------|------|--------|
| 1 | 读取 Bus N, Device 0-31, Function 0 的 Vendor ID | 0x00 |
| 2 | Vendor ID != 0xFFFF → 设备存在 | — |
| 3 | 读取 Header Type | 0x0E |
| 4 | Header Type[7]=1 → 扫描 Function 1-7 | — |
| 5 | Header Type[6:0]=0x01 → 是 Bridge | — |
| 6 | 分配新 Bus 号 = 当前 max + 1 | Bridge 0x19 |
| 7 | 写入 Secondary Bus = 新 Bus 号 | Bridge 0x19 |
| 8 | 递归扫描新 Bus 号 | — |
| 9 | 返回后写入 Subordinate Bus = 子树最大 Bus | Bridge 0x1A |

<br>

<span class="blue">Bus 号分配是枚举的核心：Root Port 的 Secondary Bus 指向其直连设备，Subordinate Bus 指向其子树的最大 Bus 号。
这个机制确保了任意层级的 Switch 都可以通过 Bus 号范围路由 Configuration TLP。</span>

---

### <strong>3. BAR（Base Address Register）：地址窗口的分配艺术</strong>

<br>

BAR 是设备向系统请求内存或 IO 地址空间的机制。

**BAR 的位定义：**

```
Bit:  [31:4]      [3]      [2:1]     [0]
      Address    Prefetch  Type      IO/Mem
      [31:4]     able      (Mem)     (0=Mem, 1=IO)
```

<br>

| 位域 | 值 | 说明 |
|------|-----|------|
| [0] | 0 | Memory BAR |
| [0] | 1 | IO BAR（legacy，现代 PCIe 已不推荐） |
| [2:1] | 00 | 32-bit Memory BAR |
| [2:1] | 10 | 64-bit Memory BAR（占用两个连续 BAR 槽位） |
| [3] | 0/1 | Prefetchable（1=可预取，如 Frame Buffer） |
| [31:4] | 0x0000000 | 复位值，表示"未分配" |

<br>

**BAR 探测算法：**

```c
/* 内核 pci_read_bases() 简化逻辑 */
void pci_read_bases(struct pci_dev *dev, int howmany, int rom)
{
    u32 reg, l, sz, mask;

    for (reg = PCI_BASE_ADDRESS_0; reg < PCI_BASE_ADDRESS_0 + howmany * 4; reg += 4) {
        /* 1. 读取原始 BAR 值 */
        pci_read_config_dword(dev, reg, &l);

        /* 2. 写入全 1 */
        pci_write_config_dword(dev, reg, 0xffffffff);

        /* 3. 读回掩码 */
        pci_read_config_dword(dev, reg, &sz);

        /* 4. 恢复原始值 */
        pci_write_config_dword(dev, reg, l);

        /* 5. 计算大小 */
        if (sz & PCI_BASE_ADDRESS_SPACE_IO)
            mask = PCI_BASE_ADDRESS_IO_MASK;
        else
            mask = PCI_BASE_ADDRESS_MEM_MASK;

        sz &= mask;
        sz = ~sz + 1;   /* 取补码得到大小 */

        dev->resource[bar].start = l & mask;
        dev->resource[bar].end = (l & mask) + sz - 1;
    }
}
```

<br>

<span class="blue">BAR 探测的核心：写全 1 后读回，设备会返回"哪些位是可写的"。
可写位为 0 的位置表示该地址空间的大小对齐边界。
例如读回 0xFFFFF000，表示大小为 0x1000（4KB），且必须对齐到 4KB 边界。</span>

---

### <strong>4. MSI/MSI-X 中断：从共享到独享的飞跃</strong>

<br>

| 特性 | Legacy INTx | MSI | MSI-X |
|------|-------------|-----|-------|
| 引脚 | 4 根边带信号 | 无（TLP 内） | 无（TLP 内） |
| 中断数 | 4 个共享 | 1-32 个 | 1-2048 个 |
| 目标 CPU | 固定 | 可编程 | 可编程 |
| 触发方式 | 电平 | 边沿 | 边沿 |
| 延迟 | 高（需轮询） | 低 | 极低 |
| 虚拟化 | 不支持 | 部分支持 | SR-IOV 必需 |

<br>

**MSI 配置（Capability ID = 0x05）：**

| 偏移 | 字段 | 说明 |
|------|------|------|
| 0x00 | Capability ID | 0x05 |
| 0x01 | Next Pointer | 下一 Capability |
| 0x02 | Message Control | [10:0]=Vector 数-1, [7]=Enable, [0]=MSI64Cap |
| 0x04 | Message Address Low | 32-bit 目标地址 |
| 0x08 | Message Address High | 64-bit 时有效 |
| 0x0C | Message Data | 中断时写入的值 |
| 0x10 | Mask Bits | 按 Vector 屏蔽 |
| 0x14 | Pending Bits | 挂起状态 |

<br>

**MSI-X 配置（Capability ID = 0x11）：**

| 偏移 | 字段 | 说明 |
|------|------|------|
| 0x00 | Capability ID | 0x11 |
| 0x02 | Message Control | [10:0]=Table Size, [15]=Enable, [14]=Mask All |
| 0x04 | Table Offset/BIR | BAR 指示 + 表内偏移 |
| 0x08 | PBA Offset/BIR | Pending Bit Array 位置 |

<br>

<span class="blue">MSI-X 相比 MSI 的革命性改进：每个 Vector 的目标地址和数据独立可配置，且存储在设备内存（BAR）中而非配置空间。
这使得 MSI-X 可以支持多达 2048 个 Vector，且每个 Vector 可以路由到不同的 CPU 核心，实现中断 Affinity。</span>

---

## 技术教学与实战

### lspci -vvv 输出逐行解读

```bash
lspci -vv -s 01:00.0
01:00.0 Non-Volatile memory controller: Samsung Electronics Co Ltd NVMe SSD Controller
    Subsystem: Samsung Electronics Co Ltd NVMe SSD Controller
    Control: I/O- Mem+ BusMaster+ SpecCycle- MemWINV- VGASnoop- ...
    Status: Cap+ 66MHz- UDF- FastB2B- ParErr- DEVSEL=fast >TAbort- ...
    Latency: 0, Cache Line Size: 64 bytes
    Interrupt: pin A routed to IRQ 16
    Region 0: Memory at f0000000 (64-bit, non-prefetchable) [size=16K]
    Region 4: Memory at f0004000 (64-bit, prefetchable) [size=256K]
    Capabilities: [40] Power Management version 3
    Capabilities: [50] MSI: Enable- Count=1/32 Maskable- 64bit+
    Capabilities: [70] Express (v2) Endpoint, MSI 00
    Capabilities: [b0] MSI-X: Enable+ Count=33 Masked-
    Capabilities: [100] Advanced Error Reporting
```

<br>

解读：

| 字段 | 值 | 含义 |
|------|-----|------|
| Control Mem+ | 使能 | Memory 空间访问已使能 |
| Control BusMaster+ | 使能 | DMA 主控模式已使能 |
| Region 0 | f0000000, 64-bit, non-prefetchable | BAR0 = 4x4KB MMIO |
| Region 4 | f0004000, 64-bit, prefetchable | BAR2/3 = 256KB Prefetchable MMIO |
| MSI | Enable- | MSI 未使能 |
| MSI-X | Enable+, Count=33 | MSI-X 已使能，33 个 Vector |

<br>

```bash
# 读取 MSI-X Table（通过 sysfs）
xxd /sys/bus/pci/devices/0000:01:00.0/msi_irqs
# 输出每个 MSI-X Vector 映射的 Linux IRQ 号

# 查看中断亲和性
cat /proc/interrupts | grep nvme
  16:    12345    67890   PCI-MSI-X  nvme0q0, nvme0q1, ...

# 设置 IRQ Affinity
echo 2 > /proc/irq/16/smp_affinity
# 将 nvme0q0 绑定到 CPU 1
```

---

## 嵌入式专属实战场景

### 场景：i.MX8 PCIe 控制器枚举调试

i.MX8M Plus 集成 1 个 PCIe Gen3 控制器：

```c
/* arch/arm64/boot/dts/freescale/imx8mp.dtsi */
pcie: pcie@33800000 {
    compatible = "fsl,imx8mp-pcie";
    reg = <0x33800000 0x400000>,  /* PCIe 控制器寄存器 */
          <0x1ff00000 0x80000>;   /* 配置空间窗口 */
    reg-names = "dbi", "config";
    interrupts = <GIC_SPI 122 IRQ_TYPE_LEVEL_HIGH>;
    bus-range = <0x0 0xff>;
    #address-cells = <3>;
    #size-cells = <2>;
    /* ... */
};
```

<br>

常见枚举问题排查：

| 现象 | 根因 | 排查 |
|------|------|------|
| lspci 无输出 | REFCLK 未输出或频率错误 | 示波器测量 REFCLK 引脚 |
| lspci 显示 Unknown device | PERST# 时序不对 | 确保 PERST# 在 REFCLK 稳定后 100μs 才释放 |
| 枚举到一半卡住 | LTSSM 无法进入 L0 | 读取控制器寄存器确认状态 |
| BAR 分配冲突 | 地址空间规划错误 | 检查设备树 ranges 和 dma-ranges |

---

## 历史演进与前沿

### 配置空间的演进

| 版本 | 配置空间大小 | 关键新增 |
|------|-------------|---------|
| PCI 2.3 | 256 byte | 标准配置头 |
| PCI-X | 256 byte | Split Transaction |
| PCIe 1.0 | 4 KB | Extended Configuration (256B→4KB) |
| PCIe 2.0 | 4 KB | AER, SR-IOV |
| PCIe 3.0 | 4 KB | Multicast, Atomic Ops |
| PCIe 4.0 | 4 KB | 16GT/s 相关 Capability |
| PCIe 5.0 | 4 KB | 32GT/s, Lane Margining |
| PCIe 6.0 | 4 KB | FLIT, PAM4, FEC |

<br>

<span class="red">SR-IOV（Single Root I/O Virtualization）是数据中心的关键：</span>

- 一个物理设备虚拟出 256 个 VF（Virtual Function）
- 每个 VF 有独立的配置空间、BAR 和中断
- Hypervisor 可以直接将 VF 透传给虚拟机
- NVMe SSD 和网卡是 SR-IOV 的主要应用

---

## 本章小结

| 主题 | 关键要点 |
|------|---------|
| Type 0 | Endpoint：Vendor/Device/Class Code/BAR0-5/Cap Ptr |
| Type 1 | Bridge/Switch：Primary/Secondary/Subordinate Bus + 窗口寄存器 |
| 枚举 | DFS 深度优先：扫描 Bus→Device→Function，遇到 Bridge 递归 |
| BAR 探测 | 写 0xFFFFFFFF → 读回掩码 → 恢复 → 计算大小 |
| MSI | 1-32 Vector，配置空间内定义目标地址和数据 |
| MSI-X | 1-2048 Vector，Table 在 BAR 内存中，独立 Affinity |
| lspci | -v 看 Capability，-vv 看寄存器值，-vvv 看全部 |

---

## 练习

1. 枚举算法中，为什么 Secondary Bus Number 在递归扫描前写入，而 Subordinate Bus Number 在递归扫描后写入？
2. 某设备的 BAR0 读回值为 0xFFFF0000。这是 32-bit Memory BAR 还是 IO BAR？请求的空间大小是多少？对齐要求是多少？
3. MSI-X 的 Table 为什么存储在 BAR 内存中而不是配置空间中？这个设计选择带来了什么好处？
4. 某 NVMe SSD 的 MSI-X Count=33，但系统只有 16 个可用 IRQ。驱动应该如何处理？是报错还是降级？
5. 在嵌入式 ARM 平台上，PCIe 配置空间的访问通常通过 "config" 寄存器窗口实现。解释为什么需要这个窗口，而不是直接 MMIO 访问配置空间。
