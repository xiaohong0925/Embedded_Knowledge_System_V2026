<div class="reader-b2" markdown="1">

# 替换控制器：GPIO 模拟 I2C 为什么不用改外设读取函数

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线 > B-B.3.3 I2C Linux 驱动框架
>
> 阅读路线：第二轮分支

本页只回答一个问题：**换成 GPIO 模拟后，为什么 demo_read_reg() 和两条消息都不需要修改？**

---

> ⚠️ 本页 GPIO 引脚只是语法示例，不是对任何板卡的引脚推荐；教学代码和交互实验室尚未在本篇环境中交叉编译、运行或上板验证。

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

[在实验室中切换 GPIO 模拟并观察时钟延展](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。

## <span class="blue"> 本页自检 Q&A

??? question "换成 GPIO 模拟后，为什么 `demo_read_reg()` 不需要修改？"

    因为它只依赖 client、adapter、消息和 `i2c_transfer()`。i2c-gpio 在 adapter 内安装另一套 `i2c_bit_algo`，由位模拟算法调用 GPIO 回调实现相同的消息语义。改变的是总线实现，不是 AT24 的内部偏移和读取顺序。

---

[上一页：用户态入口](B-B.3.3_I2C Linux驱动框架_userspace.md) · [回到导读与源码地图](B-B.3.3_I2C Linux驱动框架.md)

</div>
