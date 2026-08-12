# D.17 用户态驱动：UIO/VFIO/spidev/i2c-dev

> 所属：扩展篇 D. 驱动开发实战 > Part 2 子系统框架线
>
> 难度：[I→E] | 预计阅读时间：35 分钟
>
> 与11.1.6的分工：11.1.6 讲用户态驱动的机制原理（mmap 怎么把寄存器映射进进程地址空间、中断怎么变成文件事件）；本篇是写法与决策级——四条用户态路线各怎么写、内核态与用户态的分界线画在哪。

## <span class="blue"> 本节导读

不是所有硬件访问都需要一个内核驱动。FPGA 原型期寄存器天天改、产测工具临时读个状态、评估板上快速验证一颗新料——这些场景写内核驱动是拿牛刀杀鸡，还背上维护负担。内核早就开了四条"合法的后门"：i2c-dev/spidev 把总线事务搬进用户态，UIO 把 MMIO 寄存器和中断搬进用户态，VFIO 连 DMA 都搬进用户态。<BR>
本节覆盖：四条路线的判定表、i2c-dev/spidev 最小用法、UIO 完整骨架（内核侧 20 行 + 用户侧 mmap/poll）、VFIO 的适用边界、内核态 vs 用户态决策树、无硬件演练路径。

---

## <span class="blue"> 四条路判定 [I]

| 硬件形态 | 路线 | 用户态拿到什么 |
|---|---|---|
| I2C/SPI 设备，无内核驱动或刻意不用 | **i2c-dev / spidev 零代码** | 总线事务（read/write/ioctl 直发） |
| MMIO 设备（FPGA 逻辑、自定义 IP），要寄存器 + 中断 | **UIO**（内核侧 20 行壳） | `/dev/uioN`：mmap 寄存器、read/poll 收中断 |
| MMIO 设备，还要 DMA + 完整隔离 | **VFIO** | 整个设备（寄存器、中断、DMA、IOMMU 隔离） |
| 上述任何一条都满足不了（要进框架、要被其他内核模块用、要硬实时） | 回内核写驱动 | —— |

判定红线（任一命中就该回内核态）：

- 硬件要被**多个进程同时用**（用户态没有互斥与仲裁机制）
- 要被**其他内核子系统消费**（网卡进协议栈、块设备进 VFS，用户态给不了）
- 中断延迟有**硬实时要求**（用户态调度抖动不可控）
- 产品量产要**长期维护**（用户态驱动没有 ABI 约束，内核升级没人替你兜底）

反过来说：**硬件没定型、访问者单一、验证周期短**——用户态路线全中。FPGA 原型期是最典型的正例。

---

## <span class="blue"> i2c-dev / spidev：零内核代码 [I]

11.1.6 已给 i2c-dev 的最小例，这里补齐工程用法。i2c-dev 为每条已注册的 I2C 适配器自动生成 `/dev/i2c-N`（无需 DT 声明，适配器就绪即可用；spidev 才需要在 DT 里绑节点），用户态打开总线节点后按地址访问从机：

```c
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <sys/ioctl.h>

int fd = open("/dev/i2c-1", O_RDWR);
ioctl(fd, I2C_SLAVE, 0x50);              /* 锁定从机地址 */

/* 等价于 smbus 读字节 */
__s32 v = i2c_smbus_read_byte_data(fd, 0x00);   /* TS502 CHIP_ID */

/* 组合事务（重复起始位，atomic 的两段式） */
struct i2c_msg msgs[2] = {
    { .addr = 0x50, .flags = 0,        .len = 1, .buf = &reg },
    { .addr = 0x50, .flags = I2C_M_RD, .len = 2, .buf = data },
};
struct i2c_rdwr_ioctl_data xfr = { .msgs = msgs, .nmsgs = 2 };
ioctl(fd, I2C_RDWR, &xfr);               /* 某些"先写寄存器地址再读"的怪芯片必须走这条 */
```

spidev 同构：`/dev/spidevB.C` + `SPI_IOC_MESSAGE` ioctl 传全双工事务，片选、模式、速率都可逐次指定。

> 💡 注意身份：这两条路的本质是**内核驱动照常存在**（i2c 总线驱动、spi 控制器驱动一个不少），只是设备这一层不进内核。所以它们完全没有"绕过内核"的性能优势——每次事务照样走系统调用，慢且抖，换来的是零内核代码。

---

## <span class="blue"> UIO：寄存器 + 中断的用户态最小闭环 [I→E]

MMIO 设备（FPGA 逻辑最常见）用 UIO。内核侧只要一个"壳"驱动——不解析任何寄存器语义，只做三件事：声明寄存器窗口、声明中断、注册 uio_device：

```c
#include <linux/uio_driver.h>
#include <linux/platform_device.h>

static irqreturn_t myfpga_irq(int irq, struct uio_info *info)
{
    /* 关中断或清中断源，防止用户态没来得及处理时中断风暴 */
    writel(0x1, info->mem[0].internal_addr + 0x0C);   /* 清 INT_STAT */
    return IRQ_HANDLED;
}

static int myfpga_probe(struct platform_device *pdev)
{
    struct uio_info *info;
    struct resource *res;

    info = devm_kzalloc(&pdev->dev, sizeof(*info), GFP_KERNEL);
    if (!info)
        return -ENOMEM;

    res = platform_get_resource(pdev, IORESOURCE_MEM, 0);
    info->mem[0].name = "myfpga_regs";
    info->mem[0].addr = res->start;
    info->mem[0].size = resource_size(res);
    info->mem[0].memtype = UIO_MEM_PHYS;
    info->mem[0].internal_addr = devm_ioremap_resource(&pdev->dev, res); /* 仅内核侧清中断用 */

    info->name = "myfpga";
    info->version = "1.0";
    info->irq = platform_get_irq(pdev, 0);
    info->irq_flags = IRQF_TRIGGER_RISING;
    info->handler = myfpga_irq;

    return devm_uio_register_device(&pdev->dev, info);
}
```

用户态侧（C 或 Python 均可）：

```c
int fd = open("/dev/uio0", O_RDWR | O_SYNC);
void *regs = mmap(NULL, 0x1000, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
volatile uint32_t *reg = regs;

reg[0x00/4] = 0x1;              /* 写 CTRL 使能 */
while (1) {
    uint32_t irq_count;
    read(fd, &irq_count, 4);    /* 阻塞等中断；返回累计中断次数 */
    process(reg[0x04/4]);       /* 处理数据 */
    reg[0x08/4] = 0x1;          /* 重新使能中断（若内核侧关了） */
}
```

UIO 的语义契约就两条，写对即全对：

1. **read/poll 收中断**：每次中断计数加一，`read` 读出 4 字节累计值；`poll`/`epoll` 可接入业务事件循环（D.3 的等待模型在用户态的原样复刻）。
2. **内核 handler 只负责"按住"中断**：真正的中断处理逻辑全在用户态。handler 必须清中断源或关中断，否则电平触发的中断会卡死系统。

> 💡 更零代码的形态：设备简单到中断都不要时，DT 里 `compatible = "generic-uio";`（内核开 CONFIG_UIO_PDRV_GENIRQ）连壳驱动都省了——UIO 通用驱动直接接管 DT 节点的 reg 和 interrupts。

---

## <span class="blue"> VFIO：当 UIO 不够用 [E]

UIO 的两个天花板：DMA 没有隔离（用户态指个物理地址就能让设备 DMA 到内存任意处，等于 root 提权放大器），多进程隔离无从谈起。VFIO 用 IOMMU 补上这块：设备被 IOMMU 隔离到一个独立地址空间，用户态（典型是 QEMU 虚机或 DPDK 程序）拿到寄存器、中断、DMA 全部三件，且 DMA 只能落在 IOMMU 授权的页上。

嵌入式场景的适用面其实很窄：**SoC 挂 IOMMU（SMMU）且设备在 IOMMU 之后**、要用 DPDK 收发包、或要把 FPGA 加速卡直通给虚机。没有 IOMMU 的老 SoC 用不了 VFIO——这也是 UIO 在嵌入式依然主流、VFIO 在服务器/虚拟化主流的原因。本篇给边界，不展开写法；DPDK/虚机直通属于平台专题。

---

## <span class="blue"> 决策树与案例 [I→E]

```
硬件要进内核框架/被内核消费？──是──> 内核驱动（Part 1/Part 2 各篇）
        │否
多进程并发访问或长期量产维护？──是──> 内核驱动
        │否
要 DMA 且要隔离？──是──> VFIO（需 IOMMU）
        │否
MMIO 设备？──是──> UIO（要中断）/ generic-uio（不要中断）
        │否（I2C/SPI）
        └──> i2c-dev / spidev
```

典型案例——FPGA 采集卡原型期：硬件组每周改寄存器定义，算法组要用 Python 快速验证采集逻辑。UIO + generic-uio 壳（DT 改 reg 地址即可跟随 FPGA 重新布线），Python 直接 mmap 读写 + poll 收中断，寄存器改了改 Python 常量，零内核编译。三个月后寄存器冻结、数据通路上量、要给多个业务进程用——**这正是回内核态的信号**：按 Part 1 写 cdev 驱动，用户态验证期积累的寄存器手册和时序笔记直接变成驱动的输入。用户态驱动不是终点，是内核驱动的原型场。

---

## <span class="blue"> 调试与验收 [I]

```bash
ls /sys/class/uio/                          # UIO 设备在册确认
cat /sys/class/uio/uio0/maps/map0/addr      # 寄存器窗口地址与 DT 比对
cat /sys/class/uio/uio0/maps/map0/size
cat /proc/interrupts | grep uio             # 中断计数随业务增长
i2cdetect -y -r 1                           # i2c-dev 路线：扫总线确认从机应答
```

验收检查点：mmap 的窗口与 DT reg 一致；中断 read 返回的计数值单调递增；清中断后不再误触发；i2c-dev 的 I2C_RDWR 事务用示波器/逻辑分析仪确认重复起始位时序。

无硬件后备：UIO 有 `uio_pdrv_genirq` 通用驱动，DT 编一个假 reg 地址（指向保留内存）即可注册出 `/dev/uio0`，mmap/poll 流程完整演练；i2c-dev 路线任何带 I2C 设备的板子都能跑 i2cdetect 与 smbus 读写。

---

## <span class="blue"> Trade-off 表格 [I→E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 原型期硬件 | 内核驱动一步到位 | UIO/总线 dev 先验证 | 寄存器没冻结时内核驱动每周重编；用户态跟改零成本 |
| I2C/SPI 访问 | i2c-dev/spidev 用户态 | 内核驱动 | 单次事务开销大一个量级；零维护负担 |
| MMIO 中断 | UIO | 内核驱动 + poll（D.3） | UIO 中断延迟多一次调度；内核态可控 |
| DMA 需求 | UIO + 物理地址硬指 | VFIO | UIO 无隔离等于安全洞；VFIO 要 IOMMU |
| 生命周期 | 用完即弃的验证代码 | 量产维护 | 用户态驱动无 ABI 保护，量产必须回内核 |

---

## <span class="blue"> 常见陷阱 [I→E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| UIO handler 不清中断 | 系统卡死、中断计数爆涨 | 电平中断源未按住 | handler 里清 INT_STAT 或 mask |
| mmap 后当普通内存读 | 读到全 0xff 或总线错误 | 寄存器地址算错/窗口越界 | 比对 /sys/class/uio/*/maps 与手册 |
| 用户态缓存一致性问题 | DMA 数据读出来是旧的 | UIO 下自管 DMA 没做 cache 同步 | UIO 别碰 DMA，要 DMA 上 VFIO 或回内核 |
| i2c-dev 并发冲突 | 两个进程读到对方的数据 | 总线设备无用户态互斥 | 单进程独占或文件锁 |
| 量产产品用 UIO 出货 | 内核升级后 mmap 行为变化无人兜底 | 把原型手段当产品方案 | 寄存器冻结即回内核态 |
| generic-uio 乱配 | 任意物理地址被映射进用户态 | compatible 滥用把系统控制寄存器暴露了 | generic-uio 只给确属用户态的 IP 用 |

---

## <span class="blue"> 动手练习

1. i2c-dev：用 i2cdetect 扫出板上一颗 I2C 设备，写 Python（smbus2 库）或 C 程序读它的 ID 寄存器，与内核驱动读到的值比对。
2. UIO 演练：DT 加一个 generic-uio 假节点（reg 指向保留内存），确认 `/dev/uio0` 出现；写 mmap 读写程序验证窗口内容。
3. 中断闭环：若有 GPIO 可当中断源，给练习 2 加 interrupts 属性，用 poll 收按键中断，统计 read 返回的计数值。
4. 决策演练：把你做过的三个外设按本篇决策树走一遍，写出每个的分类与理由——重点标出"当初用了内核态但其实该用用户态"或反例。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| 判定红线 | 框架消费/多进程/硬实时/量产 → 内核态 | 四条红线逐条过了吗 |
| i2c-dev/spidev | 总线事务搬进用户态，零内核代码 | 接受系统调用开销吗 |
| UIO | mmap 寄存器 + read/poll 中断，内核壳 20 行 | handler 清中断源了吗 |
| generic-uio | 无中断需求时连壳都省 | 别把系统寄存器暴露了 |
| VFIO | UIO + IOMMU 隔离 + DMA，窄适用 | SoC 有 SMMU 吗 |
| 生命周期 | 用户态是原型场，不是终点 | 寄存器冻结后回内核了吗 |

---

## <span class="blue"> 下一步

写法篇全部收工。下一篇（D.18 子系统选型速查与全扩展知识图谱）收官：一张"设备 → 子系统"映射速查表、一份"不进 Part 2 的大件框架归属表"（写清不教什么同样是设计决策）、TS502 三形态对照总表，以及全扩展知识点关联图与自测题。

螺旋衔接：用户态驱动——11.1.6 机制原理（认知级）→ 本篇四路线决策（框架级）→ 第22章架构选型（设计级）。★第2次出现（框架级）
