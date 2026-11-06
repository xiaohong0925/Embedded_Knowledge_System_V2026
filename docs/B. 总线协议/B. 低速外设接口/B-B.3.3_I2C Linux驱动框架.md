# B-B.3.3 I2C Linux 驱动框架

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[B→I] Beginner → Intermediate | 预计阅读时间：60 分钟

## <span class="blue"> 本节导读

本篇只回答一个问题：**Linux 怎样把设备树中的一颗 AT24C02 建立为可访问对象，把“读取内部地址 0x10 的一个字节”交给可替换的总线实现，再将数据或错误返回调用者？**

贯穿实例固定为 RK3568 的 I2C1、7 位地址 `0x50` 的 AT24C02 和 Linux v6.6。AT24C02 是可以通过 I2C 读写的 EEPROM，即电可擦除、掉电后仍能保存内容的小容量存储器。读取一个存储单元时，主机先写入内部偏移 `0x10`，再用重复 START 切换为读方向；重复 START 是不先发送 STOP、再次发出 START 以开始下一段消息。

先分清三个名字：

- **I2C Core** 是内核中的 I2C 公共代码，负责创建总线与外设对象、提供统一传输入口并串行化同一总线上的事务；它不理解 AT24C02 的页写规则，也不直接实现 RK3568 的寄存器时序。
- **DTS** 是可读的设备树源文件，用来描述板级硬件；编译后的 DTB 才交给内核使用。
- **SoC** 是片上系统，这里指把 CPU、I2C 控制器等模块集成在同一颗芯片里的 RK3568。

本篇与第 11 章的分工不变：第 11 章讲通用的总线、设备、驱动匹配机制，本篇只展开 I2C 特有的对象创建、传输与用户入口。SMBus 和 PMBus 归 B-B.3.6；AT24 的页写、ACK 轮询和 NVMEM（内核非易失存储器框架）的 `eeprom` 文件归 B-B.3.5。

> ⚠️ 本篇以 Linux v6.6 源码为核对基准。教学代码和交互实验室均未在本篇环境中交叉编译、运行或上板验证；页面中的 `0x5a`、日志和波形都是用于推演的样本，不是实测记录。

---

## <span class="blue"> 先建立全路：寄存器操作没有消失，而是换了负责人

在厂商 SDK 或裸驱动中，一份驱动可能从字符设备的 `read()`、`ioctl()` 一路做到 `readl()`、`writel()`，直接控制 SoC 的 I2C 控制器寄存器。内存映射 I/O 把寄存器窗口映射到 CPU 地址空间，`readl()`、`writel()` 通过这个窗口访问控制器；它们访问的不是 AT24C02 的内部偏移。

Linux 通用 I2C 框架把这件工作拆成可替换的两半：

```text
外设驱动：AT24C02 的内部偏移、消息方向、数据长度
    ↓ 只提交与 SoC 无关的 msgs[2]
I2C Core：找到 adapter、锁住总线、调用已登记的 algorithm
    ↓
控制器实现：RK3568 寄存器 / GPIO 位模拟
    ↓
SDA、SCL 上的真实波形
    ↓
数据和错误沿原路返回
```

因此，修改 RK3568 控制器时序仍然需要进入寄存器层，但不必在每颗外设驱动里重复做一遍。反过来，替换 AT24C02 为另一颗传感器时，控制器驱动也不需要理解新器件的内部寄存器规则。

本篇使用两条入口观察同一后半路：

```text
入口 A：内核教学驱动 demo_read_reg()
入口 B：用户态 i2c-read + /dev/i2c-1
                  ↓
           同一个 i2c_transfer()
                  ↓
       adapter->algo->master_xfer()
                  ↓
        RK3568 或 GPIO 模拟控制器
```

### 先从源码目录看 I2C 子系统：核心、控制器和外设并不都在同一个目录

阅读这套代码时，先按“对象由谁实现”找文件，不要从 `drivers/i2c/` 开始寻找所有 I2C 外设。Linux v6.6 中，本篇涉及的主要代码这样分布：

```text
include/linux/i2c.h                 内核内部的 client、adapter、driver、algorithm
include/uapi/linux/i2c.h            用户与内核共享的 i2c_msg、I2C_M_RD
include/uapi/linux/i2c-dev.h        I2C_RDWR、i2c_rdwr_ioctl_data

drivers/i2c/
├── i2c-core-base.c                 adapter/client 生命周期、加锁、通用传输
├── i2c-core-of.c                   从设备树子节点创建 client
├── i2c-dev.c                       为 adapter 提供 /dev/i2c-N 字符设备入口
├── busses/
│   ├── i2c-rk3x.c                  RK3568 等 Rockchip 控制器的寄存器状态机
│   └── i2c-gpio.c                  取得 GPIO，提供 SDA/SCL 读写操作
└── algos/
    └── i2c-algo-bit.c              用上述 GPIO 操作逐位实现 I2C 波形

drivers/misc/eeprom/at24.c           内核现成 AT24 外设驱动
drivers/gpio/gpio-pca953x.c          PCA9555 等 I2C GPIO 扩展器驱动
```

这里先把 adapter 理解为“一条可访问总线”的内核对象，把 client 理解为“挂在这条总线上的一颗外设”的对象；下一节再展开它们的字段和所有权。`probe()` 则是设备与驱动绑定后执行的初始化回调。

这棵目录树对应四种不同的代码责任：

- **接口头文件**规定对象长什么样。`include/linux/i2c.h` 面向内核驱动；`include/uapi/` 是用户空间 ABI（应用二进制接口）的一部分，用户程序也能包含后两个头文件。
- **Core** 实现所有控制器和外设可以共用的规则。它创建并关联对象，但不包含 RK3568 寄存器定义，也不决定 AT24C02 的内部地址宽度。
- **控制器实现**分为“具体硬件”和“可复用算法”。`i2c-rk3x.c` 自己实现寄存器传输；`i2c-gpio.c` 只负责操作引脚，把逐位波形交给 `i2c-algo-bit.c`。所以 GPIO 路径是两个文件协作，不是一个文件包办全部工作。
- **外设驱动按外设提供的功能归档**。AT24 提供存储能力，位于 `drivers/misc/eeprom/`；PCA9555 提供 GPIO 能力，位于 `drivers/gpio/`。它们虽然都通过 I2C 访问，却不会因此搬进 `drivers/i2c/`。

同一条主线在这些文件之间这样穿行：

```text
启动建链：
rk3568-at24-demo.dts
→ busses/i2c-rk3x.c 创建并注册 adapter
→ i2c-core-of.c 读取 eeprom@50，创建 client
→ 教学 demo_i2c.c 收到 probe(client)

内核读取：
demo_i2c.c 组织 msgs[2]
→ i2c-core-base.c 持锁并调用 adapter->algo->master_xfer()
→ busses/i2c-rk3x.c 操作寄存器、FIFO 和中断状态机

用户态读取：
i2c-read.c 调用 ioctl(I2C_RDWR)
→ i2c-dev.c 复制消息并调用同一个 i2c_transfer()
→ 仍然进入 i2c-core-base.c 和当前 adapter 的控制器实现
```

因此，`i2c-dev.c` 不是另一套总线协议栈，`i2c-algo-bit.c` 也不是另一套外设驱动。前者只增加用户入口，后者只替换波形实现；Core 的对象和传输约定保持不变。

还要区分“源码树里存在”和“目标板上存在”：各目录的 Kconfig 提供配置选择，Makefile 根据配置把源文件编进内核、编成模块或不参与本次构建；设备树再描述本板实际硬件，驱动 probe 成功后才形成可使用的运行对象。看到某个 `.c` 文件，不能直接推断当前系统已经包含它。

下面的实验室可以逐步执行启动建链和传输过程。启动与传输代码窗可切换“完整函数”和“步骤片段”：前者保留真实文件上下文与起始行号，后者只突出当前一步；SCL 时钟延展单步则需在 GPIO 模拟模式下操作。实验室是正文的辅助视图，即使删除这个 iframe，后文仍能独立讲完同一机制。

<div class="interactive-demo">
  <iframe
    src="../html/i2c-framework-lab.html"
    title="Linux I2C 框架交互实验室：对象建链、传输单步、用户态与 GPIO 模拟"
    loading="lazy"
    style="width:100%;height:1120px;border:0;"
  ></iframe>
</div>

[在新窗口打开 I2C Framework Lab](./html/i2c-framework-lab.html){: target="_blank" rel="noopener noreferrer" }。实验室中的步骤是依据 v6.6 源码构造的模型推演，不连接真实硬件。

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

## <span class="blue"> 完整教学模块：代码、构建与验证放在同一处

### 完整文件

`demo_i2c.c` 是原创教学文件，不是内核源码节选。注释已经标出每个参数、返回值和对象所有权；建议先沿 `demo_probe()` 找到读取调用，再读匹配表和注册宏。

=== "demo_i2c.c"

    ```c title="完整教学文件 · demo_i2c.c"
    --8<-- "docs/B. 总线协议/B. 低速外设接口/code/B-B.3.3/demo_i2c.c"
    ```

=== "Makefile"

    ```makefile title="完整教学文件 · Makefile"
    --8<-- "docs/B. 总线协议/B. 低速外设接口/code/B-B.3.3/Makefile"
    ```

### 构建模块与 DTB

以下命令是构建模板，不代表已经部署到板卡。内核源码路径、交叉工具链前缀和 DTB 部署方式必须替换为实际 BSP 环境。

```bash title="在同一源码目录选择实际需要的构建"
# 1. 构建教学模块；KDIR 指向与目标板运行内核一致的源码构建树
make -C /path/to/rk3568-kernel \
     ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- \
     M="$PWD" modules

# 2. 构建用户态程序，稍后用于 /dev/i2c-N 路径
make user CC=aarch64-linux-gnu-gcc

# 3. 把 DTS 放入 arch/arm64/boot/dts/rockchip/ 后，在内核源码顶层构建 DTB
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- \
     rockchip/rk3568-at24-demo.dtb
```

`M="$PWD"` 把外部模块目录交给 Kbuild；`obj-m` 表示生成可加载模块。`make user` 调用本目录 Makefile 中的普通用户程序规则，不经过 Kbuild。构建成功只证明源代码和构建环境相容，不证明 DTB 已生效，也不证明外设可通信。

### 加载后看什么

在新 DTB 已生效、模块与运行内核匹配、地址 `0x50` 确实是可测试 AT24C02 的前提下，才执行：

```bash
insmod demo_i2c.ko
dmesg | grep demo_i2c
rmmod demo_i2c
```

假设偏移 `0x10` 中原来保存 `0x5a`，预期日志形状为：

```text title="预期示例 · 非实测输出"
demo_i2c 1-0050: reg 0x10 = 0x5a, addr = 0x50
demo_i2c 1-0050: remove demo device
```

`dev_info()` 和 `dev_err()` 没有用于判断通信的返回值；它们通过 `client->dev` 自动带上设备身份。真实读值取决于 EEPROM 原内容，其他合法数值不等于故障。没有读取日志应先检查匹配和 probe 是否执行；出现负错误码才说明 probe 已进入但通信或初始化失败。`insmod` 成功本身只表示模块已加载。

---

## <span class="blue"> 运行传输：两条消息怎样穿过 Core 到达 RK3568

### Core：先检查能力，再持锁调用 algorithm

`demo_read_reg()` 把 `client->adapter`、栈上的 `msgs` 和消息数 `2` 交给 `i2c_transfer()`。由于调用是同步的，返回前这些栈缓冲区一直有效，返回后硬件已经不再使用它们。

v6.6 的公共入口做了两件与本例直接相关的事：

```c title="Linux v6.6 · drivers/i2c/i2c-core-base.c · 有删节"
int i2c_transfer(struct i2c_adapter *adap, struct i2c_msg *msgs, int num)
{
    int ret;

    if (!adap->algo->master_xfer)
        return -EOPNOTSUPP;

    /* 跟踪记录等省略 */
    ret = __i2c_lock_bus_helper(adap);
    if (ret)
        return ret;

    ret = __i2c_transfer(adap, msgs, num);
    i2c_unlock_bus(adap, I2C_LOCK_SEGMENT);
    return ret;
}
```

`I2C_LOCK_SEGMENT` 表示锁住当前总线段；本例只使用这一条 adapter，可把它理解为保护该适配器对应物理总线上的整笔消息组。解锁与加锁必须成对，因此正常、NACK 和超时路径都要经过它。

`__i2c_transfer()` 在已经持锁的前提下选择回调：

```c title="Linux v6.6 · __i2c_transfer() · 有删节"
if (i2c_in_atomic_xfer_mode() && adap->algo->master_xfer_atomic)
    ret = adap->algo->master_xfer_atomic(adap, msgs, num);
else
    ret = adap->algo->master_xfer(adap, msgs, num);
```

这里的函数指针不是教学驱动直接填写的。它在控制器 probe 时已经指向：

```c title="Linux v6.6 · drivers/i2c/busses/i2c-rk3x.c"
static const struct i2c_algorithm rk3x_i2c_algorithm = {
    .master_xfer       = rk3x_i2c_xfer,
    .master_xfer_atomic = rk3x_i2c_xfer_polling,
    .functionality     = rk3x_i2c_func,
};
```

所以本例普通上下文中的真实路线是：

```text
demo_read_reg(client, 0x10, &value)
→ i2c_transfer(client->adapter, msgs, 2)
→ __i2c_lock_bus_helper(adap)
→ __i2c_transfer(adap, msgs, 2)
→ rk3x_i2c_xfer(adap, msgs, 2)
→ rk3x_i2c_xfer_common(adap, msgs, 2, false)
```

### 控制器：从 adapter 取回私有状态，再启动状态机

进入 RK3568 驱动后，第一行把之前保存的 `algo_data` 取回：

```c title="Linux v6.6 · rk3x_i2c_xfer_common() · 有删节"
struct rk3x_i2c *i2c = (struct rk3x_i2c *)adap->algo_data;

for (i = 0; i < num; i += ret) {
    ret = rk3x_i2c_setup(i2c, msgs + i, num - i);
    if (ret < 0)
        break;

    if (i + ret >= num)
        i2c->is_last_msg = true;

    rk3x_i2c_start(i2c);
    timeout = wait_event_timeout(i2c->wait, !i2c->busy,
                                 msecs_to_jiffies(WAIT_TIMEOUT));

    if (timeout == 0) {
        /* 强制 STOP、恢复 STATE_IDLE 等省略 */
        ret = -ETIMEDOUT;
        break;
    }
    if (i2c->error) {
        ret = i2c->error;
        break;
    }
}

return ret < 0 ? ret : num;
```

`rk3x_i2c_setup()` 把当前 `i2c_msg` 的地址、方向、缓冲区和长度转成控制器设置，返回值告诉循环本次准备了多少条消息。`is_last_msg` 标记当前是否已到整组末尾，控制器据此决定段间继续还是发送最后的 STOP。`rk3x_i2c_start()` 启动后，进程等待 `i2c->busy` 变为假；中断处理函数根据状态机推进 START、WRITE、READ、STOP，并通过 FIFO 收发数据。FIFO 是先进先出的硬件缓冲，TXFIFO 保存待发送字节，RXFIFO 保存已接收字节。

一笔传输中的关键状态变化是：

```text
调用前：busy=false，state=STATE_IDLE，processed=0
启动后：busy=true，msg 指向当前消息，state 随传输推进
接收时：RXFIFO → msg->buf，processed 增加
完成时：state=STATE_IDLE，busy=false，唤醒等待者
失败时：error 保存负错误，或等待超时后强制 STOP 并恢复状态
```

`msecs_to_jiffies(WAIT_TIMEOUT)` 把驱动定义的毫秒等待上限转换成内核调度时钟滴答数。`wait_event_timeout()` 返回 0 表示等待超时，不是“本次读取了 0 字节”。若中断正常完成并唤醒等待者，函数再检查 `i2c->error`，决定沿错误路径返回还是继续下一条消息。

### 返回值：每一层表达的对象不同

本例成功路径上的数字不能混读：

```text
rk3x_i2c_xfer_common() 返回 2：完成了两条消息
i2c_transfer()            返回 2：Core 原样返回该结果
demo_read_reg()           返回 0：两条消息完成，数据已写入 value
demo_probe()              返回 0：初始化和本次试读均成功，允许绑定
```

若 `i2c_transfer()` 返回负值，教学代码保留错误；若返回 `0` 或 `1`，说明没有完成两条消息，转换成 `-EIO`。`0x5a` 通过输出参数 `value` 返回，不通过函数返回值返回。

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

## <span class="blue"> `/dev/i2c-N`：另一个入口怎样接到同一 Core

### 节点不是凭空出现的：i2c-dev 监听 adapter 注册

`CONFIG_I2C_CHARDEV` 启用 i2c-dev。初始化时它登记字符设备号区域、创建 class，并监听 I2C 总线上的 adapter 增删：

```c title="Linux v6.6 · drivers/i2c/i2c-dev.c · 有删节"
res = register_chrdev_region(MKDEV(I2C_MAJOR, 0), I2C_MINORS, "i2c");
i2c_dev_class = class_create("i2c-dev");
res = bus_register_notifier(&i2c_bus_type, &i2cdev_notifier);

/* 也为初始化前已经存在的 adapter 补建入口 */
i2c_for_each_dev(NULL, i2c_dev_attach_adapter);
```

当 adapter 出现时，`i2cdev_attach_adapter()` 创建 `struct i2c_dev`，把次设备号绑定到 `adap->nr`：

```c title="Linux v6.6 · i2cdev_attach_adapter() · 有删节"
cdev_init(&i2c_dev->cdev, &i2cdev_fops);

device_initialize(&i2c_dev->dev);
i2c_dev->dev.devt = MKDEV(I2C_MAJOR, adap->nr);
i2c_dev->dev.class = i2c_dev_class;
i2c_dev->dev.parent = &adap->dev;
i2c_dev->dev.release = i2cdev_dev_release;

res = dev_set_name(&i2c_dev->dev, "i2c-%d", adap->nr);
res = cdev_device_add(&i2c_dev->cdev, &i2c_dev->dev);
```

在本例编号为 1 的 adapter 上，它形成 `/sys/class/i2c-dev/i2c-1` 所代表的 class 设备，并由 devtmpfs 提供 `/dev/i2c-1` 节点。字符设备通过设备号找到 `i2cdev_fops`，之后的 `open()`、`ioctl()` 才进入 i2c-dev。

通用机制不在本篇重写：

- sysfs 三视图见 [11.5.1 sysfs 三视图](../../02-核心机制深度解析/第11章%20设备模型/11.5.1_sysfs三视图.md)；
- devtmpfs 与 udev 的分工见 [11.5.2 uevent 生命周期](../../02-核心机制深度解析/第11章%20设备模型/11.5.2_uevent生命周期.md)；
- cdev 注册和 `open()` 时的 `file_operations` 替换见 [12.1.4 字符设备与 file_operations](../../02-核心机制深度解析/第12章%20文件系统/12.1.4_字符设备与file_operations.md)。

因此，`/dev/i2c-1` 是 **adapter 的用户态入口**，不是 AT24 专属文件。AT24 绑定 at24 驱动后由 NVMEM 创建的 `1-0050/eeprom` 则是另一条外设专用路径，归 B-B.3.5。

### `open()` 创建的是匿名 client，不是第二颗设备树外设

```c title="Linux v6.6 · i2cdev_open() / i2cdev_release() · 有删节"
adap = i2c_get_adapter(minor);
client = kzalloc(sizeof(*client), GFP_KERNEL);
snprintf(client->name, I2C_NAME_SIZE, "i2c-dev %d", adap->nr);
client->adapter = adap;
file->private_data = client;

/* release 中 */
i2c_put_adapter(client->adapter);
kfree(client);
file->private_data = NULL;
```

源码特别强调：这个匿名 client **不会注册进设备模型或 I2C Core 的设备列表**，只保存该打开实例的寻址信息和 adapter 引用。

用两个进程推演共享与独立状态：

```text
进程 A：open() → file A + 匿名 client A + msgs A + buffer A
进程 B：open() → file B + 匿名 client B + msgs B + buffer B

二者独立：文件描述符、匿名 client、消息数组和用户缓冲区
二者共享：同一个 i2c_adapter、bus_lock 和同一条物理总线
```

A 正在执行 `I2C_RDWR` 时，Core 已持有 adapter 总线锁；B 发起事务会等待锁，不会把 A 的两条消息与 B 的消息穿插在线路上。锁只能保证单笔事务不穿插，不能保证应用与内核驱动对器件内部状态的假设互不破坏，所以已绑定驱动的外设不应被随意强制访问。

### 完整用户态程序：同一笔复合读取

```c title="完整教学文件 · i2c-read.c"
--8<-- "docs/B. 总线协议/B. 低速外设接口/code/B-B.3.3/i2c-read.c"
```

`struct i2c_rdwr_ioctl_data` 把消息数组地址和消息数交给 i2c-dev。这里每条 `msg.addr` 已指定 `0x50`，所以不需要另发 `I2C_SLAVE`。i2c-dev 在内核中分配缓冲区、复制消息，调用同一个 `i2c_transfer()`，读消息完成后再把数据复制回用户缓冲区。

v6.6 的 `i2cdev_ioctl_rdwr()` **直接返回 `i2c_transfer()` 的结果**。因此本例的返回值边界是：

- 内核 `i2c_transfer()` 完整成功返回 `2`；
- 用户态 `ioctl()` 也返回 `2`；失败时系统调用返回 `-1` 并设置 `errno`；
- 程序先检查 `ret < 0`，再检查 `ret != 2`，防止把短事务当成功；
- 真正的数据仍通过 `value` 返回，不是 `ioctl()` 的返回值 `2`。

构建、运行和输出检查如下：

```bash
make user CC=aarch64-linux-gnu-gcc

# 仅在目标总线、器件和驱动占用状态均已确认后运行
./i2c-read /dev/i2c-1 0x50 0x10
```

```text title="预期示例 · 非实测输出"
bus=/dev/i2c-1 chip=0x50 reg=0x10 value=0x5a
```

输出中的 `bus` 是本次打开的节点，`chip` 是 7 位器件地址，`reg` 是 AT24 内部偏移，`value` 是实际读回字节。若 `open()` 失败，先检查节点、权限和 adapter 是否存在；若 `ioctl()` 失败，再根据 `errno`、绑定状态和波形继续定位。通用工具与故障矩阵归 B-B.3.4。

---

## <span class="blue"> 替换控制器：GPIO 模拟 I2C 为什么不用改外设读取函数

这一节不是增加一颗 I2C 外设，而是替换 adapter 的 algorithm。`demo_read_reg()`、两条消息和 Core 都保持不变。

### DTS 只改总线实现及它下面的外设归属

```dts title="完整教学文件 · i2c-gpio-demo.dts"
--8<-- "docs/B. 总线协议/B. 低速外设接口/code/B-B.3.3/i2c-gpio-demo.dts"
```

`GPIO4_A0/A1` 只是语法示例，不是对任何板卡的引脚推荐。实际使用前必须根据原理图更换为空闲引脚，核对引脚复用、电源和外部上拉；两种控制器实验互斥，不能把同一颗物理外设同时描述到两条总线上。

### i2c-gpio：把 GPIO 回调装进 algorithm 所需的数据

```c title="Linux v6.6 · drivers/i2c/busses/i2c-gpio.c · 字段节选"
struct i2c_gpio_private_data {
    struct gpio_desc *sda;
    struct gpio_desc *scl;
    struct i2c_adapter adap;
    struct i2c_algo_bit_data bit_data;
    struct i2c_gpio_platform_data pdata;
    /* 故障注入字段省略 */
};
```

`i2c_gpio_probe()` 先申请开漏 GPIO，再填写位模拟回调：

```c title="Linux v6.6 · i2c_gpio_probe() · 有删节"
priv->sda = i2c_gpio_get_desc(dev, "sda", 0, gflags);
priv->scl = i2c_gpio_get_desc(dev, "scl", 1, gflags);

bit_data->setsda = i2c_gpio_setsda_val;
bit_data->setscl = i2c_gpio_setscl_val;
if (!pdata->scl_is_output_only)
    bit_data->getscl = i2c_gpio_getscl;
if (!pdata->sda_is_output_only)
    bit_data->getsda = i2c_gpio_getsda;

bit_data->udelay = pdata->udelay ? pdata->udelay : 5;
bit_data->timeout = pdata->timeout ? pdata->timeout : HZ / 10;
bit_data->data = priv;

adap->algo_data = bit_data;
adap->nr = pdev->id;
ret = i2c_bit_add_numbered_bus(adap);
```

`i2c_bit_add_numbered_bus()` 内部把 `adap->algo` 设置为 `i2c_bit_algo`，再注册 adapter。新的运行路线因此变成：

```text
demo_read_reg()
→ i2c_transfer()
→ i2c_bit_algo.master_xfer
→ i2c-algo-bit 逐位组织 START、数据、ACK、重复 START、STOP
→ setsda()/setscl()/getsda()/getscl()
→ gpiod_set_value_cansleep()/gpiod_get_value_cansleep()
```

### `setscl(1)` 只是放手，还要读回真正的高电平

v6.6 的 `sclhi()` 展示了为什么 `getscl` 不是多余字段：

```c title="Linux v6.6 · drivers/i2c/algos/i2c-algo-bit.c · 有删节"
setscl(adap, 1);             /* 释放 SCL，不等价于测得高电平 */
if (!adap->getscl)
    goto done;

start = jiffies;
while (!getscl(adap)) {
    if (time_after(jiffies, start + adap->timeout)) {
        if (getscl(adap))
            break;
        return -ETIMEDOUT;
    }
    cpu_relax();
}

done:
    udelay(adap->udelay);
    return 0;
```

外设可以暂时拉住 SCL，这就是时钟延展。只有读回 SCL 已经变高，位模拟算法才能继续。如果没有 `getscl`，驱动只能假设线已变高，源码会标记不支持时钟延展并发出不可靠警告。

GPIO 模拟证明了框架的替换边界，但不代表性能等价：逐位软件操作耗费 CPU，慢 GPIO 可能睡眠并破坏时序，`udelay` 也不能把调度抖动变成严格硬件实时保证。需要高速、稳定或原子上下文传输时，应优先使用硬件控制器；GPIO 模拟更适合低速调试、救急和没有可用控制器的场景。

---

## <span class="blue"> 收回主线：写、移植和修改时分别落在哪一层

沿同一笔读取，现在可以把代码放回正确位置：

1. **改变板上有哪些总线和外设**：修改板级 DTS，核对 `status`、地址、引脚和硬件事实；
2. **写一颗新 I2C 外设驱动**：从 `i2c_driver`、匹配表和 `probe(client)` 开始，用 `i2c_msg` 表达器件事务，不直接写 SoC 寄存器；
3. **移植到另一款 SoC**：外设消息保持不变，选择或移植对应 adapter/algorithm；
4. **修改 RK3568 控制器时序**：进入 `rk3x_i2c`、`i2c_timings`、分频、FIFO、中断和错误恢复；
5. **从用户态验证一笔事务**：使用 i2c-dev 创建的 `/dev/i2c-N`，确认匿名 client、`I2C_RDWR` 和返回值；
6. **没有可用硬件控制器**：用 i2c-gpio 提供另一条 adapter，但接受软件位模拟的时序和性能边界。

## <span class="blue"> 本节自检 Q&A

??? question "为什么 `client` 不是教学驱动自己分配的？"

    因为 DTS 子节点描述的是持久硬件事实。adapter 注册后，Core 先读取 `reg` 并调用 `i2c_new_client_device()` 创建 client，设备模型匹配成功后才把指针传给 `probe(client)`。教学驱动只使用这个对象；卸载驱动也不等于立即销毁整颗 Core 设备。

??? question "为什么是 `i2c->adap.algo`，而不是 `i2c->adap->algo`？"

    `i2c` 是指向 `struct rk3x_i2c` 的指针，所以第一段用 `->`；`adap` 是直接内嵌的 `struct i2c_adapter`，所以第二段用 `.`；`algo` 才是 adapter 内部指向 algorithm 的指针。这个表达式同时展示了包含关系和指针关系。

??? question "`I2C_M_RD` 和 `I2C_FUNC_I2C` 都是位标志，为什么不能互换？"

    前者属于一条消息的 `flags`，表示读方向；后者属于适配器能力位，表示支持普通 I2C 消息。一个描述“这次要做什么”，另一个描述“这条总线能做什么”。

??? question "`i2c_transfer()` 返回 2，为什么读到的数据不是 2？"

    返回值 `2` 表示完成了两条消息。读取的数据通过第二条消息的 `buf` 写入 `value`。教学函数再把传输结果转换为自身的 `0` 或负错误，避免把消息数、读取值和初始化结果混为一谈。

??? question "用户态 `ioctl(I2C_RDWR)` 在本例为什么也返回 2？"

    v6.6 的 `i2cdev_ioctl_rdwr()` 直接返回 `i2c_transfer()` 的结果。系统调用失败时用户看到 `-1` 和 `errno`；非负返回值仍需检查是否等于消息数，不能只凭非负就认定整组事务完成。

??? question "两个进程同时打开 `/dev/i2c-1`，会共用同一个匿名 client 吗？"

    不会。每次 `open()` 都创建独立的匿名 client，并保存到各自的 `file->private_data`。它们共享 adapter 和物理总线，所以 Core 用总线锁串行化事务；消息数组和用户缓冲区仍然各自独立。

??? question "`/dev/i2c-1` 与 `1-0050/eeprom` 是同一个框架自动创建的两种名字吗？"

    不是。前者由 i2c-dev 监听 adapter 注册并调用 `cdev_device_add()` 创建，是总线入口；后者由 at24 经 NVMEM 在具体 client 上创建，是 EEPROM 外设入口。未绑定 at24 时可以有前者和 `1-0050` 设备目录，却没有 `eeprom` 文件。

??? question "换成 GPIO 模拟后，为什么 `demo_read_reg()` 不需要修改？"

    因为它只依赖 client、adapter、消息和 `i2c_transfer()`。i2c-gpio 在 adapter 内安装另一套 `i2c_bit_algo`，由位模拟算法调用 GPIO 回调实现相同的消息语义。改变的是总线实现，不是 AT24 的内部偏移和读取顺序。

---

## <span class="blue"> 核验边界

本篇的结构体、宏、函数和返回语义已按 Linux v6.6 的 `include/uapi/linux/i2c.h`、`include/linux/i2c.h`、`i2c-core-of.c`、`i2c-core-base.c`、`i2c-dev.c`、`i2c-rk3x.c`、`i2c-gpio.c`、`i2c-algo-bit.c` 核对。第 11、12 章的前置链接也已检查其现有内容。

原创教学 DTS、内核模块和用户程序只是源码级核验，**尚未完成交叉编译、部署、运行和上板验证**；交互实验室展示的是源码模型，不是硬件仿真器或实测记录。
