# B-A.2.3 I2C Linux 驱动框架与 SMBus

> 所属章节：第五部 B. 总线协议 > B-A.2 I2C 总线
>
> 难度：[I] Intermediate | 预计阅读时间：35 分钟

## <span class="blue"> 本节导读

物理层和协议层讲清了总线上的电信号，本节进入软件：Linux 如何组织 I2C 的驱动代码。I2C 子系统把代码切成三层——核心层、控制器驱动层、设备驱动层——开发者 99% 的时间只在设备驱动层工作。本节还会讲清 SMBus：它不是另一套系统，而是 I2C 的受限子集，内核里直接复用 I2C 框架。

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

Core 是中间层：对上给设备驱动统一 API，对下管理所有 Adapter。设备驱动不关心底层是哪家的控制器，Adapter 不关心上面挂了什么设备。

> 💡 Adapter 层由 SoC 厂商提供（RK3568 是 `i2c-rk3x.c`），除非移植新平台，不需要碰。写驱动打交道的是 Client 层；不写驱动、只做应用的话，连 Client 层都不用碰——直接用 `/dev/i2c-x`。

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

板级 dts 中的典型配置：

```dts
&i2c1 {
    status = "okay";
    clock-frequency = <400000>;         /* 默认 100k，可提 Fast-mode */

    eeprom@50 {
        compatible = "atmel,24c02";
        reg = <0x50>;                   /* 7 位从机地址 */
        pagesize = <16>;
    };

    tmp102@48 {
        compatible = "ti,tmp102";
        reg = <0x48>;
    };
};
```

要点：`reg` 是 7 位地址（与 B-A.2.2 的约定一致）；子节点的单元地址（`@50`）必须与 `reg` 一致；`clock-frequency` 按总线上最慢设备定（回看 B-A.2.1）。

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

一次 `i2c_transfer()` 传一个 `i2c_msg` 数组，内核自动在相邻消息间生成 Repeated START（B-A.2.2 的复合消息在软件中的落地）。

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

probe/remove 的完整代码写法属于驱动专题内容，本篇不展开——框架级理解到这里足够：知道设备树节点如何变成 `i2c_client`、驱动如何被匹配调用、读写最终落到哪几个 API。

> 💡 螺旋衔接：匹配机制是第 11 章设备模型 bus-device-driver 三角在 I2C 总线上的实例；probe 内部五步模板与完整驱动工程写法见 D 扩展驱动专题；B-A.2.5 实战篇会展示"内核已有 at24 驱动时连 probe 都不用写"的真实场景。

---

## <span class="blue"> SMBus：I2C 的受限子集

SMBus（System Management Bus）是 Intel 1995 年基于 I2C 定义的协议——**物理层同一套两线开漏上拉，协议层加了约束**。它与 I2C 的关系类似"方言"：SMBus 设备可以挂在 I2C 总线上，内核没有独立的 SMBus 子系统，`i2c_smbus_*` API 就跑在 I2C 框架上。

### 与 I2C 的差异

| 维度 | I2C | SMBus |
|------|-----|-------|
| 速率 | 100k~3.4M | 10k~100k |
| 时钟低超时 | 无强制 | **35 ms 硬限制**，超时必须释放总线 |
| 协议格式 | 自由字节流 | 固定命令集（Quick/Byte/Word/Block…） |
| 校验 | 无 | 可选 PEC（CRC-8） |
| 块传输 | 协议无上限 | Block ≤32 字节 |
| 中断 | 无规定 | 可选 SMBALERT# 专线 |

### 固定命令集与内核 API 对应

```
Read/Write Byte : S|Addr|Cmd|Data|P          → i2c_smbus_*_byte_data()
Read/Write Word : S|Addr|Cmd|DataL|DataH|P   → i2c_smbus_*_word_data()
Block Read      : S|Addr|Cmd|Count|Data…|PEC|P → i2c_smbus_read_block_data()
```

### 应用场景

PC 与服务器领域几乎全是 SMBus 的地盘：内存条 SPD 信息、笔记本智能电池（Smart Battery）、主板温度监控；服务器电源管理用的 PMBus 是 SMBus 的再扩展。做服务器/PCIe 卡类产品会实际碰到；做消费类嵌入式则主要是"传感器驱动里那些 `i2c_smbus_*` 调用"的间接接触。

> ⚠️ SMBus Block 读写硬上限 32 字节。读 EEPROM 一页（64 字节）这类需求不能用 `i2c_smbus_read_block_data()`，要用 `i2c_transfer()` 构造"写地址 + 读数据"两条 msg，长度自由。

> ⚠️ 35 ms 时钟低超时是硬规定。从设备时钟延展超过 35 ms，SMBus 控制器会中止传输——调试带长内部写周期的器件时留意。

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

工具细节与完整排查流程见 B-A.2.4；`/dev/i2c` 的代码级用法在 B-A.2.5 实战篇落地。

---

## <span class="blue"> I2C GPIO 扩展器

SoC 原生 GPIO 不够用时，I2C GPIO 扩展器用两根线扩出 8/16 个 GPIO，在 Linux 中注册为标准 gpiochip，对上层与普通 GPIO 无异。

| 型号 | 位数 | 驱动 | 特点 |
|------|------|------|------|
| PCF8574 | 8 | `gpio-pcf857x` | 最简单，准双向 |
| PCA9535/9555 | 16 | `gpio-pca953x` | 真双向，独立方向寄存器 |
| MCP23017 | 16 | `gpio-mcp23s08` | 带中断输出引脚 |

选型决策点只有一个：**扩展的 GPIO 需要中断吗**——需要就选带 INT 引脚的型号（MCP23017），否则 PCA9535 性价比最高。设备树中声明 `gpio-controller` + `#gpio-cells = <2>` 后即可被其他节点以 `<&pca9535 6 GPIO_ACTIVE_LOW>` 方式引用。

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| `i2c_smbus_*` | 代码短、语义明确；代价是 32 字节块上限、格式受限 |
| `i2c_transfer()` | 完全自由、支持复合消息；代价是代码量大、要自己处理 ACK 错误 |
| `/dev/i2c` 用户态 | 零驱动开发、验证快；代价是无中断、无并发管理、性能低 |
| GPIO 扩展器 | 两根线换 16 个 IO；代价是 I2C 延迟（百微秒级）、中断经扩展器转发更慢 |
| 提频 400 kHz | 吞吐 ×4；代价是受总线电容与最慢设备约束（B-A.2.1） |

---

## <span class="blue"> 常见陷阱

> ⚠️ 设备树 `reg` 写 8 位地址。`reg = <0xA0>` 会让 client 地址变成错误值，probe 直接失败。设备树与代码统一用 7 位地址。

> ⚠️ 跳过 `i2c_check_functionality()`。控制器不支持所需 SMBus 操作时，错误推迟到第一次读写才以 `-EIO` 爆发，定位成本高。probe 第一步先查能力。

> ⚠️ 用 SMBus Block 读超过 32 字节。协议硬上限，超限直接失败。长数据用 `i2c_transfer()` 多 msg。

> ⚠️ 子节点单元地址与 `reg` 不一致（`eeprom@50` 配 `reg = <0x51>`）。内核创建 client 用 `reg`，地址错位且设备树自检工具会报警。

> ⚠️ 用户态与内核驱动抢设备。内核驱动已绑定（`i2cdetect` 显示 `UU`）的地址，`/dev/i2c` 再 `I2C_SLAVE` 会被拒绝或行为异常。调试用 `I2C_SLAVE_FORCE` 要清楚自己在绕开内核驱动。

---

## <span class="blue"> 动手练习

1. **结构观察**：在开发板上执行 `ls /sys/bus/i2c/devices/` 与 `ls /sys/class/i2c-adapter/`，对照三层架构图，确认本板有几路 Adapter、各挂了哪些 Client。
2. **设备树比对**：打开板级 dts，找一个 I2C 子节点，核对 `compatible`、`reg`、单元地址三者关系；再到 `/proc/device-tree/` 下确认该节点已实例化。
3. **能力查询**：用 `i2cdetect -F <bus>` 查看控制器 `functionality` 支持列表，理解 probe 里 `i2c_check_functionality()` 查的是什么。
4. **无硬件后备**：阅读内核源码 `drivers/i2c/i2c-core-base.c` 中 `i2c_register_adapter()` 与设备树 client 实例化路径（`of_i2c_register_devices`），把"设备树节点 → i2c_client"这条链走通。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 三层架构 | Core / Adapter / Client 分工与内核路径 |
| 结构体 | adapter=控制器、client=设备、driver=驱动、msg=传输单元 |
| 设备树 | `reg` 为 7 位地址、单元地址一致、`clock-frequency` 按最慢设备 |
| API 选型 | smbus 系列 vs `i2c_transfer` 的边界（32 字节、复合消息） |
| 注册流程 | 设备树 → client → compatible 匹配 → probe |
| SMBus | I2C 受限子集：35 ms 超时、固定命令集、PEC、32 字节上限 |
| 用户态 | /dev/i2c 的适用边界与 UU 冲突 |
| 扩展器 | 中断需求决定选型；注册为标准 gpiochip |

---

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/i2c/`（`writing-clients.rst`、`smbus-protocol.rst`）
- **内核源码**：`drivers/i2c/i2c-core-base.c`、`drivers/i2c/busses/i2c-rk3x.c`（RK3568 控制器驱动）
- **绑定文档**：`Documentation/devicetree/bindings/i2c/`

---

## <span class="blue"> 下一步

框架理解之后是动手验证：**B-A.2.4 I2C 调试工具与故障排查**——i2c-tools 四件套逐项用法、逻辑分析仪抓包解码、从"扫不到设备"到"数据错乱"的统一排查流程。随后 **B-A.2.5 实战篇**用 AT24C02 把物理层到用户态代码端到端走一遍。

> 💡 螺旋衔接：本篇的 compatible 匹配机制回看第 11 章设备模型；完整驱动工程写法（probe 五步、错误处理、并发）在 D 扩展驱动专题；SMBus 命令集的帧格式可在 B-A.2.2 的时序图上逐字节对照。
