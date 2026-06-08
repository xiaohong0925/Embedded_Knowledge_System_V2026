# B-A.5.3 I3C Linux驱动与调试 [知识点299-300]

> 所属章节：第五部 B. 总线协议 > B-A.5 I3C：I²C的进化版
>
> 难度：[E] Expert | 预计阅读时间：35分钟

## <span class="blue"> 本节导读

前两节我们啃了I3C的物理层和协议层，知道了它怎么用一根线做到12.5Mbps、怎么发CCC命令、怎么处理IBI中断。但协议再好，不在Linux里跑起来也是白搭。这一节我们要干的事很实在：把I3C子系统的骨架拆给你看——从`i3c_master`到`i3c_device`到`i3c_driver`，把私有传输和IBI中断的API摸清楚；再学会用`i3cdetect`和`i3cinfo`这两个工具；最后搞定I3C+I2C混合总线的设备树配置。

 industry 实例选了DDR5内存的SPD读取和手机传感器总线，这两个场景一个是纯I3C（SPD），一个是I3C+I2C混合（手机传感器），覆盖面够广。读完这一节，你应该能从零开始把一个I3C设备的驱动搭起来。

---

## <span class="blue"> 知识点299 [E] Linux I3C子系统核心API

### 子系统架构：三层模型

I3C子系统的代码在内核的`drivers/i3c/`目录下，整体架构可以分成三层：

```
┌─────────────────────────────────────────┐
│         User Space (i3cdev/i3c-tools)   │
├─────────────────────────────────────────┤
│  i3c_driver层 (传感器/SPD/设备驱动)      │
│  ├── bmi088_i3c_driver                  │
│  ├── spd5118_driver                     │
│  └── ...                                │
├─────────────────────────────────────────┤
│  i3c_device层 (总线上的每个从设备)        │
│  ├── dev: PID=0x1234, DA=0x07           │
│  ├── dev: PID=0x5678, DA=0x08 (I2C)     │
│  └── ...                                │
├─────────────────────────────────────────┤
│  i3c_master层 (控制器驱动)               │
│  ├── dw-i3c-master (DesignWare)         │
│  ├── svc-i3c-master (Silvaco)           │
│  └── cdns-i3c-master (Cadence)          │
├─────────────────────────────────────────┤
│  Hardware: I3C Controller IP             │
└─────────────────────────────────────────┘
```

**`i3c_master`** 对应SoC上的I3C控制器，一个控制器实例管一条总线。`i3c_device`是总线上动态地址分配后的一个从设备实体。`i3c_driver`就是设备驱动，跟I2C驱动的写法思路很像——注册`probe`和`remove`，在probe里初始化设备。

### 核心API速查

| 函数 | 功能 | 关键参数 | 返回值 |
|------|------|----------|--------|
| `i3c_master_register()` | 注册I3C主控制器 | `struct i3c_master_controller *master` | 0成功，负值错误码 |
| `i3c_master_unregister()` | 注销主控制器 | 同上 | void |
| `i3c_device_do_priv_xfer()` | 私有SDR传输（读写设备寄存器） | `struct i3c_device *dev`, `struct i3c_priv_xfer *xfers`, `nxfers` | 0成功，负值错误码 |
| `i3c_device_enable_ibi()` | 启用设备的IBI中断上报 | `struct i3c_device *dev` | 0成功 |
| `i3c_device_disable_ibi()` | 禁用IBI | `struct i3c_device *dev` | void |
| `i3c_device_request_ibi()` | 申请IBI资源（分配回调） | `struct i3c_device *dev`, `const struct i3c_ibi_setup *req` | 0成功 |
| `i3c_device_free_ibi()` | 释放IBI资源 | `struct i3c_device *dev` | void |
| `i3c_master_do_daa()` | 执行动态地址分配(DAA) | `struct i3c_master_controller *master` | 0成功 |
| `i3c_master_enec/disable()` | 发送ENEC/DISEC CCC命令 | `master`, `addr`, `evts` | 0成功 |

这些API里你最常用的是前四个——注册主设备、做私有传输、开关IBI。控制器驱动（比如DesignWare IP）会在初始化时调用`i3c_master_register()`把自己挂到子系统上；设备驱动则在probe里用`i3c_device_do_priv_xfer()`读写寄存器，用`i3c_device_enable_ibi()`让设备能主动发中断。

### 私有传输：i3c_device_do_priv_xfer()

这是设备驱动的" bread and butter "，读传感器寄存器全靠它：

```c
/* I3C私有传输：读取BMI088加速度数据 */
struct i3c_priv_xfer xfer[2];
u8 reg_addr = BMI088_ACC_X_LSB;
s16 accel_x, accel_y, accel_z;

/* 第一步：写寄存器地址 */
xfers[0].rnw = false;           /* rnw=false 表示写方向 */
xfers[0].len = 1;
xfers[0].data.out = &reg_addr;

/* 第二步：读6字节数据（X/Y/Z各2字节） */
xfers[1].rnw = true;            /* rnw=true 表示读方向 */
xfers[1].len = 6;
xfers[1].data.in = rx_buf;

ret = i3c_device_do_priv_xfer(i3cdev, xfers, 2);
if (ret) {
    dev_err(&i3cdev->dev, "priv xfer failed: %d\n", ret);
    return ret;
}

accel_x = (s16)(rx_buf[1] << 8 | rx_buf[0]);
accel_y = (s16)(rx_buf[3] << 8 | rx_buf[2]);
accel_z = (s16)(rx_buf[5] << 8 | rx_buf[4]);
```

注意`i3c_priv_xfer`的`rnw`字段——`false`是写，`true`是读。这个跟I2C的`flags & I2C_M_RD`逻辑是反过来的，习惯了I2C的人很容易搞反。`data`是个联合体：`data.out`用于写，`data.in`用于读，取决于`rnw`。

### IBI中断处理流程

IBI（In-Band Interrupt）是I3C相比I2C最核心的优势之一。配置IBI需要三步：

```c
/* 1. 准备IBI配置 */
static struct i3c_ibi_setup bmi088_ibi_setup = {
    .handler = bmi088_ibi_handler,  /* 中断回调 */
    .max_payload_len = 4,           /* 最大payload */
    .num_slots = 2,                 /* IBI槽位数 */
};

/* 2. 在probe中申请并启用IBI */
static int bmi088_i3c_probe(struct i3c_device *i3cdev)
{
    int ret;
    
    ret = i3c_device_request_ibi(i3cdev, &bmi088_ibi_setup);
    if (ret)
        return ret;
    
    ret = i3c_device_enable_ibi(i3cdev);
    if (ret) {
        i3c_device_free_ibi(i3cdev);
        return ret;
    }
    
    /* 配置BMI088为数据ready中断模式 */
    bmi088_write_reg(i3cdev, BMI088_INT_CTRL, DATA_READY_EN);
    
    return 0;
}

/* 3. IBI回调：设备主动上报数据 */
static void bmi088_ibi_handler(struct i3c_device *i3cdev,
                                const struct i3c_ibi_payload *payload)
{
    struct bmi088_data *data = dev_get_drvdata(&i3cdev->dev);
    
    /* payload里可能带有设备主动push的数据 */
    if (payload->len > 0) {
        /* 读取加速度数据 */
        schedule_work(&data->read_work);
    } else {
        /* 无payload，手动读取 */
        schedule_work(&data->read_work);
    }
}
```

IBI的工作流程是这样的：设备拉低SDA → 主控制器检测到总线竞争 → 发送START + 7位动态地址 + RnW=1 → 设备在SDA上放数据 → STOP。整个过程硬件自动处理，驱动的`ibi_handler`回调在数据接收完成后触发。

> ⚠️ **陷阱**：`i3c_device_enable_ibi()`之前必须先调用`i3c_device_request_ibi()`申请资源。反过来，remove时要先`disable_ibi()`再`free_ibi()`，顺序搞反会触发内核警告甚至oops。

---

## <span class="blue"> 知识点300 [E] i3c-tools与混合总线调试

### i3c-tools工具集

`i3c-tools`是i2c-tools的I3C版本，但功能精简很多——毕竟I3C的动态地址和IBI特性让静态扫描变得复杂。

| 命令 | 功能 | 示例输出 |
|------|------|----------|
| `i3cdetect -y <bus>` | 扫描I3C总线上的设备 | `0 1 2 3 4 5 6 7 8 9 a b c d e f`<br>`00: -- -- -- -- -- -- -- 07 08 -- -- -- -- -- -- --`<br>`10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --` |
| `i3cinfo -y <bus>` | 显示I3C总线信息（PID、BCR、DCR、DA） | `Device 0: PID=0x1234, DA=0x07, BCR=0x05, DCR=0xC2` |
| `i3ctransfer -y <bus> <msgs>` | 执行I3C私有传输（类似i2ctransfer） | 读写寄存器数据 |
| `i3cdevTest` | 测试/dev/i3c-X设备节点 | 验证i3cdev接口 |

`i3cdetect`扫出来的是设备的**动态地址**（Dynamic Address），不是静态的PID。地址显示在对应列，比如`07`表示动态地址0x07的设备在线。`--`表示空位。注意I3C的动态地址范围是`0x08-0x6E`，`0x00`和`0x7E`保留给广播和特殊用途。

`i3cinfo`是信息最丰富的命令，能显示每个设备的完整信息：

```bash
$ i3cinfo -y 0
Bus: i3c-0
  I3C mode: yes
  PID: 0x0000000000000000 (Master)
  ----
  Device 0: PID=0x0000001234567A04
    Dynamic Address: 0x07
    BCR: 0x05 (IBI Payload, IBI Request, Max Data Speed Limit)
    DCR: 0xC2 (Accelerometer)
    LVR: not applicable (I3C device)
  Device 1: PID=0x0000000876543210
    Dynamic Address: 0x08
    BCR: 0x00
    DCR: 0x62 (Pressure Sensor)
    Legacy Device: yes (I2C, LVR=0x51)
```

注意最后一行——`Legacy Device: yes`，这就是I2C兼容设备（BMP280），它有一个LVR（Legacy Virtual Register）而不是BCR/DCR。

### I3C+I2C混合总线设备树配置

这是I3C最实用的特性之一：一条总线上同时挂I3C和I2C设备，内核自动区分。设备树里的写法很特别——I2C兼容设备要放在`i2c@`子节点里：

| 节点 | 属性 | 说明 |
|------|------|------|
| `i3c0: i3c@...` | `compatible = "cdns,i3c-master"` | 主控制器节点 |
| `i3c@0` | `compatible = "bosch,bmi088_accel"` | I3C从设备（BMI088） |
| `i2c@1` | `compatible = "bosch,bmp280"` | I2C兼容设备（BMP280） |
| `i3c@2` | `compatible = "vishay,veml6030"` | I3C从设备（VEML6030） |

```dts
/* 完整的I3C+I2C混合设备树配置 */
&i3c0 {
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_i3c0>;
    bus-frequency = <12500000>;         /* 12.5MHz I3C SDR */
    i2c-scl-frequency = <400000>;       /* I2C FM 400kHz */
    status = "okay";

    /* BMI088 加速度计 - I3C模式 */
    bmi088_accel: i3c@0 {
        compatible = "bosch,bmi088-accel";
        reg = <0x1234567 0x4>;          /* PID = 0x1234567, BCR[3:0]=0x4 */
        assigned-address = <0x07>;       /* 动态地址请求0x07 */
        interrupt-parent = <&gpio1>;
        interrupts = <12 IRQ_TYPE_EDGE_RISING>;
    };

    /* BMP280 气压传感器 - I2C兼容模式 */
    bmp280: i2c@1 {
        compatible = "bosch,bmp280";
        reg = <0x76>;                    /* I2C静态地址 0x76 */
        vdd-supply = <&reg_3v3>;
    };

    /* VEML6030 光照传感器 - I3C模式 */
    veml6030: i3c@2 {
        compatible = "vishay,veml6030";
        reg = <0x8765432 0x3>;          /* PID = 0x8765432 */
        assigned-address = <0x08>;
    };
};
```

> 💡 **提示**：I3C设备树中`i2c@`子节点会自动被I2C子系统识别——I3C总线控制器驱动会创建一条I2C适配器（adapter），把`i2c@`子节点挂到标准的I2C核心上。这意味着你的BMP280驱动完全不用改，用标准的`i2c_transfer()`就能工作。一条总线，两个子系统，各自管各自的设备，这就是I3C向后兼容的优雅之处。

### 调试方法

I3C调试三板斧：`dmesg`看内核日志、`i3cdetect`看设备扫描、`i3cinfo`看设备详情。再不行就上示波器抓波形。

**内核日志过滤：**

```bash
# 查看I3C相关日志
dmesg | grep -i i3c
# [    1.234567] cdns-i3c-master e0000000.i3c: Cadence I3C Master initialized
# [    1.345678] i3c i3c-0: Adding device PID=0x1234567 at address 0x07
# [    1.456789] i3c i3c-0: I2C device detected at address 0x76 (BMP280)

# 开启动态调试
echo 'file drivers/i3c/master.c +p' > /sys/kernel/debug/dynamic_debug/control
echo 'file drivers/i3c/device.c +p' >> /sys/kernel/debug/dynamic_debug/control
```

**常见问题排查：**

| 现象 | 可能原因 | 排查方法 |
|------|----------|----------|
| `i3cdetect`扫不出设备 | 总线频率过高，设备不响应 | 降速到6MHz重试，查上拉电阻 |
| IBI不触发 | 未发送ENEC命令 | 检查`i3c_device_enable_ibi()`返回值 |
| I2C设备读写失败 | 设备树中用了`i3c@`而非`i2c@` | 确认子节点名是`i2c@N` |
| DAA失败 | PID冲突或BCR格式错误 | 用`i3cinfo`看分配状态 |
| 读数据全FF | 设备未退出待机模式 | 检查设备供电和初始化序列 |

---

## <span class="blue"> 行业实例：DDR5 SPD读取 + 手机传感器总线

### 实例1：DDR5 SPD Hub（纯I3C）

DDR5内存条上的SPD（Serial Presence Detect）芯片从DDR4的纯I2C切换到了I3C。SPD Hub的I3C地址由硬件 strap 引脚决定，通常固定在总线上的特定位置。Linux里通过`spd5118`驱动读取温度和时序参数。

**SPD Hub的设备树配置：**

```dts
&i3c1 {
    /* DDR5 SPD Hub - I3C模式 */
    spd0: i3c@0 {
        compatible = "jedec,spd5118";
        reg = <0x5118000 0x1>;         /* SPD5118标准PID */
        assigned-address = <0x50>;      /* SPD固定地址0x50 */
    };
};
```

**SPD读取驱动核心代码：**

```c
static int spd5118_read_temp(struct i3c_device *i3cdev, int *temp_millideg)
{
    struct i3c_priv_xfer xfer[2];
    u8 reg = SPD5118_REG_TEMP;
    u8 buf[2];
    int ret;

    /* 写温度寄存器地址 */
    xfer[0].rnw = false;
    xfer[0].len = 1;
    xfer[0].data.out = &reg;

    /* 读2字节温度值 */
    xfer[1].rnw = true;
    xfer[1].len = 2;
    xfer[1].data.in = buf;

    ret = i3c_device_do_priv_xfer(i3cdev, xfer, 2);
    if (ret)
        return ret;

    /* 温度值：16位有符号，0.0625°C/LSB */
    *temp_millideg = (s16)(buf[0] << 8 | buf[1]) * 625 / 10;
    return 0;
}
```

### 实例2：手机传感器总线（I3C+I2C混合）

这个场景更接近实际产品开发。BMI088（6轴IMU）和VEML6030（光照）走I3C获取高速传输+IBI中断能力，BMP280（气压）沿用I2C兼容模式节约成本。

**接线图：**

```
            ┌────────────────────────────────────┐
            │           AP (应用处理器)             │
            │  ┌──────────┐                      │
            │  │ I3C Ctrl │                      │
            │  │ (Cadence)│                      │
            │  └───┬────┬─┘                      │
            │      │SCL │SDA                     │
            └──────┼────┼──────────────────────┘
                   │    │
            ═══════╪════╪══════ I3C Bus (12.5MHz)
                   │    │
           ┌───────┘    └───────┐
           │                    │
    ┌──────┴──────┐      ┌──────┴──────┐
    │  BMI088     │      │  VEML6030   │
    │  (Accel+Gyro)│      │  (ALS)      │
    │  I3C: 0x07   │      │  I3C: 0x08  │
    │  IBI: DRDY   │      └─────────────┘
    └─────────────┘            │
                               │
                      ┌────────┘
                      │
               ┌──────┴──────┐
               │   BMP280    │
               │   (Press)   │
               │  I2C: 0x76  │
               │  FM 400kHz  │
               └─────────────┘
```

**完整的设备树节点（含混合I3C+I2C）：**

```dts
&i3c0 {
    pinctrl-names = "default";
    pinctrl-0 = <&pinctrl_i3c0>;
    bus-frequency = <12500000>;
    i2c-scl-frequency = <400000>;
    status = "okay";

    /* BMI088 加速度计 - I3C模式，带IBI */
    bmi088_accel: i3c@0 {
        compatible = "bosch,bmi088-accel";
        reg = <0x1234567 0x4>;
        assigned-address = <0x07>;
        interrupt-parent = <&gpio1>;
        interrupts = <12 IRQ_TYPE_EDGE_RISING>;
    };

    /* BMP280 气压传感器 - I2C兼容 */
    bmp280: i2c@1 {
        compatible = "bosch,bmp280";
        reg = <0x76>;
        vdd-supply = <&reg_3v3>;
    };

    /* VEML6030 光照传感器 - I3C模式 */
    veml6030: i3c@2 {
        compatible = "vishay,veml6030";
        reg = <0x8765432 0x3>;
        assigned-address = <0x08>;
    };
};
```

**I3C传感器驱动完整代码（probe + priv_xfer + IBI处理）：**

```c
#include <linux/i3c/device.h>
#include <linux/i3c/master.h>
#include <linux/interrupt.h>
#include <linux/workqueue.h>

struct sensor_data {
    struct i3c_device *i3cdev;
    struct work_struct ibi_work;
    s16 accel[3];
    int temp;
};

/* ========== IBI中断处理 ========== */
static void sensor_ibi_work(struct work_struct *work)
{
    struct sensor_data *data = container_of(work, struct sensor_data, ibi_work);
    struct i3c_priv_xfer xfer;
    u8 rx_buf[6];
    u8 reg = BMI088_ACC_X_LSB;

    /* 读6字节加速度数据 */
    xfer.rnw = false;
    xfer.len = 1;
    xfer.data.out = &reg;

    if (i3c_device_do_priv_xfer(data->i3cdev, &xfer, 1))
        return;

    xfer.rnw = true;
    xfer.len = 6;
    xfer.data.in = rx_buf;

    if (i3c_device_do_priv_xfer(data->i3cdev, &xfer, 1))
        return;

    data->accel[0] = (s16)(rx_buf[1] << 8 | rx_buf[0]);
    data->accel[1] = (s16)(rx_buf[3] << 8 | rx_buf[2]);
    data->accel[2] = (s16)(rx_buf[5] << 8 | rx_buf[4]);

    dev_info(&data->i3cdev->dev, "Accel: X=%d Y=%d Z=%d\n",
             data->accel[0], data->accel[1], data->accel[2]);
}

static void bmi088_ibi_handler(struct i3c_device *i3cdev,
                                const struct i3c_ibi_payload *payload)
{
    struct sensor_data *data = dev_get_drvdata(&i3cdev->dev);
    schedule_work(&data->ibi_work);
}

/* ========== probe/remove ========== */
static int bmi088_i3c_probe(struct i3c_device *i3cdev)
{
    struct sensor_data *data;
    struct i3c_ibi_setup ibi_setup = {
        .handler = bmi088_ibi_handler,
        .max_payload_len = 0,
        .num_slots = 1,
    };
    struct i3c_priv_xfer xfer;
    u8 chip_id;
    int ret;

    data = devm_kzalloc(&i3cdev->dev, sizeof(*data), GFP_KERNEL);
    if (!data)
        return -ENOMEM;

    data->i3cdev = i3cdev;
    i3cdev_set_drvdata(i3cdev, data);
    INIT_WORK(&data->ibi_work, sensor_ibi_work);

    /* 1. 读取Chip ID验证通信 */
    u8 reg = BMI088_CHIP_ID;
    xfer.rnw = false;
    xfer.len = 1;
    xfer.data.out = &reg;
    ret = i3c_device_do_priv_xfer(i3cdev, &xfer, 1);
    if (ret)
        return ret;

    xfer.rnw = true;
    xfer.len = 1;
    xfer.data.in = &chip_id;
    ret = i3c_device_do_priv_xfer(i3cdev, &xfer, 1);
    if (ret)
        return ret;

    if (chip_id != BMI088_CHIP_ID_VAL) {
        dev_err(&i3cdev->dev, "Invalid chip ID: 0x%02x\n", chip_id);
        return -ENODEV;
    }

    /* 2. 初始化传感器：配置量程、ODR */
    bmi088_init_sensor(i3cdev);

    /* 3. 申请并启用IBI */
    ret = i3c_device_request_ibi(i3cdev, &ibi_setup);
    if (ret)
        dev_warn(&i3cdev->dev, "IBI request failed: %d\n", ret);
    else
        i3c_device_enable_ibi(i3cdev);

    dev_info(&i3cdev->dev, "BMI088 I3C probed, ChipID=0x%02x\n", chip_id);
    return 0;
}

static void bmi088_i3c_remove(struct i3c_device *i3cdev)
{
    /* 严格顺序：先disable再free */
    i3c_device_disable_ibi(i3cdev);
    i3c_device_free_ibi(i3cdev);
}

static const struct i3c_device_id bmi088_i3c_ids[] = {
    I3C_DEVICE(0x1234567, 0x4),     /* PID=0x1234567, BCR=0x4 */
    { }
};

static struct i3c_driver bmi088_i3c_driver = {
    .driver = {
        .name = "bmi088-i3c",
    },
    .probe = bmi088_i3c_probe,
    .remove = bmi088_i3c_remove,
    .id_table = bmi088_i3c_ids,
};

module_i3c_driver(bmi088_i3c_driver);
MODULE_LICENSE("GPL");
```

> ⚠️ **陷阱**：I3C主设备驱动不是所有内核都启用的。确保你的内核配置了`CONFIG_I3C=y/m`、`CONFIG_I3C_MASTER_CDNS=y`（或其他控制器）以及`CONFIG_I3CDEV=y`。如果`/sys/bus/i3c/`目录不存在，说明I3C子系统根本没编译进内核。

### 验证步骤

```bash
# Step 1: 检查内核是否支持I3C
ls /sys/bus/i3c/          # 应该有devices和drivers两个子目录

# Step 2: 用i3cdetect扫描总线
i3cdetect -y 0
# 预期输出：
#     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
# 00: -- -- -- -- -- -- -- 07 08 -- -- -- -- -- -- --
#     07=BMI088, 08=VEML6030
#     (BMP280在I2C适配器上显示，不在i3c-0)

# Step 3: 查看设备详细信息
i3cinfo -y 0
# 预期输出：
# Device 0: PID=0x0000001234567A04, DA=0x07
#   BCR: 0x05 (IBI capable)
#   DCR: 0xC2 (Accelerometer)
# Device 1: PID=0x0000008765432A03, DA=0x08
#   BCR: 0x03
#   DCR: 0x9A (Ambient Light Sensor)

# Step 4: 检查dmesg
# dmesg | grep i3c
# [   12.345] cdns-i3c-master ff880000.i3c: I3C bus 0 registered
# [   12.456] bmi088-i3c i3c-0-007: BMI088 I3C probed, ChipID=0x1E
# [   12.567] bmp280 0-0076: Pressure and temperature sensor BMP280
# [   12.678] veml6030 i3c-0-008: VEML6030 probed

# Step 5: 检查I3C+I2C是否各自正确挂载
ls /sys/bus/i3c/devices/          # 应看到 i3c-0-007, i3c-0-008
ls /sys/bus/i2c/devices/          # 应看到 0-0076 (BMP280在I2C侧)

# Step 6: 手动读取寄存器（验证priv_xfer）
i3ctransfer -y 0 w1@0x07 0x00 r1  # 读BMI080寄存器0x00
# 预期返回：0x1E (Chip ID)

# Step 7: 检查IBI是否启用
cat /sys/kernel/debug/i3c/0/ibi_enabled
# 预期输出：07  (动态地址0x07的IBI已启用)
```

---

## <span class="blue"> 本节总结

| 主题 | 要点 |
|------|------|
| I3C三层架构 | `i3c_master`（控制器）→ `i3c_device`（从设备实体）→ `i3c_driver`（设备驱动） |
| 核心API | `i3c_device_do_priv_xfer()`读写寄存器；`enable/disable_ibi()`管理中断；`request/free_ibi()`分配资源 |
| 私有传输 | 用`rnw=false`写寄存器地址+`rnw=true`读数据，两阶段xfer数组方式 |
| IBI配置 | 三步：`request_ibi()`申请 → `enable_ibi()`启用 → `handler`回调处理中断；remove时反向顺序释放 |
| i3c-tools | `i3cdetect`扫动态地址；`i3cinfo`看PID/BCR/DCR；`i3ctransfer`手动读写 |
| 混合总线 | `i2c@`子节点自动被I2C子系统识别，驱动不用改；`i3c@`子节点走I3C原生路径 |
| 内核配置 | 必须启用`CONFIG_I3C=y` + 对应控制器驱动 + `CONFIG_I3CDEV=y` |
| DDR5 SPD | I3C地址由硬件strap决定，用priv_xfer读温度/时序，驱动为`spd5118` |
| 调试要点 | `dmesg \| grep i3c`看日志；`i3cinfo`确认DAA结果；示波器抓SDA看IBI波形 |

---

## <span class="blue"> 配套资源

**推荐阅读（顺序）：**
1. MIPI I3C Specification v1.1.1 — 第8章 "Error Detection and Recovery"
2. `Documentation/driver-api/i3c.rst`（Linux内核文档，I3C子系统架构详解）
3. `drivers/i3c/master/cdns-i3c-master.c` — Cadence I3C控制器参考实现
4. `drivers/i3c/device.c` — I3C设备核心API实现

**调试工具准备：**
- 示波器（带宽≥100MHz）+ 差分探头，抓I3C SDA/SCL波形
- `i3c-tools`工具集（从i2c-tools仓库或发行版包管理安装）
- 逻辑分析仪（支持I3C解码，如Saleae或Kingst LA系列）

---

## <span class="blue"> 下一步

I3C三节内容到此结束。我们已经掌握了I3C的物理层信号、协议层CCC/IBI/DAA、以及Linux驱动开发的完整流程。从B-A.5.1到B-A.5.3，I3C这条线应该已经在你脑子里形成了一张完整的图。

下一章我们进入一个全新的世界——**USB**。先来看**`B-B.6.1 USB物理层与拓扑`**，从USB 1.0到USB4，从4线电缆到Type-C正反插，USB的物理层远比I2C/I3C/SPI复杂。准备好了吗？
