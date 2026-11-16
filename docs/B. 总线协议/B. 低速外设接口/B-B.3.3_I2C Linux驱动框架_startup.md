<div class="reader-b2" markdown="1">

# 启动建链：DTS 怎样变成 adapter、client 和 probe 参数

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线 > B-B.3.3 I2C Linux 驱动框架
>
> 阅读路线：首读主线 2／3

本页只回答一个问题：**DTS 怎样变成 adapter、client 和 probe 参数？**

---

## <span class="blue"> 先认识对象：代码里的五个名字分别是什么

### `i2c_msg`：一段传输的完整描述

`i2c_msg` 定义在 UAPI 头文件 `include/uapi/linux/i2c.h`。UAPI 是内核与用户空间共同遵守的接口边界，所以内核驱动和用户程序看到的是同一种消息布局。以下是与本篇有关的完整字段和标志定义：

```c title="Linux v6.6 · include/uapi/linux/i2c.h · 有删节"
struct i2c_msg {
    __u16 addr;       /* 器件地址，本例为 0x50 */
    __u16 flags;      /* 本段方向及特殊协议标志 */
#define I2C_M_RD      0x0001
    __u16 len;        /* buf 中本段要读写的字节数 */
    __u8  *buf;       /* 写：数据来源；读：接收位置 */
};

#define I2C_FUNC_I2C  0x00000001
```

`__u16`、`__u8` 是接口中明确宽度的无符号整数类型。`I2C_M_RD` 和 `I2C_FUNC_I2C` **都是宏和位标志，不是枚举**，但用途不同：

- `I2C_M_RD` 写进某条 `msg.flags`，说明这一段由从机向主机发送数据；
- `I2C_FUNC_I2C` 由控制器的 `functionality()` 返回，说明适配器支持普通 I2C 消息；
- `i2c_check_functionality(adap, I2C_FUNC_I2C)` 检查的是适配器能力，不是当前消息方向。

本例的两条消息应读作两个独立的数据段，而不是两次函数调用：

```text
msgs[0]：addr=0x50，flags=0，       len=1，buf 指向 0x10
msgs[1]：addr=0x50，flags=I2C_M_RD，len=1，buf 指向 value
```

数组后面的参数 `2` 告诉 Core：两段属于同一笔事务，中间使用重复 START，最后才 STOP。

### `i2c_client`：Core 已经创建的外设对象

`struct i2c_client` 代表挂在某条总线上的一颗外设。以下字段取自 `include/linux/i2c.h`，省略了中断、从机模式和资源管理字段：

```c title="Linux v6.6 · include/linux/i2c.h · 字段节选"
struct i2c_client {
    unsigned short flags;
    unsigned short addr;          /* 本例为 0x50 */
    char name[I2C_NAME_SIZE];
    struct i2c_adapter *adapter;  /* 指向所属总线，不是内嵌总线 */
    struct device dev;            /* 内嵌通用设备模型对象 */
    /* 其余字段省略 */
};
```

这里有两种不同的关系：

- `client->adapter` 是指针，client 与 adapter 可以分别创建，指针把外设连到既有总线；
- `client->dev` 是直接内嵌的对象，使这个 I2C 外设能进入通用设备模型、sysfs 和驱动匹配流程。

教学驱动中的 `struct i2c_client *client` 是**指向已有对象的指针参数**。Core 在调用 `probe(client)` 前已经创建它，教学驱动不负责分配这个持久对象。

### `i2c_adapter` 与 `i2c_algorithm`：总线对象和它的操作方法

```c title="Linux v6.6 · include/linux/i2c.h · 字段节选"
struct i2c_adapter {
    struct module *owner;
    const struct i2c_algorithm *algo; /* 怎样在这条总线上传输 */
    void *algo_data;                  /* algorithm 取回私有状态的入口 */
    const struct i2c_lock_operations *lock_ops;
    struct rt_mutex bus_lock;         /* 串行化本总线段的事务 */
    int timeout;
    int retries;
    struct device dev;
    int nr;                           /* 本例编号 1 */
    char name[48];
    /* 其余字段省略 */
};

struct i2c_algorithm {
    int (*master_xfer)(struct i2c_adapter *adap,
                       struct i2c_msg *msgs, int num);
    int (*master_xfer_atomic)(struct i2c_adapter *adap,
                              struct i2c_msg *msgs, int num);
    /* SMBus 专用方法省略 */
    u32 (*functionality)(struct i2c_adapter *adap);
};
```

adapter 回答“我在哪条总线上、编号多少、怎样加锁”；algorithm 回答“这条总线具体怎样发消息”。把二者分开，Core 才能用同一个 `i2c_transfer()` 同时支持 RK3568 寄存器控制器和 GPIO 位模拟。`master_xfer_atomic()` 是不能睡眠的原子上下文备用入口；本例 `probe()` 可以睡眠，走普通的 `master_xfer()`。`functionality()` 则返回前面说的适配器能力位。

`master_xfer()` 的返回约定也写在声明旁：**负值表示错误，非负值表示成功处理的消息数**。它不是读取字节数。

### `i2c_driver`：外设驱动登记给 Core 的回调

```c title="Linux v6.6 · include/linux/i2c.h · 字段节选"
struct i2c_driver {
    unsigned int class;
    int  (*probe)(struct i2c_client *client);
    void (*remove)(struct i2c_client *client);
    /* 其他回调省略 */
    struct device_driver driver;  /* 内嵌通用驱动对象 */
    const struct i2c_device_id *id_table;
    /* 其余字段省略 */
};
```

教学驱动填写匹配表、`probe()` 和 `remove()`。`probe()` 不是 reader 函数本身，而是设备与驱动绑定后的初始化回调；本篇在初始化中故意执行一次读取，让启动路径和运行路径能够在同一个例子里观察。

---

## <span class="blue"> 启动建链：DTS 怎样变成 adapter、client 和 probe 参数

### 板级 DTS：先提供控制器和外设事实

下面是完整板级教学 DTS。它需要放入 Linux v6.6 的 `arch/arm64/boot/dts/rockchip/` 构建，描述的是受控实验硬件，不是某块商品板的完整配置。

```dts title="完整教学文件 · rk3568-at24-demo.dts"
--8<-- "docs/B. 总线协议/B. 低速外设接口/code/B-B.3.3/rk3568-at24-demo.dts"
```

`rk3568.dtsi` 已经描述 I2C1 的寄存器、中断和时钟。板级文件只覆盖需要改变的内容：

- **`status = "okay"`**：启用本板实际接出的 I2C1；
- **`clock-frequency = <400000>`**：给出目标 SCL 频率，后续还要经控制器计算和硬件约束；
- **`reg = <0x50>`**：AT24C02 的 7 位地址，不是 `0xfe5a0000` 那样的控制器寄存器地址；
- **`compatible`**：专用测试匹配字符串，避免与内核现成的 at24 驱动争用同一颗外设。

控制器节点的 `rockchip,rk3399-i2c` 兼容项很重要。RK3568 节点还声明了 `rockchip,rk3568-i2c`，v6.6 的 `rk3x_i2c_match[]` 通过兼容回退匹配 `rockchip,rk3399-i2c`，并把 `match->data` 指向 `rk3399_soc_data`。后文的分频计算函数正来自这里，不是凭空写出的。匹配表中的对应项是：

```c title="Linux v6.6 · drivers/i2c/busses/i2c-rk3x.c · rk3x_i2c_match[] 节选"
{
    .compatible = "rockchip,rk3399-i2c",
    .data = &rk3399_soc_data
},
```

“回退”指 DTS 的 compatible 列表允许用较旧但兼容的实现匹配当前硬件；这里不是把 RK3568 说成 RK3399，而是复用后者对应的 `soc_data` 和计算方法。

### 控制器 probe：私有对象中直接内嵌 adapter

RK3568 控制器驱动使用 `struct rk3x_i2c` 保存一个控制器实例的全部状态：

```c title="Linux v6.6 · drivers/i2c/busses/i2c-rk3x.c · 字段节选"
struct rk3x_i2c {
    struct i2c_adapter adap;              /* 直接内嵌，不是指针 */
    struct device *dev;
    const struct rk3x_i2c_soc_data *soc_data;
    void __iomem *regs;
    struct clk *clk;
    struct clk *pclk;
    struct i2c_timings t;
    spinlock_t lock;
    wait_queue_head_t wait;
    bool busy;
    struct i2c_msg *msg;                  /* 当前消息 */
    enum rk3x_i2c_state state;            /* 控制器状态机 */
    unsigned int processed;               /* 当前已处理字节数 */
    int error;
};
```

`probe()` 先分配这份私有对象，再填写内嵌 adapter：

```c title="Linux v6.6 · rk3x_i2c_probe() · 有删节"
i2c = devm_kzalloc(&pdev->dev, sizeof(struct rk3x_i2c), GFP_KERNEL);
if (!i2c)
    return -ENOMEM;

match = of_match_node(rk3x_i2c_match, np);
i2c->soc_data = match->data;
i2c_parse_fw_timings(&pdev->dev, &i2c->t, true);

i2c->adap.owner = THIS_MODULE;
i2c->adap.algo = &rk3x_i2c_algorithm;
i2c->adap.retries = 3;
i2c->adap.dev.of_node = np;
i2c->adap.algo_data = i2c;
i2c->adap.dev.parent = &pdev->dev;
```

现在可以逐段理解 `i2c->adap.algo`：

```text
i2c       指向 struct rk3x_i2c
  └─ adap 是这个对象内部直接包含的 struct i2c_adapter
       └─ algo 是 adapter 内部指向操作方法表的指针
```

因为 `adap` 是内嵌成员，所以写 `i2c->adap.algo`；因为 `algo` 是指针，Core 调用时才写 `adap->algo->master_xfer(...)`。`algo_data = i2c` 则给回调留了一条反向取回控制器私有状态的通道。

`devm_kzalloc()` 分配并清零设备管理内存；`GFP_KERNEL` 是普通可睡眠上下文的分配标志，这里不是原子传输路径。probe 失败或设备解绑时，devres（设备资源管理）按登记关系释放这份内存。`THIS_MODULE` 指向当前模块，用于记录 adapter 的模块归属；`retries = 3` 是登记在 adapter 上、供 Core 传输重试使用的次数，不代表 DTS 会重试三次匹配。`of_match_node()` 返回本次命中的匹配项，`match->data` 不是 DTS 属性，而是驱动匹配表中预先挂好的 SoC 私有常量。

### 注册 adapter 后，Core 才创建持久 client

控制器完成资源初始化后注册 adapter。v6.6 的 `i2c_register_adapter()` 会调用 `of_i2c_register_devices()` 扫描设备树子节点：

```c title="Linux v6.6 · drivers/i2c/i2c-core-of.c · 两个函数的有删节片段"
/* of_i2c_get_board_info()：读取 DTS，填写临时描述 */
ret = of_property_read_u32(node, "reg", &addr);
if (ret)
    return ret;

info->addr = addr;
info->of_node = node;

/* of_i2c_register_device()：用临时描述创建持久对象 */
ret = of_i2c_get_board_info(&adap->dev, node, &info);
client = i2c_new_client_device(adap, &info);
```

`i2c_board_info info` 是创建阶段使用的临时描述，不是后面一直存在的 client。`of_i2c_get_board_info()` 负责把固件属性填进这份描述，`of_i2c_register_device()` 再把描述交给 `i2c_new_client_device()`。因此，本例形成一条可观察的创建链：

```text
DTS eeprom@50
→ of_i2c_register_device(adap, node)
→ of_i2c_get_board_info() 调用 of_property_read_u32("reg") 得到 0x50
→ info.addr = 0x50
→ i2c_new_client_device(adap, &info)
→ client->addr = 0x50，client->adapter = adap
→ 设备名 1-0050
```

`1-0050` 中的 `1` 是 adapter 编号，`0050` 是十六进制器件地址。通用设备模型随后完成设备与驱动匹配，命中 `demo_of_match[]` 后才执行：

```c
demo_probe(client);
```

因此 `client` 不是 `demo_probe()` 内部创建的局部变量，也不是 DTS 文本自己变成的指针；它是 Core 创建、设备模型传递的持久对象。

### 注册与销毁是对称路径

`module_i2c_driver(demo_driver)` 在 v6.6 中展开为 `module_driver()` 形式：模块加载时调用 `i2c_add_driver()`，卸载时调用 `i2c_del_driver()`。`MODULE_DEVICE_TABLE()` 只导出模块别名，帮助自动加载；实际运行时匹配仍依靠驱动中的 `of_match_table`。

对象生命周期可以沿同一实例收回：

1. 控制器 probe 创建 `rk3x_i2c`，注册内嵌 adapter；
2. Core 根据子节点创建 client，匹配后调用教学驱动 probe；
3. 传输时，消息只临时借用 client 中的地址和 adapter 指针；
4. 模块卸载时先注销驱动并解除绑定，教学驱动不销毁 Core 拥有的 client；
5. 控制器注销时删除 adapter，Core 对称清理其子设备；devm 释放控制器私有资源。

---

## <span class="blue"> DTS 属性怎样生效：完整追踪 clock-frequency

`reg` 已经跟到 `client->addr`。`clock-frequency` 走的是控制器对象，而不是 client。

Core 提供的 `i2c_parse_fw_timings()` 把固件属性读入通用时序对象：

```c title="Linux v6.6 · include/linux/i2c.h · 字段节选"
struct i2c_timings {
    u32 bus_freq_hz;
    u32 scl_rise_ns;
    u32 scl_fall_ns;
    u32 scl_int_delay_ns;
    u32 sda_fall_ns;
    u32 sda_hold_ns;
    u32 digital_filter_width_ns;
    u32 analog_filter_cutoff_freq_hz;
};
```

控制器 probe 中的调用把结果保存到 `i2c->t`。随后 `rk3x_i2c_adapt_div()` 使用三个不同类型的对象：

```c title="Linux v6.6 · drivers/i2c/busses/i2c-rk3x.c · 声明节选"
struct rk3x_i2c_calced_timings {
    unsigned long div_low;   /* 低电平分频结果 */
    unsigned long div_high;  /* 高电平分频结果 */
    unsigned int tuning;
};

struct rk3x_i2c_soc_data {
    int grf_offset;
    int (*calc_timings)(unsigned long clk_rate,
                        struct i2c_timings *t,
                        struct rk3x_i2c_calced_timings *result);
};
```

本例通过兼容回退选中：

```c title="Linux v6.6 · rk3399_soc_data"
static const struct rk3x_i2c_soc_data rk3399_soc_data = {
    .grf_offset = -1,
    .calc_timings = rk3x_i2c_v1_calc_timings,
};
```

最后的消费代码才把计算结果写入分频寄存器：

```c title="Linux v6.6 · rk3x_i2c_adapt_div() · 有删节"
ret = i2c->soc_data->calc_timings(clk_rate, t, &calc);
WARN_ONCE(ret != 0, "Could not reach SCL freq %u", t->bus_freq_hz);

i2c_writel(i2c, (calc.div_high << 16) | (calc.div_low & 0xffff),
           REG_CLKDIV);
```

完整属性链为：

```text
clock-frequency = <400000>
→ i2c_parse_fw_timings()
→ i2c->t.bus_freq_hz = 400000
→ rk3399_soc_data.calc_timings
→ rk3x_i2c_v1_calc_timings()
→ calc.div_high / calc.div_low
→ REG_CLKDIV
```

400 kHz 是目标值，不是绕过硬件能力的保证；实际结果受输入时钟和计算约束影响。`pagesize` 属于 AT24 外设规则，不参与这笔单字节读取，其对象、读取代码、切页过程和 8＋4 写入实验统一放在 B-B.3.5，避免把总线框架主线切成另一条写路径。

---

[在实验室中逐步观察对象建链与状态变化](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。

## <span class="blue"> 本页自检 Q&A

??? question "为什么 `client` 不是教学驱动自己分配的？"

    因为 DTS 子节点描述的是持久硬件事实。adapter 注册后，Core 先读取 `reg` 并调用 `i2c_new_client_device()` 创建 client，设备模型匹配成功后才把指针传给 `probe(client)`。教学驱动只使用这个对象；卸载驱动也不等于立即销毁整颗 Core 设备。

??? question "为什么是 `i2c->adap.algo`，而不是 `i2c->adap->algo`？"

    `i2c` 是指向 `struct rk3x_i2c` 的指针，所以第一段用 `->`；`adap` 是直接内嵌的 `struct i2c_adapter`，所以第二段用 `.`；`algo` 才是 adapter 内部指向 algorithm 的指针。这个表达式同时展示了包含关系和指针关系。

??? question "`I2C_M_RD` 和 `I2C_FUNC_I2C` 都是位标志，为什么不能互换？"

    前者属于一条消息的 `flags`，表示读方向；后者属于适配器能力位，表示支持普通 I2C 消息。一个描述“这次要做什么”，另一个描述“这条总线能做什么”。

---

[上一页：导读与源码地图](B-B.3.3_I2C Linux驱动框架.md) · [下一页：运行传输](B-B.3.3_I2C Linux驱动框架_transfer.md)

</div>
