<div class="reader-b2" markdown="1">

# 用户态入口：`/dev/i2c-N` 怎样接到同一 Core

> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线 > B-B.3.3 I2C Linux 驱动框架
>
> 阅读路线：第二轮分支

本页只回答一个问题：**`/dev/i2c-N` 怎样接到同一个 Core，两个进程又共享和独立哪些状态？**

---

> ⚠️ 本页涉及的用户态教学程序尚未在本篇环境中交叉编译、部署、运行或上板验证；示例输出用于推演，不是实测记录。

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

[在实验室中对照用户态入口、匿名 client 与总线锁](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。

## <span class="blue"> 本页自检 Q&A

??? question "用户态 `ioctl(I2C_RDWR)` 在本例为什么也返回 2？"

    v6.6 的 `i2cdev_ioctl_rdwr()` 直接返回 `i2c_transfer()` 的结果。系统调用失败时用户看到 `-1` 和 `errno`；非负返回值仍需检查是否等于消息数，不能只凭非负就认定整组事务完成。

??? question "两个进程同时打开 `/dev/i2c-1`，会共用同一个匿名 client 吗？"

    不会。每次 `open()` 都创建独立的匿名 client，并保存到各自的 `file->private_data`。它们共享 adapter 和物理总线，所以 Core 用总线锁串行化事务；消息数组和用户缓冲区仍然各自独立。

??? question "`/dev/i2c-1` 与 `1-0050/eeprom` 是同一个框架自动创建的两种名字吗？"

    不是。前者由 i2c-dev 监听 adapter 注册并调用 `cdev_device_add()` 创建，是总线入口；后者由 at24 经 NVMEM 在具体 client 上创建，是 EEPROM 外设入口。未绑定 at24 时可以有前者和 `1-0050` 设备目录，却没有 `eeprom` 文件。

---

[上一页：运行传输](B-B.3.3_I2C Linux驱动框架_transfer.md) · [下一页：替换控制器](B-B.3.3_I2C Linux驱动框架_gpio.md)

</div>
