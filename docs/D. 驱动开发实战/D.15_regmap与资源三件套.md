# D.15 regmap 与资源三件套：pinctrl/clk/regulator

> 所属：扩展篇 D. 驱动开发实战 > Part 2 子系统框架线
>
> 难度：[E] | 预计阅读时间：40 分钟
>
> 与11.3.3的分工：11.3.3 讲 probe 里"取时钟/电源并使能"的机制定位与产品差异（哪些产品软件要管、哪些不用）；本篇是写法级——这三组 API 的具体调用细节、顺序、错误处理，以及寄存器访问的统一抽象 regmap（Part 1 TS502 用的裸 i2c_smbus 调用，本篇升级为 regmap 版，与 D.11 IIO 版凑成三形态对照）。

## <span class="blue"> 本节导读

打开任何一个内核驱动，probe 里最高频的不是寄存器读写，而是四行资源代码：取时钟、取电源、选引脚、使能。加上满屏的 `i2c_smbus_read_byte_data`，这五样东西占了业务无关代码的一大半。它们都有标准写法，写对了驱动就"像内核驱动"，写错了全是隐蔽问题。<BR>
本节覆盖：regmap 与裸总线调用的判定表、TS502 的 regmap 化改写（regmap_config、cache 模式、volatile 声明）、`regmap_update_bits` 的原子位操作红利、clk/regulator/pinctrl 消费者写法与 -EPROBE_DEFER 语义、什么时候你要成为提供者、regmap debugfs 验收。

---

## <span class="blue"> regmap：先判定，再升级 [I→E]

Part 1 的 TS502 直接用 `i2c_smbus_read_byte_data(client, reg)` 访问寄存器。能不能继续这么写？判定表：

| 场景 | 选择 | 理由 |
|---|---|---|
| 寄存器 ≤5 个、只初始化时碰一次 | 裸 i2c_smbus / spi_write | 引入 regmap 的收益为零 |
| 寄存器多、运行期频繁读写、有读-改-写 | **regmap** | 统一接口、原子位操作、免费 debugfs dump |
| 需要寄存器缓存（suspend 后恢复全场） | **regmap** | cache + `regcache_sync` 一行解决 |
| SPI / MMIO 设备，同一芯片多总线版本 | **regmap** | 换总线只换 init 函数，访问代码零改动 |
| MMIO 寄存器、无缓存需求、极致时序 | 直接 readl/writel | 寄存器语义特殊（如 RW1C 大批量）时抽象是负担 |

regmap 的四个实际红利：**统一**（I2C/SPI/MMIO 一套 API）、**原子位操作**（`regmap_update_bits` 内部持锁的读-改-写）、**缓存**（掉电保存/恢复）、**调试**（debugfs 免费 dump 全部寄存器）。TS502 有 9 个寄存器、有读-改-写（CTRL）、suspend 后要恢复配置——全中，升级。

分层关系——regmap 是夹在驱动与总线之间的吸收层：

```
你的驱动                          regmap 核心（drivers/base/regmap/regmap.c）
──────────────            ──────────────────────────────────
regmap_read/write  ──►    volatile? ──是──► 直穿硬件
regmap_update_bits        volatile? ──否──► 查缓存（RBTREE），miss 才走总线
                          max_register 越界拦截
                          update_bits 内部持锁的读-改-写
                          debugfs 免费 dump（/sys/kernel/debug/regmap/）
                                    │
                                    ▼  init 时挂接的总线回调
                          I2C: smbus 块传输 / SPI: write_then_read / MMIO: readl
```

### TS502 的 regmap 化

```c
#include <linux/regmap.h>

/* 声明哪些寄存器"缓存不可信"：FIFO 读弹出、状态实时变化、RW1C 自清 */
static bool ts502_volatile_reg(struct device *dev, unsigned int reg)
{
    switch (reg) {
    case TS502_REG_FIFO_DATA:   /* 0x03 读弹出，缓存无意义 */
    case TS502_REG_FIFO_STAT:   /* 0x04 深度实时变化 */
    case TS502_REG_INT_STAT:    /* 0x06 RW1C，硬件自清 */
        return true;
    default:
        return false;
    }
}

static const struct regmap_config ts502_regmap_config = {
    .reg_bits     = 8,
    .val_bits     = 8,
    .max_register = TS502_REG_PWM_ALARM,     /* 0x08，越界访问直接报错 */
    .volatile_reg = ts502_volatile_reg,
    .cache_type   = REGCACHE_RBTREE,
};

static int ts502_probe(struct i2c_client *client)
{
    struct ts502_data *data;
    unsigned int chip_id;
    int ret;

    data = devm_kzalloc(&client->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;

    /* 一行替换 i2c_client 角色：之后的访问不再碰 client */
    data->regmap = devm_regmap_init_i2c(client, &ts502_regmap_config);
    if (IS_ERR(data->regmap))
        return PTR_ERR(data->regmap);

    msleep(5);                          /* 手册：上电 5ms 内禁通信 */

    ret = regmap_read(data->regmap, TS502_REG_CHIP_ID, &chip_id);
    if (ret)
        return dev_err_probe(&client->dev, ret, "regmap read failed\n");
    if (chip_id != 0x50)
        return dev_err_probe(&client->dev, -ENODEV,
                             "bad chip id 0x%02x\n", chip_id);
    /* ……后续中断、FIFO、sysfs 代码与 Part 1 相同，仅访问函数换名 */
    return 0;
}
```

访问函数对照——Part 1 的写法逐个平移：

| Part 1（裸 smbus） | regmap 版 | 说明 |
|---|---|---|
| `i2c_smbus_read_byte_data(client, REG)` | `regmap_read(regmap, REG, &val)` | 返回值从"数据或负数"改为纯错误码 |
| `i2c_smbus_write_byte_data(client, REG, v)` | `regmap_write(regmap, REG, v)` | 有缓存时命中缓存，未必真写硬件 |
| 读 CTRL → 改位 → 写回（三步） | `regmap_update_bits(regmap, CTRL, mask, val)` | **内部持锁**，中断上下文与读写路径并发时不再撕裂 |
| 手动 dump 9 个寄存器调 bug | debugfs 一行 cat | 见验收节 |

三个配置项的决策依据：

- **volatile 声明**：FIFO_DATA 读一次弹一次、FIFO_STAT 深度在变、INT_STAT 硬件自清——这三类若被缓存，读到的就是脏数据。volatile 寄存器**永远穿透缓存直读硬件**。
- **cache 模式**：寄存器数量少且连续，RBTREE 是通用默认；寄存器成块分布用 MAPLE；只有几个寄存器用 FLAT；完全不要缓存用 NONE。TS502 要 suspend 恢复，选 RBTREE。
- **RW1C 没有自动支持**：regmap 不知道"写 1 清零"语义，清中断仍是显式 `regmap_write(regmap, TS502_REG_INT_STAT, mask)`——别指望 `regmap_update_bits` 替你想清楚。

源码走读：`devm_regmap_init_i2c()` → `__regmap_init_i2c()` → `regmap_init()`（`drivers/base/regmap/regmap.c`）：按 config 分配 regmap 结构 → 挂接 i2c 总线的 `reg_read/reg_write` 回调（默认用 smbus 块传输，不可用时退化成字节传输）→ 按 cache_type 初始化缓存树。之后 `regmap_read` 的完整路径是：查 volatile → 命中缓存直接返回 / 否则走总线回调 → 更新缓存。**总线差异在 init 时被一次性吸收**，这就是"换总线零改动"的原理。

---

## <span class="blue"> 资源三件套：消费者写法 [E]

11.3.3 已定位"为什么 probe 里要这几步"，本篇给完整写法。以 TS502 接上独立时钟源与可调 LDO 为例：

```c
static int ts502_probe(struct i2c_client *client)
{
    struct ts502_data *data;
    int ret;

    /* 1. 电源：先电后钟，硬件手册的上电时序 */
    data->vdd = devm_regulator_get(&client->dev, "vdd");
    if (IS_ERR(data->vdd))
        return dev_err_probe(&client->dev, PTR_ERR(data->vdd),
                             "get vdd failed\n");
    ret = regulator_enable(data->vdd);
    if (ret)
        return ret;
    msleep(5);                          /* 手册：上电 5ms 内禁通信 */

    /* 2. 时钟 */
    data->clk = devm_clk_get(&client->dev, NULL);
    if (IS_ERR(data->clk)) {
        ret = PTR_ERR(data->clk);
        goto err_regulator;             /* 反向撤销，devm 只管 get 不管时序 */
    }
    ret = clk_prepare_enable(data->clk);
    if (ret)
        goto err_regulator;

    /* 3. 引脚：99% 的驱动什么都不用写——device core 在 probe 前已自动
     *    选择 DT 里的 pinctrl-0（default 状态）。只有需要运行时切状态
     *    （如休眠切 sleep 态省电）才显式调用：                         */
    data->pins_sleep = pinctrl_lookup_state(
        devm_pinctrl_get(&client->dev), "sleep");
    /* ……suspend 时 pinctrl_select_state() 切换 */

    /* 4. 资源齐了才碰寄存器 */
    ret = regmap_read(data->regmap, TS502_REG_CHIP_ID, &chip_id);
    /* …… */
    return 0;

err_regulator:
    regulator_disable(data->vdd);       /* 使能是运行时操作，devm 不代管 */
    return ret;
}
```

四条铁律：

1. **顺序即手册**：电 → 钟 → 复位释放 → 通信，顺序按芯片手册的上电时序，错了就是偶发不识别。
2. **错误路径反向撤销**：`devm_` 只保证 probe 失败/设备移除时释放引用，**enable 这类运行时动作要自己反向关**。资源多时用 `devm_add_action_or_reset` 或挂 PM runtime 集中管理。
3. **-EPROBE_DEFER 是常态**：时钟/电源的提供者可能还没 probe，`dev_err_probe()` 一行处理打印+延迟探测，别自己判断。
4. **pinctrl 大多隐身**：DT 里 `pinctrl-0 = <&ts502_pins>;` 声明后，device core 在 probe 前自动切 default 态——驱动里显式操作 pinctrl 是少数场景（休眠省电态、功能复用切换）。

源码走读：`clk_prepare_enable()`（`drivers/clk/clk.c`）拆两步：`clk_prepare` 可睡眠（锁电压、等 PLL 锁定），`clk_enable` 原子可用（只翻门控位）——拆开的原因是时钟树里有些操作必须睡眠，而 enable 可能被中断路径调用。合并版 `clk_prepare_enable` 只适用于进程上下文。regulator 同理：`regulator_enable` 内部可能睡眠（LDO 斜升等待），中断上下文禁用。

### 什么时候你是提供者

消费者写法每个驱动都用；提供者写法只在三种情况落到你头上：

| 提供者 | 你要写的情况 | 核心结构 |
|---|---|---|
| clk | 外挂时钟芯片（SI5351 这类可编程时钟源） | `clk_hw` + `clk_ops`（recalc_rate/set_rate/enable） |
| regulator | PMIC 上的一颗 LDO/DCDC，内核无对应驱动 | `regulator_desc` + `regulator_ops` |
| pinctrl | 给新 SoC 写引脚控制器 | `pinctrl_desc` + pinmux/pinconf ops |

SoC 原厂 BSP 里这三个提供者基本都已写好。你的产品板大概率一辈子只当消费者——**会用、会查（debugfs）、会判断 defer**，就覆盖了消费者视角的全部需求。

---

## <span class="blue"> 调试与验收 [I]

regmap 的 debugfs 是升级后立刻兑现的红利——不用写一行 sysfs，全部寄存器直接可读：

```bash
ls /sys/kernel/debug/regmap/                # 每个 regmap 设备一个目录（按总线地址命名）
cat /sys/kernel/debug/regmap/1-0050/name    # 确认对应关系
cat /sys/kernel/debug/regmap/1-0050/registers  # dump 全部非 volatile 寄存器（缓存值）
cat /sys/kernel/debug/regmap/1-0050/access  # 各寄存器的可读/可写/volatile 属性表
echo "5 1" > /sys/kernel/debug/regmap/1-0050/registers   # 写寄存器（reg、value 均为十六进制）
```

资源三件套的体检命令：

```bash
cat /sys/kernel/debug/clk/clk_summary           # 时钟树：enable 计数、频率、父子关系
cat /sys/kernel/debug/regulator/regulator_summary  # 电压、电流、使能状态、消费者列表
grep ts502 /sys/kernel/debug/pinctrl/*/pinmux-pins # 引脚复用归属确认
```

验收检查点：`registers` dump 与手册默认值比对；`clk_summary` 里你的时钟 enable_count=1 且频率正确；`regulator_summary` 里 vdd 状态 enabled、消费者是你的设备名。

无硬件后备：任何带 I2C codec/PMIC 的开发板都有现成 regmap 设备，debugfs 四条命令可直接演练；练写法则注册一个 max_register=0x08 的 regmap（总线侧用 i2c-stub 虚设地址），跑通 init 与 config 校验即可。

---

## <span class="blue"> Trade-off 表格 [E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 寄存器访问 | 裸 smbus 调用 | regmap | 寄存器少且一次性访问用裸调用；多于一把、有并发/缓存/调试需求上 regmap |
| 位操作 | 手写读-改-写 | regmap_update_bits | 手写版并发撕裂（中断里也在改同一寄存器时）；regmap 版内部持锁 |
| 缓存模式 | NONE 直读直写 | RBTREE/MAPLE 缓存 | 缓存省总线流量、支持 suspend 恢复；硬件状态会被外部改写的芯片别缓存 |
| 资源管理 | 全手动 get/enable/disable | devm + 手动 enable 反向撤销 | devm 管引用释放；enable 这类动作永远自己收尾 |
| 时钟控制 | clk_enable（原子） | clk_prepare_enable（合并） | 进程上下文用合并版；中断路径只能 enable |

---

## <span class="blue"> 常见陷阱 [E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| volatile 漏声明 | FIFO 读数重复、中断状态清不掉 | 缓存返回旧值 | volatile_reg 回调补齐动态寄存器 |
| RW1C 用 update_bits | 中断清不掉或误清其他位 | 读-改-写把其他置位位也写回 1 清掉了 | RW1C 寄存器只用 regmap_write 写要清的位 |
| defer 当错误返回 | 驱动永远 probe 不上 | 把 -EPROBE_DEFER 打印成 failure | dev_err_probe 统一处理 |
| enable 无配对 disable | suspend 后漏电、关机异常 | 靠 devm 管 enable 动作 | 错误路径与 remove 里反向 disable |
| 先通信后等上电稳定 | 偶发 CHIP_ID 读错 | 手册上电等待时间被跳过 | msleep 按手册给足，放在第一次 regmap_read 前 |
| pinctrl 重复申请 | probe 失败 -EBUSY | device core 已自动选了 default 态 | 消费者别 devm_pinctrl_get_select_default，直接用 |

---

## <span class="blue"> 动手练习

1. 把 Part 1 TS502 完整驱动的寄存器访问全部 regmap 化（CHIP_ID 校验、CTRL 读写、INT_STAT 清零、FIFO dump），对照本篇访问函数表逐项替换；FIFO 读弹出路径注意 volatile。
2. 故意删掉 FIFO_DATA 的 volatile 声明，连续读 FIFO 观察 debugfs dump 与真实读数的差异，理解缓存脏读。
3. 用 debugfs 的 `registers` 写接口替代业务程序：写 CTRL 启动采样、读 INT_STAT、写 1 清零——不编译任何代码完成一次采集流程。
4. 在 clk_summary/regulator_summary 里找到你板子上任一外设的时钟与电源，确认 enable 计数与频率/电压，写出它的消费者依赖链。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| regmap 判定 | 寄存器多、有并发/缓存/调试需求就上 | 还在手写读-改-写吗 |
| volatile | 动态寄存器必须声明，否则读脏缓存 | FIFO/状态/RW1C 都标了吗 |
| update_bits | 内部持锁的原子位操作 | 中断与读写路径并发安全吗 |
| 资源顺序 | 电→钟→复位→通信，按手册 | 错误路径反向撤销了吗 |
| defer | -EPROBE_DEFER 是流程不是错误 | 全走 dev_err_probe 吗 |
| pinctrl | default 态 device core 自动选 | 有没有重复申请 |
| 验收 | regmap debugfs + 三个 summary | 不碰示波器能确认资源状态吗 |

---

## <span class="blue"> 下一步

单芯片的写法至此齐了。下一篇（D.16 MFD 与复合设备）处理"一颗芯片里住了好几个设备"的场景：PMIC 一颗料同时是电源、RTC、按键、电量计——`mfd_add_devices` 怎么拆、共享 regmap 怎么传、中断怎么级联。这是本篇 regmap 知识的直接续集。

螺旋衔接：regmap——第11.1.4章 MMIO 裸写法（认知级）→ Part 1 裸 smbus（操作级）→ 本篇 regmap（框架级）→ D.16 共享 regmap（框架级）→ 第22章驱动架构选型（设计级）。★第3次出现（框架级）
