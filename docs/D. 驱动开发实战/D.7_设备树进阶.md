# D.7 设备树进阶

> 所属：扩展篇 D. 驱动开发实战 > Part 1 通用写法线
>
> 难度：[E] | 预计阅读时间：30 分钟
>
> 与第7/11章的分工：7.4 与 11.3 讲设备树的解析与翻译机制（unflatten、platform_device 生成、reg/interrupts 翻译），11.4 讲 compatible 匹配原理与绑定规范的概念；本篇讲驱动作者视角的实战——`of_property_read` 全家桶的正确用法、为自己芯片设计 binding 的规范、资源编排的获取使能时序。

## <span class="blue"> 本节导读

走到 D.6，TS502 驱动功能已经完整，但配置全是代码里的常量：报警阈值写死、默认采样率写死、INT 脚连哪个 GPIO 也写死。换一块板子（阈值不同、INT 换了引脚）就要改代码重编译——硬件事实放在了错误的地方。本篇把它们全部搬进设备树。<BR>
本节覆盖：`of_property_read` 全家桶的用法与返回值语义、TS502 完整设备树节点与 probe 读取代码、自定义 binding 的三条设计规范（硬件事实进 DT vs 软件策略写死、compatible 命名、deprecated 演进）、资源编排时序（reg→映射、interrupts→IRQ、clocks/resets/pinctrl 的获取使能顺序，互链 11.3.5 排查树）。

---

## <span class="blue"> of_property_read 全家桶 [E]

设备树节点到了驱动手里是 `device->of_node`（`struct device_node *`），读属性的一组 API 语义各异：

| API | 用途 | 返回值语义 |
|---|---|---|
| `of_property_read_u32(np, "x", &v)` | 单个整数 | 0 成功；负值失败（属性不存在是 -EINVAL） |
| `of_property_read_string(np, "x", &s)` | 单个字符串 | 同上 |
| `of_property_read_bool(np, "x")` | 开关标志 | true/false——**属性存在即真，不看值** |
| `of_property_read_u32_array(np, "x", arr, n)` | 定长数组 | 0 成功；长度不足失败 |
| `of_property_count_strings(np, "x")` | 数组长度查询 | 元素个数，配合 string_array 使用 |
| `of_get_named_gpio(np, "x", i)` | GPIO（老接口） | GPIO 编号或负值；新代码用 gpiod API |
| `of_parse_phandle(np, "x", i)` | phandle 引用 | 被引用节点的 device_node，**用完要 of_node_put** |

三条使用纪律：

1. **返回值必须查**：属性不存在时输出参数不会被写入，不查返回值用的就是未初始化的栈变量——这类 bug 在"有没有这个属性"的两块板子之间才暴露，最难复现
2. **bool 不用 read_u32 模拟**：`of_property_read_bool` 按"存在性"判定，写 `flag = <0>` 也是真。反过来，需要三态（开/关/未配置）时不能用 bool，要 read_u32 + 查返回值
3. **phandle 引用有计数**：`of_parse_phandle` 拿到的节点带引用计数，remove 或错误路径漏 `of_node_put` 就是节点泄漏——DT overlay 卸载时会被这些悬挂引用卡住

GPIO 的新旧两条路：`of_get_named_gpio` 返回全局编号的老接口只用于维护老代码；新驱动用 `devm_gpiod_get(&dev, "reset", GPIOD_OUT_LOW)` 系列——描述符式 API 自带 devm 托管、极性处理和设备树 `-gpios` 属性约定，B-A.1.1 有 GPIO 子系统的完整背景。

---

## <span class="blue"> TS502：硬件事实全部进 DT [E]

```dts
&i2c1 {
    ts502@48 {
        compatible = "virtual,ts502";
        reg = <0x48>;                          /* I2C 地址 */
        interrupt-parent = <&gpio1>;
        interrupts = <5 IRQ_TYPE_LEVEL_LOW>;   /* INT 脚接线与触发形态 */
        virtual,alarm-threshold = <85>;        /* 报警阈值 °C */
        virtual,default-sample-rate = <2>;     /* 默认采样率档位 */
        virtual,no-irq;                        /* 本板 INT 未接线：走轮询后备 */
        wakeup-source;                         /* 可作系统唤醒源（D.8 用） */
    };
};
```

probe 里的读取（有默认值的一律"读不到就用默认"，必选属性读不到直接失败）：

```c
struct device_node *np = client->dev.of_node;
u32 val;

/* 可选属性：读不到用默认值 */
if (!of_property_read_u32(np, "virtual,alarm-threshold", &val))
    data->alarm = val;
else
    data->alarm = 90;                        /* 手册默认阈值 */

if (!of_property_read_u32(np, "virtual,default-sample-rate", &val) && val <= 2)
    data->sample_rate = val;
else
    data->sample_rate = 1;

/* 三态开关：属性存在 = 本板没接 INT 脚 */
data->int_connected = !of_property_read_bool(np, "virtual,no-irq") &&
                      client->irq > 0;
```

读完立即用：`virtual,alarm-threshold` 写进 PWM_ALARM 寄存器，`default-sample-rate` 写进 CTRL——DT 是配置的源头，寄存器是配置的落点，驱动里没有第三处真相。

---

## <span class="blue"> 自定义 binding 设计规范 [E]

为自己的芯片设计 binding（属性集合）时，三条规范决定它能不能活得久：

### 硬件事实进 DT，软件策略写死或走配置通道

判断标准一句话：**这个值换一块板子会不会变**。

| 类型 | 例子 | 归属 |
|---|---|---|
| 硬件事实 | I2C 地址、INT 接线、晶振频率、阈值电气上限 | 设备树 |
| 产品策略 | 报警阈值目标值、默认采样率 | 设备树（随产品定义走）或业务配置 |
| 软件实现细节 | 驱动内部缓冲大小、日志级别、重试次数 | 代码常量 / 模块参数 / debugfs |

缓冲大小写进 DT 是高频错误——那是驱动实现的内部决策，改一次缓冲难道还要改所有板子的 DT？反过来把 INT 接线写进代码同样错（11.1.4 的 Legacy 裸驱动就是这么过时的）。

### compatible 命名：vendor,device 精确到型号

```dts
compatible = "virtual,ts502";           /* 正确：厂商前缀 + 具体型号 */
compatible = "virtual,ts502", "virtual,ts5xx";  /* 兼容族：具体在前，通用在后 */
```

不要发明通配命名（`"virtual,temp-sensor"`）——匹配机制（11.4）按字符串精确比较，含糊的 compatible 会让不兼容的芯片匹上同一个驱动。驱动侧 of_match_table 的组织与匹配优先级见 11.4.2/11.4.4。

### deprecated 演进：旧属性只加不删

binding 是 ABI，和 D.2 的 ioctl 同一条纪律：v2 需要新属性时**新增**，驱动读取顺序"先查新属性，没有再查旧属性，都没有用默认"，旧属性标注 `deprecated` 但永远能读。直接改属性语义或删掉旧属性，等于让所有存量板子的 DT 作废。

正式的 binding 还要写文档（`Documentation/devicetree/bindings/` 下的 YAML schema），`make dtbs_check` 可以拿 schema 校验 DT 文件——进内核主线的驱动这是强制项，产品内部驱动至少留一份属性清单注释。

---

## <span class="blue"> 资源编排时序 [E]

probe 里的资源获取有依赖顺序（11.3.3 的六步流程给过总图），本篇补设备树侧的对应关系：

```
DT 属性                驱动动作                        顺序约束
─────────────────────────────────────────────────────────────
reg                →   ioremap（MMIO 设备）           映射后才能碰寄存器
interrupts         →   翻译 IRQ / client->irq         申请 handler 前要确认触发类型
clocks           →   devm_clk_get + prepare_enable    读写寄存器之前必须使能
resets           →   devm_reset_control_get + deassert 先解除复位，否则寄存器读回全 0/全 1
pinctrl-0        →   （核心自动选 default 态）         引脚没切到正确复用，信号出不来
xxx-supply       →   devm_regulator_get + enable      芯片没电，以上全白搭
```

两条时序铁律：

1. **先供电复位时钟，后碰寄存器**：寄存器读写无效（读回全 0 或总线超时）时，按"supply → reset → clock → pinctrl"的顺序倒查——11.3.5 的排查树就是按这个依赖链组织的
2. **依赖未就绪原样上传 -EPROBE_DEFER**：时钟/电源的 provider 驱动可能还没 probe，`devm_clk_get` 返回 `-EPROBE_DEFER` 时透传给内核，稍后自动重试（机制见 11.3.3）。把 DEFER 当成普通错误打印报错然后放弃，是"偶发 probe 失败"类 bug 的第一来源

---

## <span class="blue"> Trade-off 表格 [E]

| 决策 | 选项 A | 选项 B | 权衡分析 |
|---|---|---|---|
| 可选属性 | 读不到用默认值 | 读不到直接失败 | 默认值让 DT 简洁；必选属性必须失败，防"配错了还跑" |
| GPIO 接口 | gpiod 描述符 | of_get_named_gpio 编号 | gpiod 自带 devm 与极性处理；编号接口只在维护老代码时用 |
| 配置归属 | 设备树 | 代码常量/模块参数 | 换板子会变的进 DT；实现细节留代码 |
| binding 演进 | 新增属性 + 兼容读取 | 改旧属性语义 | 前者保护存量 DT；后者省事但炸所有老板子 |
| 阈值类配置 | DT 静态声明 | ioctl 运行时可调 | 产品定义进 DT；业务要调的留 ioctl（TS502 两者都留） |

---

## <span class="blue"> 常见陷阱 [E]

| 陷阱 | 表现 | 根因 | 修正方法 |
|---|---|---|---|
| 不查 read 返回值 | 某块板子行为诡异 | 属性缺失时用了未初始化变量 | 返回值必查，可选属性配默认值 |
| bool 语义误用 | `flag = <0>` 仍然生效 | 按存在性判定，不看值 | 需要三态用 read_u32 |
| phandle 泄漏 | overlay 卸载卡住 | of_parse_phandle 后没 of_node_put | 错误路径与 remove 都补 put |
| DEFER 当普通错误 | 启动时偶发 probe 失败 | 把 -EPROBE_DEFER 打印成 error 放弃 | 原样透传，交给重试机制 |
| 先碰寄存器后开时钟 | 寄存器读回全 0 | 使能顺序违反依赖链 | supply→reset→clock→pinctrl→寄存器 |
| 缓冲大小写进 DT | 改驱动要动所有板子 | 软件实现细节误入 DT | 换板子会不会变：不会→留代码 |

---

## <span class="blue"> 动手练习

1. 给 TS502 的 DT 删掉 `virtual,alarm-threshold`，确认驱动落到默认值 90 且 probe 不报错；再把值改成 200（超出 PWM_ALARM 寄存器范围），给 probe 加范围校验，体会"DT 是输入，输入就要校验"。
2. 在驱动里故意不查 `of_property_read_u32` 返回值，编译加载到没有该属性的板子配置，用 init-on-stack 类调试手段（或打印）观察未初始化值的随机性。
3. 给自己的真实项目芯片起草一份 binding 属性清单：逐条标注"硬件事实 / 产品策略 / 实现细节"，把第三类的全部移出 DT。

---

## <span class="blue"> 本节总结

| 概念 | 核心要点 | 自查问题 |
|------|---------|---------|
| read 全家桶 | 返回值必查；bool 看存在性；phandle 要 put | 输出参数有未初始化风险吗 |
| gpiod | 新代码用描述符 API，编号接口仅维护用 | 还在 of_get_named_gpio 吗 |
| 配置归属 | 换板子会变的进 DT，实现细节留代码 | DT 里有缓冲大小这类东西吗 |
| compatible | vendor,device 精确到型号，兼容族具体在前 | 有通配命名吗 |
| binding 演进 | 只增不改，新属性优先读，旧属性标 deprecated | 老 DT 还能用吗 |
| 资源时序 | supply→reset→clock→pinctrl→寄存器 | 读写寄存器前依赖都使能了吗 |
| DEFER | 依赖未就绪原样透传 | DEFER 被当成错误吞了吗 |

---

## <span class="blue"> 下一步

硬件事实进了 DT，驱动能适配不同板子了——但产品还有夜间待机场景：屏幕灭了，TS502 还在以 100Hz 采样，白白耗电。下一篇（D.8 电源管理）讲 suspend/resume 里驱动该做什么：寄存器上下文保存恢复清单、enable_irq_wake 唤醒源、以及休眠唤醒的全链路验证。

螺旋衔接：设备树——第3.5/7.4章 DT 概念与解析（理解级）→ 11.3/11.4 匹配机制（理解级）→ 本篇（写法级）→ 第16章 BSP 评估（设计级）。★第3次出现（写法级）
