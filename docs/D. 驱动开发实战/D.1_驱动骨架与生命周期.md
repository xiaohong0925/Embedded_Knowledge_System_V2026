# D.1 驱动骨架与生命周期

> 所属：扩展篇 D. 驱动开发实战 > Part 1 通用写法线
>
> 难度：[I] | 预计阅读时间：30 分钟
>
> 与第11章的分工：第11章讲驱动与内核的六种接合方式（11.1）和 platform 匹配机制（11.3），回答"驱动怎么挂上去"；本篇回答"挂上去之后骨架怎么写"——probe/remove 对称释放、错误处理两件套、多实例私有数据。机制原理一律链回主线，本篇只讲写法。

## <span class="blue"> 本节导读

主线走完之后，手里已经有了机制全景：总线怎么匹配（11.2/11.3）、fops 怎么替换（12.1.4）、并发原语有哪些（第13章）。但打开一个空白的 `.c` 文件，第一行代码写什么、probe 里先做什么后做什么、出错怎么收拾、两块一样的板子怎么区分——这些写法问题主线没有承担，从本篇开始逐篇补齐。<BR>
本节覆盖：骨架的三段结构（注册胶水 / probe / remove）、`module_platform_driver` 宏展开、probe 与 remove 的对称释放原则、goto 链与 devm 两套错误处理的取舍、多实例与私有数据的组织、模块参数。贯穿案例 TS502 在本篇起步：寄存器手册附表 + 一个能编译、能加载、probe 真的会跑的空骨架，后续八篇逐篇往上加拼图。

---

## <span class="blue"> TS502：贯穿案例的芯片 [I]

Part 1 的九篇共用一颗虚构芯片：**TS502**，I2C 接口的复合传感器。虚构的理由有两个：一是真实芯片没有把"温度 + FIFO + 中断 + PWM"凑齐的，教学要用的特性组合只能定制；二是读者板子上未必有指定型号，虚构芯片配一张完整的寄存器手册，照抄骨架、换自己芯片的寄存器定义即可落地。

### 寄存器手册（节选，各篇引用）

**基本信息**：I2C 7 位地址 0x48（ADDR 引脚接 VCC 时为 0x49）；寄存器 8 位地址、8 位数据；INT 引脚开漏输出、低电平有效；ALARM 引脚 PWM 输出。

| 地址 | 名称 | 属性 | 复位值 | 说明 |
|---|---|---|---|---|
| 0x00 | CHIP_ID | RO | 0x50 | 芯片识别号，probe 里读它确认芯片在场 |
| 0x01 | TEMP_H | RO | — | 温度高字节，有符号 |
| 0x02 | TEMP_L | RO | — | 温度低字节，0.0625°C/LSB（与 LM75 同格式） |
| 0x03 | FIFO_DATA | RO | — | 读一次弹出一个采样点（2 字节，同温度格式） |
| 0x04 | FIFO_STATUS | RO | — | bit[5:0] 当前深度（0-32），bit7 溢出标志 |
| 0x05 | CTRL | RW | 0x00 | bit0 采样使能，bit1 FIFO 使能，bit[3:2] 采样率（0:1Hz 1:10Hz 2:100Hz） |
| 0x06 | INT_STATUS | RW1C | 0x00 | bit0 数据就绪，bit1 FIFO 半满，写 1 清零 |
| 0x07 | INT_MASK | RW | 0x00 | 对应位置 1 允许该中断从 INT 引脚输出 |
| 0x08 | PWM_ALARM | RW | 0x00 | 报警阈值（°C，有效范围 0~125），超温时 ALARM 脚输出 PWM |

**上电时序**：VDD 稳定后 5ms 内不得发起 I2C 通信（probe 里需要 `msleep(5)` 或依赖电源时序）。

> 💡 这张手册就是后续每篇的"硬件事实"：D.4 的中断脚来自 INT 引脚那行，D.5 的周期采样用 CTRL 的采样率位，D.6 的 FIFO 批量读用 FIFO_DATA/FIFO_STATUS。写自己芯片的驱动时，把这张表换成真实 datasheet 的寄存器章节即可。

### 本篇的拼图：空骨架

TS502 驱动在九篇里的生长路线：

```
D.1  空骨架：probe 读 CHIP_ID 确认芯片在场          ← 本篇
D.2  cdev：/dev/ts502 出现，read 读温度、ioctl 配采样率
D.3  poll/fasync：FIFO 非空时唤醒等待的读者
D.4  中断：INT 脚接入，数据就绪不再靠轮询
D.5  定时器：周期采样写进 FIFO
D.6  kfifo：批量读取不丢点，对比 DMA 方案
D.7  设备树：地址、中断脚、报警阈值全部进 DT
D.8  电源：suspend 停采样，resume 恢复
D.9  debugfs：寄存器 dump 与统计计数器
```

---

## <span class="blue"> 骨架的三段结构 [I]

任何总线类型的驱动，骨架都是同三段：**注册胶水**（module_init/exit 或宏展开）、**probe**（发现设备时做初始化）、**remove**（设备消失或驱动卸载时做清理）。总线类型只改变胶水的写法——`platform_driver_register`、`i2c_add_driver`、`usb_register`——probe/remove 内部的写法原则完全一致。

```
insmod                          设备树/总线发现设备           rmmod（或设备移除）
  │                                   │                            │
  ▼                                   ▼                            ▼
module_init() ──► xx_driver_register() ──► 总线匹配 ──► probe() ──► remove() ──► xx_driver_unregister()
       注册胶水（挂到总线上，见 11.2/11.3）          配对关系：probe 里做的，remove 里都要 undo
```

生命周期图里最关键的不是箭头，是那条配对关系：**probe 里每一个成功的动作，都必须在 remove（或 probe 的错误路径）里有对应的逆动作**。骨架篇的全部内容，本质是把这条配对关系落实成可执行的代码习惯。

---

## <span class="blue"> 注册胶水：module_platform_driver 展开 [I]

`module_platform_driver()` 是三个宏的打包（`module_driver` 的实例化）：

```c
/* include/linux/platform_device.h */
#define module_platform_driver(__platform_driver) \
    module_driver(__platform_driver, platform_driver_register, \
                  platform_driver_unregister)

/* include/linux/device/driver.h 展开后等价于： */
static int __init mydrv_init(void)
{
    return platform_driver_register(&my_platform_driver);
}
module_init(mydrv_init);

static void __exit mydrv_exit(void)
{
    platform_driver_unregister(&my_platform_driver);
}
module_exit(mydrv_exit);
```

展开后看到三件事：`module_init` 标记的函数在 insmod（或内建驱动的 initcall）时执行；`platform_driver_register()` 把驱动挂到 platform 总线的驱动链表上（注册之后的匹配流程见 11.3.2）；`__init`/`__exit` 是段属性标记，内建驱动初始化完后 `__init` 段内存被回收。

I2C 驱动的对应宏是 `module_i2c_driver()`，展开结构一模一样。胶水层没有可发挥的空间，照抄即可——骨架的功夫全在 probe/remove 里。

> 💡 `platform_driver_register()` 的调用链（`drivers/base/platform.c` → `driver_register()` → `bus_add_driver()` → 遍历设备链表触发 `really_probe()`）是 11.2/11.3 的内容，写法篇只需记住一个事实：**register 返回时 probe 可能已经跑完了**，所以 probe 里用到的数据必须在 register 之前就初始化好（静态结构、常量表），不能指望"register 之后再准备"。

---

## <span class="blue"> TS502 空骨架：能编译、能加载、probe 真的会跑 [I]

TS502 是 I2C 设备，胶水用 `module_i2c_driver`。空骨架只做一件事：probe 里读 CHIP_ID，确认芯片在场——这是所有真实驱动 probe 的第一个动作，也是本篇结束时 TS502 驱动具备的全部能力。

```c
// SPDX-License-Identifier: GPL-2.0
/* ts502.c —— D.1 空骨架：probe 读 CHIP_ID 确认芯片在场 */
#include <linux/module.h>
#include <linux/i2c.h>
#include <linux/delay.h>

#define TS502_REG_CHIP_ID   0x00
#define TS502_CHIP_ID       0x50

struct ts502_data {
    struct i2c_client *client;
    /* D.2 起逐篇添加：cdev、waitqueue、kfifo、timer…… */
};

static int ts502_probe(struct i2c_client *client)
{
    struct ts502_data *data;
    int id;

    msleep(5);                  /* 手册上电时序：VDD 稳定后 5ms 内禁通信 */

    /* 第一个动作永远是"验明正身"：读 CHIP_ID */
    id = i2c_smbus_read_byte_data(client, TS502_REG_CHIP_ID);
    if (id < 0)
        return dev_err_probe(&client->dev, id, "read CHIP_ID failed\n");
    if (id != TS502_CHIP_ID)
        return dev_err_probe(&client->dev, -ENODEV,
                             "unexpected CHIP_ID 0x%02x\n", id);

    data = devm_kzalloc(&client->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;
    data->client = client;
    i2c_set_clientdata(client, data);

    dev_info(&client->dev, "TS502 probed (CHIP_ID 0x%02x)\n", id);
    return 0;
}

static void ts502_remove(struct i2c_client *client)
{
    /* 本篇 devm 托管了全部资源，remove 暂时无事可做 */
    dev_info(&client->dev, "TS502 removed\n");
}

static const struct of_device_id ts502_of_match[] = {
    { .compatible = "virtual,ts502" },
    { }
};
MODULE_DEVICE_TABLE(of, ts502_of_match);

static const struct i2c_device_id ts502_id[] = {
    { "ts502", 0 },
    { }
};
MODULE_DEVICE_TABLE(i2c, ts502_id);

static struct i2c_driver ts502_driver = {
    .driver = {
        .name = "ts502",
        .of_match_table = ts502_of_match,
    },
    .probe  = ts502_probe,
    .remove = ts502_remove,
    .id_table = ts502_id,
};
module_i2c_driver(ts502_driver);

MODULE_DESCRIPTION("TS502 composite sensor driver (skeleton)");
MODULE_AUTHOR("D.1 example");
MODULE_LICENSE("GPL");
```

配套设备树片段（D.7 会展开讲，本篇只需能匹配上）：

```dts
&i2c1 {
    ts502@48 {
        compatible = "virtual,ts502";
        reg = <0x48>;
    };
};
```

编译、加载、验证（在板子上，模块方式）：

```bash
make -C /lib/modules/$(uname -r)/build M=$PWD modules
insmod ts502.ko
dmesg | tail -2
[ 1234.567890] i2c 1-0048: TS502 probed (CHIP_ID 0x50)
```

`dev_err_probe()` 在 11.3.3 已经讲过语义：打印 + 返回错误码一体，`-EPROBE_DEFER` 时降级记录到 devices_deferred。骨架里所有错误返回统一用它，不写裸 `dev_err + return` 组合。

---

## <span class="blue"> probe/remove 对称释放原则 [I]

probe 里申请的资源分两类，释放义务不同：

| 申请动作 | 逆动作 | 释放位置 |
|---|---|---|
| `devm_kzalloc` / `devm_ioremap_resource` / `devm_request_irq` | 无（框架托管） | 内核在 remove 之后或 probe 失败后自动释放 |
| `clk_prepare_enable` / `regulator_enable` | `clk_disable_unprepare` / `regulator_disable` | remove 里必须手动配对（enable 不托管，见 11.3.3） |
| `cdev_add` / `input_register_device` 等子系统注册（D.2 起） | `cdev_del` / 对应 unregister | remove 里手动配对，或用 devm 变体 |
| `request_irq`（非 devm 版） | `free_irq` | remove 里手动配对 |

对称的写法检查标准：**把 probe 里所有非 devm 动作列出来，remove 里按逆序逐个能找到对应的逆动作**。逆序的原因和栈相同——后申请的资源可能依赖先申请的资源（中断 handler 用到 IO 映射，所以先 free_irq 再 iounmap）。

TS502 空骨架的 remove 之所以是空的，不是省略，是结果：全部资源都走了 devm 托管。这是产品驱动的目标状态——remove 越空，出错面越小。

---

## <span class="blue"> 错误处理两件套：goto 链 vs devm [I]

probe 是多步申请的序列，任何一步失败都必须把前面已成功的步骤全部 undo。两套写法解决同一个问题。

### 写法一：goto 链逆序释放

```c
static int demo_probe(struct platform_device *pdev)
{
    struct demo_data *data;
    int ret;

    data = kzalloc(sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;

    data->base = ioremap(res->start, resource_size(res));
    if (!data->base) {
        ret = -ENOMEM;
        goto err_free_data;
    }

    ret = request_irq(irq, demo_isr, 0, "demo", data);
    if (ret)
        goto err_iounmap;

    return 0;

err_iounmap:
    iounmap(data->base);
err_free_data:
    kfree(data);
    return ret;
}
```

规则只有两条，但极易写错：标签按**申请顺序的逆序**排列；每个标签只 undo 自己对应的那一步，然后落入下一个标签继续 undo。新增一个申请步骤时，goto 链的所有标签位置都要重排——这是它易错的根源。

### 写法二：devm_* 全家桶

```c
static int demo_probe(struct platform_device *pdev)
{
    struct demo_data *data;

    data = devm_kzalloc(&pdev->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;

    data->base = devm_ioremap_resource(&pdev->dev, res);
    if (IS_ERR(data->base))
        return PTR_ERR(data->base);

    ret = devm_request_irq(&pdev->dev, irq, demo_isr, 0, "demo", data);
    if (ret)
        return ret;

    return 0;
}
```

devm 版把释放义务转移给内核：probe 失败或 remove 之后，内核按注册的逆序自动调用各资源的释放函数（机制见 11.3.4）。任何一步失败直接 `return`，不用回头收拾。

### 取舍

产品驱动的结论是**全 devm**：goto 链每多一步就多一处写错的机会，而 devm 的代价只是放弃对释放顺序的精细控制——这个控制绝大多数驱动用不上。两种场景除外：一是需要自定义释放函数的资源，用 `devm_add_action_or_reset()` 挂上自己的清理函数；二是 enable 类状态切换（clk/regulator 的 enable），devm 不托管，仍需手动配对（11.3.3 已划清这条托管分界线）。

> 💡 最危险的不是全 goto 或全 devm，是**混用**：同一资源 devm 申请、remove 里又手动释放一次，double free 当场 oops——这是真实产品驱动里反复出现的事故类型。团队规范里写死：一个驱动里资源要么全 devm，要么全手动，禁止按资源类型混搭。

---

## <span class="blue"> 多实例与私有数据 [I]

同型号芯片挂两颗（比如 I2C 总线上 0x48 和 0x49 各一颗 TS502），probe 会跑两次，每次的 `client` 不同。驱动代码里**禁止用全局变量存设备状态**——全局变量意味着两颗芯片互相覆盖。正确做法是每实例一份私有数据：

```c
/* probe 里：分配并挂到 device 上 */
data = devm_kzalloc(&client->dev, sizeof(*data), GFP_KERNEL);
data->client = client;
i2c_set_clientdata(client, data);        /* platform 侧是 dev_set_drvdata */

/* 其他回调里（remove、中断 handler、fops）取回来 */
struct ts502_data *data = i2c_get_clientdata(client);
```

`dev_set_drvdata`/`i2c_set_clientdata` 的本质是把指针塞进 `struct device` 的 `driver_data` 字段，内核在任何能拿到 `device` 的地方都能取回这份私有数据。

### 实例编号：idr/xarray

D.2 给每个实例分配 `/dev/ts502-0`、`/dev/ts502-1` 这样的次设备号时，需要一套"分配-回收整数编号"的机制。内核提供 `idr`（integer ID management，新版底层是 xarray）：

```c
static DEFINE_IDA(ts502_ida);   /* ida 是 idr 的简化封装，只管分配不管指针 */

/* probe 里 */
data->minor = ida_alloc(&ts502_ida, GFP_KERNEL);   /* 拿一个空闲编号 */
if (data->minor < 0)
    return data->minor;

/* remove 或错误路径里 */
ida_free(&ts502_ida, data->minor);
```

`ida_alloc` 返回当前最小空闲整数，实例拔除后编号可回收复用。它的角色等同 11.1.1 里 `alloc_chrdev_region` 动态分到的次设备号池，但归驱动自己管。

### 模块参数：最后才用的配置通道

```c
static unsigned int sample_rate = 10;
module_param(sample_rate, uint, 0644);
MODULE_PARM_DESC(sample_rate, "default sampling rate in Hz");
```

模块参数 insmod 时可改（`insmod ts502.ko sample_rate=100`），也出现在 `/sys/module/ts502/parameters/`。它的适用面很窄：**调试开关、开发期临时配置**。产品配置走设备树（每实例可不同），模块参数是全局的、对所有实例生效——把硬件事实塞进模块参数是常见设计错误（D.7 展开"硬件事实进 DT vs 软件策略写死"的边界）。

---

## <span class="blue"> Trade-off 表格 [I]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 错误处理 | devm_* | goto 链 | devm 免维护、失败路径零代码，但释放顺序受框架控制；goto 链精确可控，每加一步都要重排标签 |
| 自定义清理 | devm_add_action_or_reset | 手动 remove | 前者保留 devm 的自动性；后者直观但要保证所有路径都走到 |
| 实例编号 | idr/ida | 静态数组 + 计数 | ida 自动回收编号、支持任意多实例；静态数组简单但实例数写死、拔插后编号不复用 |
| 配置通道 | 设备树 | 模块参数 | DT 每实例独立、是硬件事实的正确归属；模块参数全局生效，只适合调试开关 |
| 私有数据 | dev_set_drvdata | 全局变量 | 多实例下全局变量直接出局，没有权衡空间 |

---

## <span class="blue"> 常见陷阱 [I]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 全局变量存实例数据 | 挂两颗芯片后行为错乱 | probe 跑两次，后一次覆盖前一次 | 每实例 devm_kzalloc + set_drvdata |
| remove 里重复释放 devm 资源 | rmmod 后 oops | devm 与手动释放混用，double free | 资源全 devm，remove 只留 enable 配对 |
| probe 失败后资源泄漏 | 反复 insmod/rmmod 后内存缓慢上涨 | 某步失败直接 return，前面手动申请的没 undo | goto 链逆序释放，或改用 devm |
| 忘记 MODULE_DEVICE_TABLE(of) | 设备树节点存在，模块却不被自动加载（手动 insmod 后匹配正常） | of_match 表没导出到模块别名，udev 拿不到 modalias | 两张 ID 表都加 MODULE_DEVICE_TABLE |
| enable 类资源泄漏 | 卸载后时钟/电源仍开，功耗异常 | 误以为 devm_clk_get 托管 enable | remove 里配对 clk_disable_unprepare |

---

## <span class="blue"> 动手练习

1. 把 TS502 空骨架在板子上编译加载（没有 TS502 硬件时，把 `i2c_smbus_read_byte_data` 暂时注释掉、固定 `id = TS502_CHIP_ID` 跑通加载-匹配-probe 路径），观察 `dmesg` 里的 probe 日志与 `/sys/bus/i2c/drivers/ts502/` 目录的出现。
2. 在设备树里再声明一个 `ts502@49` 节点（同样不连硬件也可走完 probe），在 probe 里打印 `client->addr`，验证两次 probe 各自的私有数据互不干扰。
3. 故意制造一次 double free：保留 `devm_kzalloc`，在 remove 里加一句 `kfree(data)`，rmmod 观察 oops 现场——然后删掉它，把"devm 资源禁止手动释放"写进自己的代码习惯。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| 三段结构 | 注册胶水 / probe / remove；总线只改胶水，原则不变 | 换个总线类型，骨架哪几行要改 |
| 对称释放 | probe 每个非 devm 动作，remove 逆序必有逆动作 | remove 里能逐条对上 probe 吗 |
| goto 链 | 标签逆序排列，每个标签只 undo 一步 | 新增一步申请，标签怎么加 |
| devm | 释放义务转移给内核，产品驱动全 devm | 哪些东西 devm 不管（enable） |
| 多实例 | 禁止全局变量，dev_set_drvdata + ida 编号 | 挂两颗芯片会怎样 |
| 模块参数 | 全局、调试用；硬件事实走设备树 | 这个配置是硬件事实还是软件策略 |

---

## <span class="blue"> 下一步

骨架立住了，但 TS502 现在还读不到数据——用户空间没有任何入口。下一篇（D.2 字符设备与用户态数据通道）给它接上 cdev：`/dev/ts502` 出现，read 读温度、ioctl 配采样率，并讲透产品级 ioctl ABI 的版本演进设计。

螺旋衔接：驱动骨架——第4.5章动手加载模块（操作级）→ 11.0.1 先写一个驱动（认知级）→ 本篇（写法级）→ 第22章驱动架构设计（设计级）。★第3次出现（写法级）
