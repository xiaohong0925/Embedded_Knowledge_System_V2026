# D.16 MFD 与复合设备

> 所属：扩展篇 D. 驱动开发实战 > Part 2 子系统框架线
>
> 难度：[M] | 预计阅读时间：40 分钟
>
> 与11.1.5的分工：11.1.5 以全志 AXP PMIC 为例走读 MFD 形态"长什么样、为什么存在"；本篇是写法级——一颗复合芯片到手，拆分原则、mfd_add_devices 注册、共享 regmap、中断级联的完整写法。

## <span class="blue"> 本节导读

PMIC 是嵌入式板子上最"拥挤"的芯片：一颗料里同时住着好几路 LDO/DCDC、一个 RTC、若干 GPIO、一颗 ADC、有时还有电量计和按键检测。它们共用同一片 I2C 寄存器空间、共用一根中断线。写一个巨型驱动全包是下策——内核的答案是 MFD（Multi-Function Device）：父驱动管总线和共享资源，每个功能拆成独立子驱动，各自注册到自己的子系统。<BR>
本节覆盖：MFD 判定表、父驱动骨架（mfd_cell 表 + mfd_add_devices）、子驱动写法（取共享 regmap 与虚拟中断）、regmap_irq 中断级联、syscon+simple-mfd 零代码路径、mfd-core 源码走读、级联中断验收。

---

## <span class="blue"> 判定：什么时候用 MFD [M]

| 芯片形态 | 组织方式 | 理由 |
|---|---|---|
| 单功能芯片 | 普通驱动，**别套 MFD** | 拆一个设备是纯粹的复杂度 |
| 多功能，共用一片寄存器空间 + 一根中断线 | **MFD** | 共享资源必须有属主，拆分必须有机制 |
| 多功能，但各功能挂在不同 I2C 地址（各自独立） | 多个独立驱动，DT 并列节点 | 没有共享资源就没有 MFD 的意义 |
| MMIO 复合设备，子功能都是 DT 节点 | **syscon + simple-mfd 零代码** | 见本篇末尾，一行驱动都不用写 |
| 多功能但几乎无共享（各玩各的寄存器） | 一个 probe 里注册多个框架 handle 也能活 | 共享中断/寄存器一旦出现就升级 MFD |

一句话判据：**共享资源（寄存器空间、中断线）需要仲裁和分发时，才需要 MFD**。PMIC、音频 codec 带检测、扩展 IO 芯片（GPIO+PWM+ADC 一体）是三大高发场景。

---

## <span class="blue"> 父驱动：管总线、建 regmap、级联中断、下子设备 [M]

以一颗虚拟 I2C PMIC（MYPWR01）为例：片内 2 路 LDO、1 个 RTC、4 通道 ADC、8 路 GPIO，寄存器 0x00-0x7F，一根开漏中断线汇总所有事件。

### 第一步：regmap 与中断级联

```c
#include <linux/mfd/core.h>
#include <linux/regmap.h>
#include <linux/interrupt.h>

struct mypwr_data {
    struct i2c_client *client;
    struct regmap *regmap;
    struct regmap_irq_chip_data *irq_data;
};

/* 中断级联：芯片内部 8 个中断源 → 8 个虚拟中断号 */
static const struct regmap_irq mypwr_irqs[] = {
    REGMAP_IRQ_REG(MYPWR_IRQ_OVP,     0, BIT(0)),   /* 过压 */
    REGMAP_IRQ_REG(MYPWR_IRQ_UVLO,    0, BIT(1)),   /* 欠压锁定 */
    REGMAP_IRQ_REG(MYPWR_IRQ_RTC_ALM, 0, BIT(2)),   /* RTC 闹钟 */
    REGMAP_IRQ_REG(MYPWR_IRQ_ADC_EOC, 0, BIT(3)),   /* ADC 转换完成 */
    /* ……其余略 */
};

static const struct regmap_irq_chip mypwr_irq_chip = {
    .name        = "mypwr",
    .irqs        = mypwr_irqs,
    .num_irqs    = ARRAY_SIZE(mypwr_irqs),
    .num_regs    = 1,
    .status_base = MYPWR_REG_INT_STAT,   /* RW1C 状态寄存器 */
    .mask_base   = MYPWR_REG_INT_MASK,
};

static const struct regmap_config mypwr_regmap_config = {
    .reg_bits = 8, .val_bits = 8,
    .max_register = 0x7f,
    .cache_type = REGCACHE_RBTREE,
};
```

`devm_regmap_add_irq_chip()` 做的是"中断级联"的全部脏活：注册一个链式 irq_chip，父中断（client->irq）触发时读 INT_STAT，按位分发到 8 个**虚拟中断号**——子设备拿到的就是普通 IRQ，完全不知道自己是二级中断。

### 第二步：mfd_cell 表与注册

```c
/* RTC 子设备的中断资源模板：virq 占位，probe 里在可变副本上回填 */
static const struct resource mypwr_rtc_resources[] = {
    DEFINE_RES_IRQ(0),
};

static const struct mfd_cell mypwr_cells[] = {
    [MYPWR_CELL_REGULATOR] = { .name = "mypwr-regulator", },
    [MYPWR_CELL_RTC] = {
        .name = "mypwr-rtc",
        /* 子设备的中断资源：虚拟中断号在注册时现查 */
        .resources = mypwr_rtc_resources,
        .num_resources = ARRAY_SIZE(mypwr_rtc_resources),
    },
    [MYPWR_CELL_ADC] = { .name = "mypwr-adc", },
    [MYPWR_CELL_GPIO] = { .name = "mypwr-gpio", },
};

static int mypwr_probe(struct i2c_client *client)
{
    struct mypwr_data *data;
    struct mfd_cell *cells;
    struct resource *rtc_res;
    int ret, rtc_virq;

    data = devm_kzalloc(&client->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;
    data->client = client;
    i2c_set_drvdata(client, data);

    data->regmap = devm_regmap_init_i2c(client, &mypwr_regmap_config);
    if (IS_ERR(data->regmap))
        return PTR_ERR(data->regmap);

    /* 中断级联必须在下子设备之前建好 */
    ret = devm_regmap_add_irq_chip(&client->dev, data->regmap,
                                   client->irq, IRQF_ONESHOT, 0,
                                   &mypwr_irq_chip, &data->irq_data);
    if (ret)
        return dev_err_probe(&client->dev, ret, "irq chip failed\n");

    /* RTC 子设备需要的虚拟中断号回填进 cell 资源。
     * 注意：mypwr_cells 是 static const 模板（位于只读段），直接强转写入
     * 会段错误，多实例还会互踩——必须在 devm 可变副本上回填 */
    cells = devm_kmemdup(&client->dev, mypwr_cells, sizeof(mypwr_cells),
                         GFP_KERNEL);
    rtc_res = devm_kmemdup(&client->dev, mypwr_rtc_resources,
                           sizeof(mypwr_rtc_resources), GFP_KERNEL);
    if (!cells || !rtc_res)
        return -ENOMEM;

    rtc_virq = regmap_irq_get_virq(data->irq_data, MYPWR_IRQ_RTC_ALM);
    if (rtc_virq < 0)
        return rtc_virq;
    rtc_res->start = rtc_res->end = rtc_virq;
    cells[MYPWR_CELL_RTC].resources = rtc_res;

    /* 一行生下全部子设备 */
    return devm_mfd_add_devices(&client->dev, PLATFORM_DEVID_AUTO,
                                cells, ARRAY_SIZE(mypwr_cells),
                                NULL, 0, NULL);
}
```

源码走读：`devm_mfd_add_devices()` → `mfd_add_devices()`（`drivers/mfd/mfd-core.c`）对每个 cell 调 `mfd_add_device()`：分配一个 platform_device → 把 **parent 指向你的 i2c 设备**（这是子设备能找到共享 regmap 的关键）→ 拷贝 cell 的 resources → `platform_device_add()` 注册到 platform 总线。之后 platform 总线按 `cell.name` 匹配各子驱动的 `platform_driver.driver.name`——**MFD 子设备本质就是 platform 设备**，匹配、probe、defer 语义全部沿用 11.1.1 的那套。

---

## <span class="blue"> 子驱动：取共享资源的两行关键代码 [M]

子驱动是普通 platform_driver，唯二的 MFD 特征是共享资源的取法：

```c
static int mypwr_rtc_probe(struct platform_device *pdev)
{
    struct mypwr_rtc *rtc;
    int irq;

    /* 1. 共享 regmap：从 parent 拿，不是自己 init */
    rtc->regmap = dev_get_regmap(pdev->dev.parent, NULL);
    if (!rtc->regmap)
        return -ENODEV;

    /* 2. 虚拟中断：platform_get_irq 拿到父驱动回填的 virq */
    irq = platform_get_irq(pdev, 0);
    if (irq < 0)
        return irq;
    ret = devm_request_threaded_irq(&pdev->dev, irq, NULL,
                                    mypwr_rtc_irq_handler,
                                    IRQF_ONESHOT, "mypwr-rtc", rtc);
    /* ……之后走 D.14 的 RTC 注册流程，ops 里用共享 regmap 读写 */
}
```

共享安全的来源：所有子设备操作的是**同一个 regmap 实例**，regmap 内部持锁（D.15 的 update_bits 红利在复合芯片上才真正兑现——RTC 子驱动清中断位时不会撕裂 regulator 子驱动正在写的相邻位）。这也是"子驱动绝不自己 regmap_init"的原因：各建各的 regmap 等于各建各的锁，共享总线互踩。

整体结构图：

```
I2C 总线
  └── 父驱动 mypwr（i2c_driver）
        ├── regmap（共享，内部分布式锁）
        ├── regmap_irq_chip（父 IRQ ──级联──> 8 个虚拟 IRQ）
        └── mfd_add_devices()
              ├── mypwr-regulator → regulator 框架 → /sys/class/regulator
              ├── mypwr-rtc      → RTC 框架      → /dev/rtc1
              ├── mypwr-adc      → IIO 框架      → /sys/bus/iio
              └── mypwr-gpio     → gpiochip      → /sys/class/gpio
```

---

## <span class="blue"> 零代码路径：syscon + simple-mfd [I→E]

MMIO 复合设备（子功能都是 DT 节点、无共享中断分发需求）有一行驱动都不用写的路径：

```dts
syscon_mfd: system-controller@1c00000 {
    compatible = "vendor,soc-sysctrl", "syscon", "simple-mfd";
    reg = <0x1c00000 0x1000>;

    /* 子节点由 simple-mfd 自动 populate 成 platform 设备 */
    reboot: reboot@10 { compatible = "vendor,soc-reboot"; };
};
```

三个 compatible 的分工：`syscon` 让该区域成为共享 regmap 提供者（其他驱动 `syscon_regmap_lookup_by_phandle` 取用）；`simple-mfd` 让 device core 把子节点自动注册为 platform 设备。SoC 系统控制器、时钟复位混合区块大量用这个组合。**I2C 复合芯片用不了 simple-mfd**（子设备不在 DT 里、需要中断级联），才需要本篇的完整写法。

---

## <span class="blue"> 调试与验收 [I]

```bash
ls /sys/bus/platform/devices/ | grep mypwr   # 四个子设备应全部在册
cat /proc/interrupts | grep mypwr            # 父 IRQ + 已 request 的虚拟 IRQ
ls /sys/kernel/debug/regmap/                 # 只应有父设备一个 regmap 目录
cat /sys/bus/iio/devices/iio:device*/name    # ADC 子设备进 IIO 框架确认
```

验收检查点：子设备数量与 cell 表一致；`/proc/interrupts` 里父中断计数增长时虚拟中断同步增长（级联生效）；regmap debugfs 只有一个实例（子驱动没自建）；卸父驱动时四个子设备全部消失（devm 回收链正确）。

无硬件后备：复合芯片难找，改练结构——把 D.15 的 regmap 练习扩成两个"子驱动"（一个 misc 读 CHIP_ID、一个 misc 写 CTRL），父驱动只建 regmap + mfd_add_devices，在无硬件板子上跑通注册/匹配/共享 regmap 全链路。

---

## <span class="blue"> Trade-off 表格 [M]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 复合芯片组织 | 巨型驱动全包 | MFD 拆分 | 全包违被子系统边界、无法复用框架；拆分有结构成本但每个子设备都是标准公民 |
| 子设备来源 | mfd_cell 静态表 | DT 子节点 + of_platform_populate | I2C 芯片功能固定用 cell 表；MMIO 可配置用 DT |
| 中断分发 | 父驱动手动解析转发 | regmap_irq_chip 级联 | 手写级联要管 mask/ack/handle 细节；regmap_irq 一行接管 |
| 子驱动资源 | 各建各的 regmap | parent 共享 regmap | 各建各的锁等于没锁；共享实例才有互斥 |
| MMIO 复合 | 写 MFD 父驱动 | syscon + simple-mfd | 无中断级联需求时零代码优先 |

---

## <span class="blue"> 常见陷阱 [M]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 子驱动自建 regmap | 寄存器被写撕裂、缓存互相脏 | 每个 i2c_client 一个 regmap 各自持锁 | dev_get_regmap(parent) 共享实例 |
| 级联顺序错 | 子设备 request_irq 拿到 -EINVAL | mfd_add_devices 先于 irq_chip 建立 | 级联永远在生下子设备之前 |
| cell 名与驱动名不匹配 | 子驱动 probe 不触发 | platform 按名匹配，拼写不一致静默失败 | 核对 driver.name 与 cell.name 逐字符一致 |
| 虚拟中断当硬件中断 | 在子驱动里 gpio_to_irq / of_irq_get | 子设备中断来自父驱动回填的 resource | platform_get_irq 走资源 |
| 父驱动先卸子设备还在 | 卸载后子设备访问空 regmap 崩溃 | 非 devm 版注册，remove 顺序失控 | devm_mfd_add_devices + devm_regmap_add_irq_chip 全套 |
| 强转改写 const cell 表 | 运行时立刻段错误 | static const 模板在只读段，强转去 const 是未定义行为 | devm_kmemdup 出可变副本再回填 |
| 单功能硬套 MFD | 一个 cell 的 MFD | 为拆而拆 | 单功能老实写普通驱动 |

---

## <span class="blue"> 动手练习

1. 走读一颗真实 PMIC 驱动（推荐 `drivers/mfd/axp20x.c`，11.1.5 的同款）：列出它的 cell 表、irq_chip 定义，画出与本篇结构图对应的关系。
2. 无硬件版全链路：写一对父子驱动（父：虚拟 i2c 设备 + regmap + 两个 cell；子：两个 misc 驱动共享 regmap），insmod 后验证 `/sys/bus/platform/devices`、regmap debugfs 单实例、父子卸载顺序。
3. 给练习 2 加 regmap_irq 级联：定义 4 个虚拟中断源，父驱动用 GPIO 模拟中断脚，子驱动 request 各自 virq，触发后看 `/proc/interrupts` 两级计数。
4. 找一个 syscon+simple-mfd 的实际 DT 用例（`grep -r "simple-mfd" arch/arm/boot/dts/`），说明它省掉了哪段驱动代码。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| 判定 | 共享寄存器空间/中断线才需要 MFD | 这颗芯片真的有共享资源吗 |
| 父驱动 | 管总线、建 regmap、级联中断、下 cell 表 | 级联在 mfd_add_devices 之前吗 |
| 子驱动 | 普通 platform_driver + dev_get_regmap(parent) | 有没有自建 regmap |
| 级联 | regmap_irq_chip 一行接管二级中断 | 子驱动在碰硬件中断号吗 |
| 零代码 | syscon + simple-mfd 覆盖 MMIO 复合 | 能零代码就别写 |
| 卸载 | devm 全套保证父先子后 | remove 顺序测过吗 |

---

## <span class="blue"> 下一步

框架内的写法到此完整。下一篇（D.17 用户态驱动）处理框架外的另一条合法路线：UIO/VFIO/spidev/i2c-dev——硬件没定型、FPGA 原型期、快速验证时，把驱动写进用户态反而是对的。给清楚内核态与用户态的决策边界。

螺旋衔接：MFD——11.1.5 AXP 走读（认知级）→ 本篇（框架级）→ 第22章复杂设备的架构选型（设计级）。★第2次出现（框架级）
