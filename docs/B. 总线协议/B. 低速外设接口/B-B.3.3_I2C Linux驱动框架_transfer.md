<div class="reader-b2" markdown="1">

# 运行传输：两条消息怎样穿过 Core 到达 RK3568

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线 > B-B.3.3 I2C Linux 驱动框架
>
> 阅读路线：首读主线 3／3

本页只回答一个问题：**两条 i2c_msg 怎样穿过 Core 到达 RK3568，并把数据或错误返回调用者？**

---

> ⚠️ 本页涉及的原创教学代码和交互实验室均未在本篇环境中交叉编译、运行或上板验证；页面中的 `0x5a`、日志和波形都是用于推演的样本，不是实测记录。

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

## <span class="blue"> 收回主线：写、移植和修改时分别落在哪一层

沿同一笔读取，现在可以把代码放回正确位置：

1. **改变板上有哪些总线和外设**：修改板级 DTS，核对 `status`、地址、引脚和硬件事实；
2. **写一颗新 I2C 外设驱动**：从 `i2c_driver`、匹配表和 `probe(client)` 开始，用 `i2c_msg` 表达器件事务，不直接写 SoC 寄存器；
3. **移植到另一款 SoC**：外设消息保持不变，选择或移植对应 adapter/algorithm；
4. **修改 RK3568 控制器时序**：进入 `rk3x_i2c`、`i2c_timings`、分频、FIFO、中断和错误恢复；
5. **从用户态验证一笔事务**：使用 i2c-dev 创建的 `/dev/i2c-N`，确认匿名 client、`I2C_RDWR` 和返回值；
6. **没有可用硬件控制器**：用 i2c-gpio 提供另一条 adapter，但接受软件位模拟的时序和性能边界。

[在新窗口打开 I2C Framework Lab](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。实验室中的步骤是依据 v6.6 源码构造的模型推演，不连接真实硬件。

## <span class="blue"> 本页自检 Q&A

??? question "`i2c_transfer()` 返回 2，为什么读到的数据不是 2？"

    返回值 `2` 表示完成了两条消息。读取的数据通过第二条消息的 `buf` 写入 `value`。教学函数再把传输结果转换为自身的 `0` 或负错误，避免把消息数、读取值和初始化结果混为一谈。

---

[上一页：启动建链](B-B.3.3_I2C Linux驱动框架_startup.md) · [第二轮：用户态入口](B-B.3.3_I2C Linux驱动框架_userspace.md)

</div>
