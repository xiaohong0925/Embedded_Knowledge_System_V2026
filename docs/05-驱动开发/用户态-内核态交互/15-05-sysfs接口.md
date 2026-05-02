# sysfs接口

> 📊 **本节难度等级：** <span class="badge-b">**B级**</span>

---

### <strong>sysfs是嵌入式Linux中“连接内核驱动与用户空间”的核心虚拟文件系统，它最核心的价值是将内核中的设备、驱动、总线等硬件/软件资源，以“文件/目录”的形式暴露给用户
——用户无需编写复杂的应用程序（如ioctl调用代码），仅用`cat`/`echo`等基础命令就能查看设备状态、配置设备参数。对新手而言，<span class="green">sysfs</span>是“最快接触硬件状态的窗口”；对开发者而言，它是“简化驱动调试与设备配置”的标准化接口。</strong>


### <strong>sysfs的文件系统特性：挂载路径与目录结构解析
<span class="green">sysfs</span>本质是基于内存的<span class="red">虚拟文件系统</span>（和`/proc`类似，不占用磁盘空间，断电后内容消失），其核心特性是“以文件系统的层级结构映射内核中的资源关系”。
要理解<span class="green">sysfs</span>，首先要掌握它的挂载路径和目录结构规律——这是后续操作sysfs节点的基础。</strong>

1.  基础认知：<span class="green">sysfs</span>是什么？和其他文件系统的区别？
    新手容易混淆`/sys`（<span class="green">sysfs</span>）、`/proc`（进程文件系统）和`/dev`（设备文件系统），这里先明确三者的核心区别：
    | 文件系统 | 核心作用                          | 存储内容                          | 典型操作场景                  |
    |----------|-----------------------------------|-----------------------------------|-------------------------------|
    | sysfs    | 暴露硬件/驱动的“属性”（状态/配置） | 设备参数（如亮度、频率）、驱动信息 | 查看CPU频率、设置LED亮度      |
    | proc     | 暴露进程/内核的“运行状态”         | 进程PID、内核参数、CPU负载        | 查看进程占用（ps依赖）、内存使用（free依赖） |
    | dev      | 提供设备的“访问入口”              | 字符/块设备文件（如/dev/led0）    | 应用程序通过open/read操作设备 |

    一句话总结：`/dev`是“操作设备的门”，`/sys`是“查看/配置设备的控制面板”，`/proc`是“查看系统运行状态的仪表盘”。<br>

### <strong>驱动属性暴露的核心价值：便捷的设备状态查询与配置
<span class="green">sysfs</span>的核心设计目标是“让驱动的属性（设备状态/配置参数）被用户空间便捷访问”——驱动开发者通过简单的API将设备属性“暴露”到sysfs中，用户无需编写任何应用代码，仅用基础命令就能完成交互。
这种“驱动暴露→用户操作”的模式，带来了三大核心价值，也是它成为嵌入式开发基础工具的原因。</strong>

1.  价值1：调试驱动无需编写应用程序（新手最直观的价值）
    在学习ioctl时，新手需要编写驱动+应用程序才能验证设备控制逻辑；而<span class="green">sysfs</span>无需应用程序，直接用`cat`/`echo`就能验证驱动是否正确暴露属性、硬件是否正常响应。

    对比案例：验证温度传感器驱动的正确性
    | 方式       | 操作步骤                                                                 | 复杂度 |
    |------------|--------------------------------------------------------------------------|--------|
    | ioctl方式  | 1. 驱动中定义ioctl命令码；2. 实现unlocked_ioctl函数；3. 编写应用程序调用ioctl；4. 编译运行应用 | 高     |
    | sysfs方式  | 1. 驱动中暴露temp属性节点；2. 执行`cat /sys/class/thermal/thermal_zone0/temp`查看温度 | 低     |

    实际调试场景：某新手开发了一个温度传感器驱动，通过<span class="green">sysfs</span>暴露`temp`节点后，执行`cat /sys/class/thermal/thermal_zone0/temp`输出“28500”（表示28.5℃），立即确认驱动能正确读取硬件数据，整个过程仅需1条命令。<br>

### <strong>sysfs的核心操作链路是“驱动层创建属性节点→内核将节点映射到/sys目录→应用层通过命令读写节点”。
驱动层的核心是“定义属性节点的读写规则”，应用层的核心是“用标准命令交互”——两者结合形成<span class="green">sysfs</span>的完整使用流程。本节从驱动开发和应用操作两个维度拆解，并通过温度传感器案例闭环验证。</strong>


### <strong>驱动层节点创建：device_create_file等函数使用方法
驱动层创建sysfs节点的核心逻辑是“**绑定属性结构体→实现读写回调→注册节点到内核**”。内核提供了标准化的API和宏，避免开发者重复造轮子，新手只需掌握“`struct device_attribute`结构体+`__ATTR`宏+`<span class="green">device_create</span>_file`函数”三要素即可完成节点创建。</strong>

1. 核心三要素：结构体、宏、函数
新手无需深入内核<span class="green">sysfs</span>框架，先牢记以下三个核心组件的作用和使用规范：

| 核心组件                | 作用说明                                                                 | 关键注意点                                                                 |
|-------------------------|--------------------------------------------------------------------------|--------------------------------------------------------------------------|
| `struct device_attribute` | 描述sysfs属性节点的“元数据”（名称、权限、读写回调）                     | 必须初始化`attr.name`（节点名）、`attr.mode`（权限）、`show`（读回调）、`store`（写回调） |
| `__ATTR`宏              | 快速初始化`struct device_attribute`结构体的“语法糖”                     | 宏参数：`name`（节点名）、`mode`（权限）、`show`（读函数）、`store`（写函数） |
| `device_create_file`    | 将属性节点注册到sysfs（关联到指定设备，生成`/sys/class/xxx/name`路径） | 必须在设备创建后调用（如`device_create`之后），卸载时需用`device_remove_file`删除 |

权限说明：`mode`参数遵循Linux文件权限规则（八进制），新手常用权限：
- 只读（如温度、CPU频率）：`0444`（所有用户可读，不可写）；
- 读写（如LED亮度、音量）：`0644`（root可写，所有用户可读）；
- 仅root读写：`0600`（仅限root操作，适合敏感配置）。

回调函数原型：`show`和`store`是节点被读写时的驱动回调，原型固定，新手需严格遵循：
```c
// 读回调：应用执行cat时触发，将驱动数据拷贝到用户空间
// 参数：dev-关联的设备结构体；attr-属性节点元数据；buf-用户空间缓冲区（存储读取结果）
// 返回值：成功返回写入buf的字节数，失败返回负数错误码（如-EINVAL）
ssize_t (*show)(struct device *dev, struct device_attribute *attr, char *buf);

// 写回调：应用执行echo时触发，从用户空间拷贝数据到驱动
// 参数：dev-关联的设备；attr-属性元数据；buf-用户输入的字符串；count-输入字节数
// 返回值：成功返回count（表示处理完所有输入），失败返回负数错误码
ssize_t (*store)(struct device *dev, struct device_attribute *attr, const char *buf, size_t count);
```<br>

### <strong>应用层操作命令：cat/echo命令操作sysfs节点实战
驱动层注册节点后，内核会在`/sys/class/[类名]/[设备名]/`路径下生成对应的属性文件，应用层无需编写代码，仅用`cat`（读）和`echo`（写）即可完成交互——这是<span class="green">sysfs</span>最核心的便捷性优势。</strong>

1. 核心操作命令（以LED的brightness节点为例）
步骤1：查找<span class="green">sysfs</span>节点路径
驱动加载后，通过类路径查找节点（新手推荐此方式，路径固定）：
```bash
# 1. 查看LED类目录下的设备（驱动创建的led0设备）
ls /sys/class/led_sysfs_class/
# 输出：led0

# 2. 进入led0的sysfs目录（属性节点都在此目录下）
cd /sys/class/led_sysfs_class/led0/

# 3. 查看属性节点（驱动注册的brightness节点）
ls
# 输出：brightness  dev  power  subsystem  uevent
# 说明：brightness是我们创建的节点，其他是内核自动生成的辅助节点
```

步骤2：读节点（cat命令）
读取`brightness`节点获取当前LED亮度：
```bash
# 读亮度值（触发驱动的led_brightness_show回调）
cat brightness
# 输出：0（默认亮度，LED熄灭）

# 查看内核日志，确认回调被触发
dmesg | tail -1
# 输出：[12345.678901] LED sysfs driver init success!（无额外日志，读回调仅返回数据）
```

步骤3：写节点（echo命令）
写入亮度值控制LED（需root权限，因节点权限为0644）：
```bash
# 1. 设置亮度为255（最大亮度，触发led_brightness_store回调）
sudo echo 255 > brightness

# 2. 验证写入结果
cat brightness
# 输出：255（LED点亮）

# 3. 查看内核日志，确认驱动处理成功
dmesg | tail -1
# 输出：[12346.123456] LED brightness set to 255

# 4. 测试无效值（验证驱动校验逻辑）
sudo echo 300 > brightness
# 输出：bash: echo: write error: Invalid argument（驱动返回-EINVAL）

# 5. 查看错误日志
dmesg | tail -1
# 输出：[12347.654321] Brightness out of range (0~255)!
```<br>

### <strong>最简实战案例：温度传感器驱动的sysfs属性暴露
本案例实现“模拟温度传感器”的<span class="green">sysfs</span>接口：驱动维护一个模拟温度值（随时间递增，范围0~100℃），通过`temp`只读节点暴露给用户，应用层用`cat`即可查看温度——覆盖“驱动开发→编译→加载→验证”全流程，无硬件依赖（模拟温度），新手可直接复现。</strong>

1. 实战目标
- 驱动层：创建`/sys/class/thermal/tsensor0/temp`只读节点，返回模拟温度值（整数，单位℃）；
- 应用层：用`cat`命令读取温度，验证驱动逻辑；
- 调试：用`<span class="green">dmesg</span>`查看驱动日志，确认节点读写正常。<br>

---
