# B-B.3.3 I2C Linux 驱动框架与 SMBus

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线
>
> 难度：[I] Intermediate | 预计阅读时间：35 分钟

## <span class="blue"> 本节导读

物理层和协议层讲清了总线上的电信号，本节进入软件：Linux 如何组织 I2C 的驱动代码。I2C 子系统把代码切成三层：核心层、控制器驱动层、设备驱动层。日常开发绝大多数时间只在设备驱动层工作，其余两层分别由内核和 SoC 厂商交付。本节还会讲清 SMBus：它不是另一套系统，而是 I2C 的受限子集，内核里直接复用 I2C 框架。

本节覆盖：I2C 子系统三层架构与关键结构体、设备树 I2C 节点写法、核心 API 选型（`i2c_transfer` vs `i2c_smbus_*`）、驱动注册匹配流程、SMBus 与 I2C 的差异及应用场景、`/dev/i2c-x` 用户态接口、I2C GPIO 扩展器。

---

## <span class="blue"> 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│  用户空间：/dev/i2c-1（i2c-dev）   /sys/bus/i2c/devices/     │
├─────────────────────────────────────────────────────────────┤
│  Client 层（设备驱动）：at24 / tmp102 / pca953x ...          │
│      struct i2c_driver { probe, remove, of_match_table }    │
├─────────────────────────────────────────────────────────────┤
│  Core 层：drivers/i2c/i2c-core-*.c                          │
│      i2c_transfer() / i2c_smbus_*() / 注册与匹配             │
├─────────────────────────────────────────────────────────────┤
│  Adapter 层（控制器驱动）：drivers/i2c/busses/               │
│      struct i2c_adapter → i2c_algorithm → master_xfer()     │
├─────────────────────────────────────────────────────────────┤
│  硬件：SoC I2C 控制器（RK3568: i2c@fe5a0000 等 6 路）         │
└─────────────────────────────────────────────────────────────┘
```

| 层级 | 职责 | 关键结构体 | 内核路径 |
|------|------|-----------|----------|
| Core | 统一 API、adapter/client 注册匹配 | 无（纯逻辑层） | `drivers/i2c/i2c-core-*.c` |
| Adapter | 驱动 SoC 的 I2C 控制器 | `i2c_adapter` / `i2c_algorithm` | `drivers/i2c/busses/` |
| Client | 驱动具体外设（EEPROM、传感器） | `i2c_client` / `i2c_driver` | `drivers/` 各子系统目录 |

为什么要切三层？因为总线的两端住着两个互不知情的世界：SoC 厂商只知道自己芯片上的 I2C 控制器怎么打波形，不知道板子上会挂什么外设；外设厂商只知道自家芯片的寄存器怎么读写，不知道会被焊到哪家的 SoC 上。Core 层是两边之间的翻译与登记处：对上给设备驱动一套统一 API，对下管理所有 Adapter，让任意设备驱动能跑在任意控制器上。各层的交付方也由此确定：Adapter 层由 SoC 厂商随内核提供，Client 层由设备驱动作者编写，Core 层由内核维护，三方各写各的、互不感知。

> 💡 Adapter 层由 SoC 厂商提供（RK3568 是 `i2c-rk3x.c`），除非移植新平台，不需要碰。写驱动打交道的是 Client 层；不写驱动、只做应用的话，连 Client 层都不用碰，直接用 `/dev/i2c-x`。

### 关键结构体

```c
/* 控制器（Adapter）：一个 SoC I2C 控制器对应一个实例，nr 即 /dev/i2c-N 的 N */
struct i2c_adapter {
    const struct i2c_algorithm *algo;   /* 总线操作方法集 */
    int nr;                             /* 总线编号 */
    struct device dev;
    ...
};

/* 操作方法集：真正收发波形的函数 */
struct i2c_algorithm {
    int (*master_xfer)(struct i2c_adapter *, struct i2c_msg *, int);
    int (*smbus_xfer)(...);             /* SMBus 可选快速路径 */
    u32 (*functionality)(struct i2c_adapter *);   /* 能力查询 */
};

/* 设备（Client）：挂在总线上的一个从设备 */
struct i2c_client {
    unsigned short addr;                /* 7 位从机地址 */
    struct i2c_adapter *adapter;        /* 所属总线 */
    int irq;                            /* 可选中断 */
    struct device dev;
    ...
};

/* 设备驱动 */
struct i2c_driver {
    int (*probe)(struct i2c_client *, const struct i2c_device_id *);
    void (*remove)(struct i2c_client *);
    struct device_driver driver;        /* 内含 of_match_table */
    const struct i2c_device_id *id_table;
};
```

四个结构体要连起来看，关键是"谁创建、谁填写"。`i2c_adapter` 由控制器驱动在初始化时注册，代表一条物理总线；`i2c_client` 由内核解析设备树时为每个启用的子节点创建，代表挂在总线上的一个从设备，你只描述、不分配；`i2c_driver` 是驱动作者真正动手写的部分，描述"这个设备怎么驱动"；`i2c_msg` 由每次传输临时组装，是收发的最小单元。一条读写路径因此是：`i2c_driver` 为某个 `i2c_client` 组好 `i2c_msg`，交给 Core，Core 找到该 client 所在的 `i2c_adapter`，调它的 `master_xfer()` 把波形打出去。

---

## <span class="blue"> 设备树节点写法

以 RK3568 为例，SoC 的 `rk356x.dtsi` 已定义控制器节点：

```dts
/* rk356x.dtsi 中已有 */
i2c1: i2c@fe5a0000 {
    compatible = "rockchip,rk3568-i2c", "rockchip,rk3399-i2c";
    reg = <0x0 0xfe5a0000 0x0 0x1000>;
    interrupts = <GIC_SPI 47 IRQ_TYPE_LEVEL_HIGH>;
    clocks = <&cru CLK_I2C1>, <&cru PCLK_I2C1>;
    ...
    status = "disabled";        /* 默认关闭，板级 dts 打开 */
};
```

`reg` 里的 0xfe5a0000 不是谁配置出来的，而是 Rockchip 设计 SoC 时给 I2C1 控制器分配的寄存器物理基地址，固化在芯片硬件里：CPU 按这个地址读写，访问的就是 I2C1 控制器的寄存器组，末尾的 0x1000 是这组寄存器占用的地址空间长度。这个值由厂商写进 dtsi 随内核发布，软件照抄即可，板级 dts 用 `&i2c1` 引用节点，不要自创地址。

板级 dts 中的典型配置：

```dts
&i2c1 {
    status = "okay";
    clock-frequency = <400000>;         /* 默认 100k，可提 Fast-mode */

    eeprom@50 {
        compatible = "atmel,24c02";
        reg = <0x50>;                   /* 7 位从机地址 */
        pagesize = <8>;                 /* AT24C02 页大小 8 字节（1K/2K 为 8，4K 起为 16） */
    };

    tmp102@48 {
        compatible = "ti,tmp102";
        reg = <0x48>;
    };
};
```

要点：`reg` 是 7 位地址（与 B-B.3.2 的约定一致）；子节点的单元地址（`@50`）必须与 `reg` 一致；`clock-frequency` 按总线上最慢设备定（回看 B-B.3.1）；`pagesize` 按器件手册填，写错会导致 at24 驱动切分写入时跨页回卷、数据错位（页写机制在 B-B.3.5 实测）。

---

## <span class="blue"> 核心 API 与选型

### 一次传输的基本单元：i2c_msg

```c
struct i2c_msg {
    __u16 addr;      /* 7 位从机地址 */
    __u16 flags;     /* I2C_M_RD 表示读方向 */
    __u16 len;
    __u8 *buf;
};
```

一次 `i2c_transfer()` 传一个 `i2c_msg` 数组，内核自动在相邻消息间生成 Repeated START（B-B.3.2 的复合消息在软件中的落地）。

### API 速查

| 函数 | 用途 |
|------|------|
| `i2c_transfer(adap, msgs, num)` | 通用传输，多 msg 复合，长度自由 |
| `i2c_master_send/recv(client, buf, n)` | 简单发/收 |
| `i2c_smbus_read/write_byte_data(client, cmd, val)` | 读/写寄存器单字节（cmd = 寄存器地址） |
| `i2c_smbus_read/write_word_data(client, cmd, val)` | 读/写寄存器 16 位 |
| `i2c_smbus_read/write_i2c_block_data(client, cmd, len, buf)` | 块读写（≤32 字节） |
| `i2c_check_functionality(adap, I2C_FUNC_*)` | 查询控制器能力 |

### 选型原则

| 场景 | 选择 |
|------|------|
| 标准"寄存器地址 + 数据"读写 | `i2c_smbus_*_byte/word_data`，代码短、出错率低 |
| 复合消息（写寄存器地址再读、EEPROM 页读） | `i2c_transfer()` 多 msg |
| 超过 32 字节的传输 | 必须 `i2c_transfer()`，SMBus 块传输硬上限 32 字节 |
| probe 阶段 | 先 `i2c_check_functionality()` 确认控制器能力，不支持就早返回 `-EIO` |

> 💡 `i2c_smbus_*` 系列在底层最终也是组装成 `i2c_msg` 走 `master_xfer`（除非控制器提供原生 `smbus_xfer`）。两者不是并列的两套硬件路径，是同一框架上的便利封装。

---

## <span class="blue"> 驱动注册与匹配流程

```
① 内核解析设备树 → 为每个 okay 的子节点创建 i2c_client（addr 取自 reg）
② 驱动调用 module_i2c_driver() 注册 i2c_driver
③ Core 用 of_match_table 的 compatible 匹配 client → 成功则调 probe()
④ probe()：check_functionality → 初始化设备 → 注册上层接口
   （字符设备 / sysfs / hwmon / input，按设备类型）
⑤ 运行期：驱动内调 i2c_transfer / i2c_smbus_* 与硬件收发
⑥ 卸载：remove() 注销资源（devm_* 分配的自动释放）
```

流程里有两步值得点透。第 ① 步的创建者是内核而不是驱动：内核启动时解析设备树，为 `status = "okay"` 的 I2C 子节点各创建一个 `i2c_client`，`reg` 里的 7 位地址填进 client 的 addr 字段，这发生在任何设备驱动运行之前。第 ③ 步的匹配者是 Core：它拿 client 对应节点的 compatible 字符串，逐个比对已注册 `i2c_driver` 的 of_match_table，命中才把 client 交给该驱动的 probe()。到这一步设备才"有了驱动"，probe 里才能开始收发。

probe/remove 的完整代码写法属于驱动专题内容，本篇不展开：框架级理解到这里足够，知道设备树节点如何变成 `i2c_client`、驱动如何被匹配调用、读写最终落到哪几个 API。

> 💡 螺旋衔接：匹配机制是第 11 章设备模型 bus-device-driver 三角在 I2C 总线上的实例；probe 内部五步模板与完整驱动工程写法见 D 扩展驱动专题；B-B.3.5 实战篇会展示"内核已有 at24 驱动时连 probe 都不用写"的真实场景。

---

## <span class="blue"> SMBus：I2C 的受限子集

SMBus（System Management Bus）是 Intel 1995 年基于 I2C 定义的协议：**物理层同一套两线开漏上拉，协议层加了约束**。它与 I2C 的关系类似"方言"：SMBus 设备可以挂在 I2C 总线上，内核没有独立的 SMBus 子系统，`i2c_smbus_*` API 就跑在 I2C 框架上。

### 与 I2C 的差异

| 维度 | I2C | SMBus |
|------|-----|-------|
| 速率 | 100k~3.4M | 10k~100k |
| 时钟低超时 | 无强制 | **35 ms 硬限制**，超时必须释放总线 |
| 协议格式 | 自由字节流 | 固定命令集（Quick/Byte/Word/Block…） |
| 校验 | 无 | 可选 PEC（CRC-8） |
| 块传输 | 协议无上限 | Block ≤32 字节 |
| 中断 | 无规定 | 可选 SMBALERT# 专线 |

六条约束各有它要解决的问题。限低速率：管理总线上挂的都是廉价小芯片，低速换取实现简单与稳定。35 ms 时钟低超时：管理面不允许任何设备把总线拖死，从设备延展超过 35 ms 就被判故障、必须释放总线，这是 B-B.3.2 时钟延展死锁在协议层的解法。固定命令集：BIOS、BMC 这类通用管理方不用读懂每颗芯片的私有寄存器表，按标准命令就能交互，换来互操作性。PEC（Packet Error Checking，包错误校验）：管理命令错一个字节可能设错电压，SMBus 允许在帧尾附一个 CRC-8 校验字节防呆。Block 32 字节上限：与固定命令集配套，块传输的 Count 字段和缓冲区都按小数据量设计。SMBALERT#：一根可选的独立告警线，让从设备有事时能主动通知主设备，否则主设备只能定时轮询，温度、电源类器件常用。

### 固定命令集与内核 API 对应

```
Write Byte ：[S][Addr+W][A][Cmd][A][Data][A][P]                     → i2c_smbus_write_byte_data()
Read Byte  ：[S][Addr+W][A][Cmd][A][Sr][Addr+R][A][Data][N][P]      → i2c_smbus_read_byte_data()
Write Word ：[S][Addr+W][A][Cmd][A][DataL][A][DataH][A][P]          → i2c_smbus_write_word_data()
Read Word  ：[S][Addr+W][A][Cmd][A][Sr][Addr+R][A][DataL][A][DataH][N][P] → i2c_smbus_read_word_data()
Block Read ：[S][Addr+W][A][Cmd][A][Sr][Addr+R][A][Count][A][Data…][N][P]   → i2c_smbus_read_block_data()
```

Cmd 即命令字，在多数器件里就是寄存器地址。注意读类命令的形态：都是 B-B.3.2 讲过的重复 START 复合消息，先写 Cmd 定位、再换方向读回，末尾 NACK 收尾；PEC 若启用则附加在数据之后。

### 应用场景

PC 与服务器领域几乎全是 SMBus 的地盘：内存条 SPD 信息、笔记本智能电池（Smart Battery）、主板温度监控；服务器电源管理用的 PMBus 是 SMBus 的再扩展。做服务器/PCIe 卡类产品会实际碰到；做消费类嵌入式则主要是"传感器驱动里那些 `i2c_smbus_*` 调用"的间接接触。

> ⚠️ SMBus Block 读写硬上限 32 字节。读 EEPROM 一页（64 字节）这类需求不能用 `i2c_smbus_read_block_data()`，要用 `i2c_transfer()` 构造"写地址 + 读数据"两条 msg，长度自由。

> ⚠️ 35 ms 时钟低超时是硬规定。从设备时钟延展超过 35 ms，SMBus 控制器会中止传输，调试带长内部写周期的器件时留意。

### PMBus：服务器电源管理的标配

PMBus（Power Management Bus）是 SMBus 在电源领域的再扩展：物理层、传输格式完全沿用 SMBus，**在上面定义了一整套电源管理命令集**：输出电压/电流/温度的读取与设定、裕量调节（margining）、故障状态字、上下电时序控制。服务器、交换机、PCIe 加速卡上的多相 VRM（电压调节模块）和热插拔控制器，管理接口几乎清一色是 PMBus。

命令集按页组织：`PAGE` 命令选择监控哪一路电源轨（一张卡上 12V 主供电、核心电压、DDR 电压各占一页），然后 `READ_VOUT`、`READ_IOUT`、`READ_TEMPERATURE_1` 读出该页的实时值，`STATUS_WORD` 读故障位。数据编码多为 LINEAR11 格式（5 位指数 + 11 位尾数的浮点），驱动负责换算成毫伏/毫安。

```
主机 → PAGE(轨号) → READ_VOUT → 返回 LINEAR11 编码 → 驱动换算 → hwmon 上报毫伏
```

Linux 侧，PMBus 设备走 `drivers/hwmon/pmbus/` 目录的通用框架，主流 VRM 芯片（TI TPS 系列、Infineon IR 系列、ADI LTC 系列）各有小驱动挂在框架上，probe 成功后传感器值出现在标准 hwmon 节点（`/sys/class/hwmon/hwmonN/in1_input` 等），`sensors` 命令直接可读。做服务器或 PCIe 卡产品时，BMC/带外管理对板卡电源的监控链路就是这条：VRM → PMBus → 内核 pmbus 驱动 → hwmon → 管理固件。

> 💡 排查 PMBus 设备与排查普通 I2C 设备用同一套工具：`i2cdetect` 扫地址（VRM 常见 0x40~0x5F 段），`i2cget` 裸读命令字。区别只在数据解释：读回的两个字节要按 LINEAR11 解码才是电压值，直接当整数看会得到莫名其妙的数。

---

## <span class="blue"> 用户态接口 /dev/i2c-x

不写内核驱动也能用 I2C：内核的 i2c-dev 模块把每个 Adapter 导出为 `/dev/i2c-N` 字符设备，用户态通过 `open` + `ioctl(I2C_SLAVE)` + `read/write` 直接收发。

```
应用 → /dev/i2c-1 → i2c-dev → I2C Core → Adapter → 硬件
```

i2c-tools 四件套（`i2cdetect`/`i2cget`/`i2cset`/`i2cdump`）全部走这个接口。适用边界：

| 适合 | 不适合 |
|------|--------|
| 原型验证、产线测试、寄存器级调试 | 有中断需求的设备 |
| 慢速、低频的配置类访问 | 高吞吐或时序敏感场景 |
| 没有现成内核驱动的新器件评估 | 需要被多个应用共享的设备（无并发管理） |

工具细节与完整排查流程见 B-B.3.4；`/dev/i2c` 的代码级用法在 B-B.3.5 实战篇落地。

---

## <span class="blue"> I2C GPIO 扩展器

讲完框架看一个完整的 Client 层样本：I2C GPIO 扩展器。前面每一环它都用上了：设备树声明节点，pca953x 这类现成驱动被匹配 probe，probe 里向内核注册 gpiochip（GPIO 控制器在内核 GPIO 子系统中的抽象，注册后获得一段标准 GPIO 编号），上层于是像用 SoC 原生 GPIO 一样使用扩展出来的引脚。SoC 原生 GPIO 不够用时，用两根线扩出 8/16 个 GPIO 靠的就是这套机制。

| 型号 | 位数 | 驱动 | 特点 |
|------|------|------|------|
| PCF8574 | 8 | `gpio-pcf857x` | 最简单，准双向（见下） |
| PCA9535/9555 | 16 | `gpio-pca953x` | 真双向，独立方向寄存器 |
| MCP23017 | 16 | `gpio-mcp23s08` | 带中断输出引脚 |

准双向直接决定软件写法，必须解释：PCF8574 没有独立的方向寄存器，输出高电平实际靠内部弱上拉实现，所以读某个引脚前必须先向该位写 1（放手），否则引脚被驱动在低电平，读到的永远是 0。PCA9535/MCP23017 有独立方向寄存器，先配方向再读写，与原生 GPIO 的使用习惯一致。

选型决策点只有一个：**扩展的 GPIO 需要中断吗**：需要就选带 INT 引脚的型号（MCP23017），否则 PCA9535 性价比最高。设备树中声明 `gpio-controller` + `#gpio-cells = <2>` 后即可被其他节点以 `<&pca9535 6 GPIO_ACTIVE_LOW>` 方式引用。

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| `i2c_smbus_*` | 代码短、语义明确；代价是 32 字节块上限、格式受限 |
| `i2c_transfer()` | 完全自由、支持复合消息；代价是代码量大、要自己处理 ACK 错误 |
| `/dev/i2c` 用户态 | 零驱动开发、验证快；代价是无中断、无并发管理、性能低 |
| GPIO 扩展器 | 两根线换 16 个 IO；代价是 I2C 延迟（百微秒级）、中断经扩展器转发更慢 |
| 提频 400 kHz | 吞吐 ×4；代价是受总线电容与最慢设备约束（B-B.3.1） |

---

## <span class="blue"> 排障速查

| 症状 | 根因 | 定位动作 |
|------|------|----------|
| probe 直接失败，client 地址错误 | 设备树 `reg` 写了 8 位地址（0xA0） | 设备树与代码统一用 7 位地址（0x50） |
| 第一次读写才报 `-EIO`，定位困难 | 跳过 `i2c_check_functionality()`，控制器能力不满足 | probe 第一步先查能力，不支持早返回 |
| 块读超过 32 字节直接失败 | SMBus Block 协议硬上限 | 长数据改 `i2c_transfer()` 多 msg，长度自由 |
| 设备树自检报警、地址错位 | 子节点单元地址与 `reg` 不一致（`@50` 配 `<0x51>`） | 两者必须一致；内核按 `reg` 创建 client |
| `/dev/i2c` 访问被拒绝或行为异常 | 地址已被内核驱动绑定（`i2cdetect` 显示 `UU`） | 优先走内核驱动；确需绕开用 `I2C_SLAVE_FORCE`（强制绑定已被占用的地址，会与该驱动并发访问同一设备，仅限临时调试） |
| hwmon 读出的电压是莫名其妙的数 | PMBus 数据是 LINEAR11 编码，被当整数读 | 走 pmbus 驱动换算；裸读时按 LINEAR11 手工解码 |

---

## <span class="blue"> 本节总结

I2C 子系统的三层切分回答了一个工程问题：让 SoC 厂商、设备厂商、内核维护者各写各的代码而互不感知。Adapter 层由 SoC 厂商交付，Client 层由设备驱动作者交付，Core 层把两边粘起来，所以日常开发的真实形状是：设备树里加一个子节点描述硬件，驱动里写一个 `i2c_driver` 描述行为，匹配交给 Core。连驱动都不想写的时候，`/dev/i2c-x` 把同一套总线直接递给用户态，代价是中断、并发和性能。

SMBus 一节记住"受限子集"四个字就不会迷路：同一套两线开漏，协议上砍掉高速率、加上 35 ms 超时和固定命令集，换来管理类设备的互操作性。PMBus 则是这套方言在服务器电源领域的行业标准：做服务器或 PCIe 卡产品时，电压电流温度的带外监控链路就是 VRM → PMBus → pmbus 驱动 → hwmon，这是它和消费类嵌入式最实际的交点。

**速查表**

| 项 | 要点 |
|----|------|
| 三层架构 | Core（`i2c-core-*`）/ Adapter（`busses/`，SoC 厂商）/ Client（设备驱动） |
| 结构体 | adapter=控制器、client=设备、driver=驱动、msg=传输单元 |
| 设备树 | `reg`=7 位地址、单元地址与 reg 一致、`clock-frequency` 按最慢设备 |
| API 选型 | 寄存器读写用 `i2c_smbus_*`；复合消息/超 32 字节用 `i2c_transfer()` |
| 注册流程 | 设备树 → client → of_match 匹配 → probe（先查 functionality） |
| SMBus | I2C 受限子集：10~100k、35 ms 超时、固定命令集、PEC、Block ≤32B |
| PMBus | SMBus + 电源命令集；PAGE 选轨、READ_VOUT/IOUT；LINEAR11 编码；hwmon 上报 |
| 用户态 | `/dev/i2c-N` + `I2C_SLAVE`；无中断无并发；`UU`=已被内核驱动绑定 |
| 扩展器 | 中断需求决定选型（MCP23017 带 INT）；注册为标准 gpiochip |

**本节自查**

1. 三层架构中，设备驱动作者日常只写哪一层？另外两层各由谁交付？
2. 设备树 `reg = <0xA0>` 会导致什么后果？正确写法是什么？
3. 什么场景必须用 `i2c_transfer()` 而不能用 `i2c_smbus_read_block_data()`？
4. SMBus 相对 I2C 加了哪三条硬约束？分别解决什么问题？
5. PMBus 的 `PAGE` 命令起什么作用？`READ_VOUT` 读回的字节为什么不能直接当整数用？
6. `i2cdetect` 某地址显示 `UU`，此时用 `/dev/i2c` 访问该地址会发生什么？

---

## <span class="blue"> 下一步

框架理解之后是动手验证：**B-B.3.4 I2C 调试工具与故障排查**，讲 i2c-tools 四件套逐项用法、逻辑分析仪抓包解码、从"扫不到设备"到"数据错乱"的统一排查流程。随后 **B-B.3.5 实战篇**用 AT24C02 把物理层到用户态代码端到端走一遍。

> 💡 螺旋衔接：本篇的 compatible 匹配机制回看第 11 章设备模型；完整驱动工程写法（probe 五步、错误处理、并发）在 D 扩展驱动专题；SMBus 命令集的帧格式可在 B-B.3.2 的时序图上逐字节对照。
