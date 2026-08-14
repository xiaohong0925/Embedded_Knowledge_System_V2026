# B-B.6.3 I3C Linux 驱动与调试

> 所属章节：第五部 B. 总线协议 > B-B.6 I3C 智能传感器总线
>
> 难度：[E] Expert | 预计阅读时间：35 分钟

## <span class="blue"> 本节导读

前两节解决了物理层与协议层：CCC 怎么发、DAA 怎么仲裁、IBI 怎么上报。本节回答工程问题——这套机制在 Linux 内核里对应哪些对象、哪些 API、哪些设备树属性。I3C 子系统与 I2C 子系统结构同构，但有一处本质差异：I3C 设备经 DAA 可被发现，设备树节点从"必填"变成了"可选"。

本节覆盖：内核 I3C 子系统三层架构与 Kconfig、私有传输与 IBI 的核心 API、经主线绑定（v6.6 `i3c.yaml`）核实的设备树写法、i3cdev 用户态接口与调试工具链、常见排查项。

---

## <span class="blue"> 子系统架构与 Kconfig

代码位于 `drivers/i3c/`，三层模型与 I2C 子系统同构：

```
用户空间：i3cdev（/dev/i3c-X）+ i3c-tools
─────────────────────────────────────────
i3c_driver    设备驱动（传感器、SPD…）      ← 本节重点
i3c_device    总线上的从设备实体（DAA 后创建）
i3c_master    控制器驱动（cdns / dw / svc / stm32）
─────────────────────────────────────────
硬件：I3C 控制器 IP
```

| 配置项 | 作用 |
|--------|------|
| `CONFIG_I3C` | 子系统核心，必选 |
| `CONFIG_I3C_MASTER_CDNS` / `_DW` / `_STM32` 等 | 对应 SoC 的控制器驱动 |
| `CONFIG_I3CDEV` | 用户态字符接口 `/dev/i3c-X`（v6.0 起） |

`/sys/bus/i3c/` 不存在即子系统未编译进内核——排查第一步。

---

## <span class="blue"> 核心 API

设备驱动日常只用两组：私有传输读写寄存器，IBI 三件套管理中断。

| 函数 | 功能 |
|------|------|
| `i3c_device_do_priv_xfers()` | 私有 SDR 传输（读/写寄存器） |
| `i3c_device_request_ibi()` | 申请 IBI 资源（注册回调、payload 上限） |
| `i3c_device_enable_ibi()` / `disable_ibi()` | 使能/禁用 IBI |
| `i3c_device_free_ibi()` | 释放 IBI 资源 |
| `i3c_master_do_daa()` | 触发 DAA（控制器驱动用，设备驱动不碰） |
| `i3c_master_enec/disec()` | 下发 ENEC/DISEC CCC（控制器/框架内部） |

### 私有传输：rnw 与两阶段 xfer

```c
struct i3c_priv_xfer xfers[2];
u8 reg = BMI088_ACC_X_LSB;
u8 rx_buf[6];

xfers[0].rnw = false;              /* false = 写：先发寄存器地址 */
xfers[0].len = 1;
xfers[0].data.out = &reg;

xfers[1].rnw = true;               /* true = 读：再收数据 */
xfers[1].len = 6;
xfers[1].data.in = rx_buf;

ret = i3c_device_do_priv_xfers(i3cdev, xfers, 2);
```

> ⚠️ `rnw` 的布尔语义与 I2C 的 `I2C_M_RD` 标志思路相反：`rnw=false` 是写、`true` 是读，且 `data` 联合体按方向取 `.out`/`.in`。从 I2C 驱动移植时这是高发错误源。

### IBI 三步配置

```c
static struct i3c_ibi_setup ibi_setup = {
    .handler = sensor_ibi_handler,   /* 数据到达回调 */
    .max_payload_len = 4,
    .num_slots = 2,                  /* IBI 槽位，防背靠背事件丢失 */
};

/* probe 中 */
ret = i3c_device_request_ibi(i3cdev, &ibi_setup);
if (!ret)
    i3c_device_enable_ibi(i3cdev);

/* remove 中：顺序必须严格反向 */
i3c_device_disable_ibi(i3cdev);
i3c_device_free_ibi(i3cdev);
```

> ⚠️ request → enable、disable → free 的顺序不能乱：先 enable 后 request 拿不到回调，先 free 后 disable 触发内核警告。IBI 回调运行在中断上下文，耗时操作用 workqueue 下放（见文末骨架）。

---

## <span class="blue"> 设备树：主线绑定格式

以下格式经 v6.6 `Documentation/devicetree/bindings/i3c/i3c.yaml` 核实，与网上大量二手文章的写法不同，请以此为准：

```dts
&i3c0 {
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_i3c0>;
    #address-cells = <3>;
    #size-cells = <0>;
    i3c-scl-hz = <12500000>;         /* I3C 速率，缺省 12.5 MHz */
    i2c-scl-hz = <400000>;           /* legacy I2C 速率 */
    status = "okay";

    /* I2C legacy 设备：节点名 <type>@<i2c地址>，reg 三元组 */
    bmp280: pressure@76 {
        compatible = "bosch,bmp280";
        reg = <0x76 0x0 0x10>;       /* I2C地址, 0, LVR/速率特性 */
        vdd-supply = <&reg_3v3>;
    };

    /* I3C 设备：节点名 <type>@<静态I2C地址>,<PID> */
    imu: sensor@68,39200144004 {
        compatible = "bosch,bmi08x-accel";
        reg = <0x68 0x392 0x144004>; /* 静态地址, PID高16位(厂商ID<<1), PID低32位 */
        assigned-address = <0xa>;    /* 期望的动态地址 */
    };
};
```

三个要点：

1. **I3C 设备节点通常可以不写**：DAA 使设备可被发现，只有需要附加资源（时钟、供电、assigned-address 预占地址）时才需要描述。这与 I2C"必须写节点"是本质区别。
2. `assigned-address` 的分配路径：有静态地址走 **SETDASA**，无静态地址走 ENTDAA + SETNEWDA——对应 B-B.6.2 的 CCC 机制。
3. `i2c@` 形式的旧写法（原文档历史版本）已废弃；I2C 子节点在 I3C 总线下用普通 `<type>@<addr>` 命名，reg 扩为三元组。I3C 控制器会为 legacy 设备创建一条 I2C adapter，BMP280 这类设备仍由标准 I2C 驱动接管，**驱动零改动**。

---

## <span class="blue"> 用户态接口与工具

`CONFIG_I3CDEV` 打开后出现 `/dev/i3c-X`，配套工具是 i3c-tools（独立小项目，非 i2c-tools 组成部分，通常源码编译），提供 `i3cdetect`（列出总线设备）、`i3cinfo`（PID/BCR/DCR/动态地址）、`i3ctransfer`（手动私有传输）。日常验证两条命令就够：

```bash
i3cinfo -y 0        # 确认 DAA 结果：每个设备的 PID 与分到的动态地址
i3ctransfer -y 0 w1@0x0a 0x00 r1   # 读 0x0a 设备的 0x00 寄存器（Chip ID）
```

内核侧信息渠道：

```bash
dmesg | grep -i i3c                                  # 控制器注册、DAA 记录
echo 'file drivers/i3c/master.c +p' > /sys/kernel/debug/dynamic_debug/control
ls /sys/bus/i3c/devices/                             # DAA 成功的设备实体
ls /sys/bus/i2c/devices/                             # legacy 设备在 I2C 侧
```

---

## <span class="blue"> 排查锚点

| 现象 | 优先怀疑 | 验证手段 |
|------|----------|----------|
| 无 `/sys/bus/i3c/` | CONFIG_I3C 未开 | 查内核配置 |
| 设备未出现 | 上拉/走线致 DAA 失败、VIO 不匹配 | i3cinfo 无条目 → 降 `i3c-scl-hz` 重试，示波器看 DAA 阶段波形 |
| IBI 不触发 | request/enable 顺序错、ENEC 未生效 | 查 probe 返回值；示波器看从机是否拉 SDA |
| legacy 设备读写失败 | reg 三元组第二、三格填错 | 对照 i3c.yaml 检查 LVR 特性格 |
| 读数全 0xFF | 设备未退出待机、VIO 过低 | 查供电与初始化序列 |

总原则：I3C 问题先降速（`i3c-scl-hz` 砍半）再分层定位——速率敏感的毛病（电容超标、上拉不当）降速即现形，这与 B-B.6.1 的 50 pF 约束直接对应。

---

## <span class="blue"> 驱动骨架（probe + 私有传输 + IBI）

把前述 API 串成可编译的最小骨架：

```c
#include <linux/i3c/device.h>
#include <linux/i3c/master.h>
#include <linux/workqueue.h>

struct sensor_data {
    struct i3c_device *i3cdev;
    struct work_struct ibi_work;
    s16 accel[3];
};

static void sensor_ibi_work(struct work_struct *work)
{
    struct sensor_data *data = container_of(work, struct sensor_data, ibi_work);
    /* workqueue 上下文：可安全做私有传输读数据 */
    struct i3c_priv_xfer xfers[2];
    u8 reg = BMI088_ACC_X_LSB;
    u8 rx[6];

    xfers[0] = (struct i3c_priv_xfer){ .rnw = false, .len = 1, .data.out = &reg };
    xfers[1] = (struct i3c_priv_xfer){ .rnw = true,  .len = 6, .data.in = rx };
    if (i3c_device_do_priv_xfers(data->i3cdev, xfers, 2))
        return;

    data->accel[0] = (s16)(rx[1] << 8 | rx[0]);
    data->accel[1] = (s16)(rx[3] << 8 | rx[2]);
    data->accel[2] = (s16)(rx[5] << 8 | rx[4]);
}

static void sensor_ibi_handler(struct i3c_device *i3cdev,
                               const struct i3c_ibi_payload *payload)
{
    struct sensor_data *data = i3cdev_get_drvdata(i3cdev);
    schedule_work(&data->ibi_work);        /* 中断上下文只调度，不读写 */
}

static int sensor_i3c_probe(struct i3c_device *i3cdev)
{
    struct i3c_ibi_setup setup = {
        .handler = sensor_ibi_handler,
        .max_payload_len = 0,
        .num_slots = 1,
    };
    struct sensor_data *data;
    int ret;

    data = devm_kzalloc(&i3cdev->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;
    data->i3cdev = i3cdev;
    i3cdev_set_drvdata(i3cdev, data);
    INIT_WORK(&data->ibi_work, sensor_ibi_work);

    /* 1. 读 Chip ID 验证通信（两阶段 priv_xfer，代码同前文） */
    /* 2. 初始化传感器寄存器：量程、ODR、DRDY 使能            */

    /* 3. 申请并启用 IBI */
    ret = i3c_device_request_ibi(i3cdev, &setup);
    if (!ret)
        i3c_device_enable_ibi(i3cdev);
    return 0;
}

static void sensor_i3c_remove(struct i3c_device *i3cdev)
{
    i3c_device_disable_ibi(i3cdev);
    i3c_device_free_ibi(i3cdev);
}

static const struct i3c_device_id sensor_i3c_ids[] = {
    I3C_DEVICE(0x392, 0x1440),      /* 厂商 ID, part ID —— 按器件手册填 */
    { }
};
MODULE_DEVICE_TABLE(i3c, sensor_i3c_ids);

static struct i3c_driver sensor_i3c_driver = {
    .driver = { .name = "sensor-i3c" },
    .probe = sensor_i3c_probe,
    .remove = sensor_i3c_remove,
    .id_table = sensor_i3c_ids,
};
module_i3c_driver(sensor_i3c_driver);
MODULE_LICENSE("GPL");
```

---

## <span class="blue"> 行业实例：DDR5 SPD 与混合总线

**DDR5 SPD（纯 I3C）**：内核已有 `jedec,spd5118` 兼容的驱动（`drivers/misc/eeprom/spd5118.c`），SPD Hub 通过私有传输读取温度与时序参数。设备树按 I3C 子节点格式描述，PID 各厂商不同，查 JEDEC 文档或模组手册填写；`assigned-address` 常用 0x50 保持与 DDR4 时代软件习惯一致。

**手机传感器总线（I3C + I2C 混合）**：IMU、光照走 I3C（高速 + IBI 数据就绪上报），气压计沿用 I2C 兼容模式省成本——对应前文设备树示例的完整形态。关键工程结论：混合总线下 legacy 设备驱动零改动，新设备拿到 IBI 与高速率，迁移成本集中在设备树与初始化时序上。

---

## <span class="blue"> 方案对比（Trade-off）

| 维度 | 评价 |
|------|------|
| 内核驱动 vs i3cdev 用户态 | 内核驱动获得完整电源管理与 IBI；i3cdev 免写驱动、原型快，但事件处理弱 |
| IBI + workqueue | 事件与数据同帧到达，省一轮读事务；代价是回调上下文受限，代码比轮询复杂 |
| assigned-address 预占 | 地址规划可控、日志可读；代价是失去 DAA 的部分灵活性 |
| 混合总线 | legacy 零改动迁移；代价是时序与调试复杂度上升，两条子系统都要懂 |

---

## <span class="blue"> 常见陷阱

> ⚠️ 照抄二手文章的设备树：`i3c@0` + 两元组 reg 是旧草案写法，主线 v6.6 已按三元组 + `<type>@<static>,<pid>` 命名。以内核源码树 `i3c.yaml` 为准。

> ⚠️ `rnw` 方向写反：写寄存器地址用了 `rnw=true`，priv_xfer 返回错误或读到垃圾。false=写、true=读。

> ⚠️ IBI 回调里直接做私有传输：回调在中断上下文，priv_xfer 可能睡眠——死锁或调度警告。一律 workqueue 下放。

> ⚠️ 只开 CONFIG_I3C 没开控制器驱动：子系统存在但总线不注册，dmesg 无 master 初始化日志。

---

## <span class="blue"> 动手练习

1. **API 对照**：在本机内核源码 `drivers/i3c/device.c` 中找到 `i3c_device_do_priv_xfers` 与 `i3c_device_request_ibi` 的实现，确认参数与返回值语义。
2. **设备树改错**：把前文"旧写法"（两元组 reg、`i2c@1` 命名）的设备树改写成主线格式，并说明每处修改依据。
3. **驱动走查**：给骨架补上 Chip ID 校验的完整两阶段 xfer 代码，编译通过（可只编译不加载）。
4. **无硬件后备**：用 `CONFIG_I3C` + debugfs/dynamic_debug 阅读 `drivers/misc/eeprom/spd5118.c`，回答：它的温度读取用的是哪组 API，IBI 用没用、为什么。

---

## <span class="blue"> 本节总结

| 自查项 | 确认标准 |
|--------|----------|
| 架构 | master/device/driver 三层；与 I2C 子系统的同构与差异（DAA 可发现） |
| Kconfig | CONFIG_I3C + 控制器驱动 + I3CDEV 三者分工 |
| API | priv_xfers 的 rnw/联合体语义；IBI 三件套与释放顺序 |
| 设备树 | 三元组 reg、`<type>@<static>,<pid>` 命名、assigned-address 两条分配路径 |
| 工具 | i3cinfo 看 DAA 结果；dmesg + dynamic_debug 分层定位 |
| 调试 | 先降速再分层；中断上下文不做 priv_xfer |

---

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/driver-api/i3c/`、`Documentation/devicetree/bindings/i3c/i3c.yaml`（v6.6）
- **内核源码**：`drivers/i3c/`（子系统）、`drivers/i3c/master/cdns-i3c-master.c`（控制器参考）、`drivers/misc/eeprom/spd5118.c`（真实设备驱动）
- **工具**：i3c-tools（配套 CONFIG_I3CDEV，源码编译）

---

## <span class="blue"> 下一步

I3C 三篇（物理层 → 协议层 → 驱动与调试）到此收口，B-A 低速外设接口板块完成。接下来按 v4 规划补 **B-B.6.4 I3C 深化篇**（多主、时序控制、错误恢复等进阶主题），随后进入 **B-B 中高速总线**板块——USB 从 4 线电缆到 Type-C 的完整演进。

> 💡 螺旋衔接：IBI 回调 + workqueue 的下放模式与第二部第 10 章中断处理的 top half/bottom half 是同一框架；`i3c_driver` 的注册匹配回看第二部第 11 章设备模型（i3c_bus_type 是又一个 bus 实例）；混合总线的 I2C adapter 创建逻辑印证 B-B.3.3 的 adapter 概念——子系统之间从来都是互相复用的。
