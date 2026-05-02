# 入门实战：GPIO-LED字符驱动开发

> 📊 **本节难度等级：** <span class="badge-bi">**BI级**</span>

---

### <strong>硬件基础：开发板GPIO与LED的电气连接（以树莓派GPIO17为例）</strong>

<span class="green">GPIO</span>（通用输入输出口，General Purpose Input/Output）是嵌入式开发最基础的硬件资源，
LED驱动的核心是通过控制<span class="green">GPIO</span>引脚的高低电平实现亮灭，B级开发者需先理解“GPIO电气连接逻辑”，I级开发者需补充“GPIO寄存器操作原理”。

1. 硬件电气连接（B级核心）
树莓派3B+/4B的<span class="green">GPIO</span>17引脚与LED的典型连接方式如下（共阴极电路，最常用）：

树莓派引脚布局：
  物理引脚11 (<span class="green">GPIO</span>17) ─┬─ 220Ω电阻 ┬── LED正极 ─┐
                       │             │              │
  物理引脚6 (GND) ───┴───────┴── LED负极 ─┘

- 核心原理[B]：
  1. 限流电阻（220Ω）：避免<span class="green">GPIO</span>输出电流过大烧毁LED或GPIO引脚（树莓派GPIO最大输出电流约16mA，220Ω电阻可将电流控制在5mA左右，符合LED额定电流）；
  2. 电平控制逻辑：<span class="green">GPIO</span>17输出高电平（3.3V）时，LED两端有电压差，电流流过LED点亮；输出低电平（0V）时，无电压差，LED熄灭；
  3. 共阴极设计：LED负极接地，是嵌入式LED驱动的标准设计（若为共阳极，电平逻辑相反）。

- 硬件验证[B]：
  无需驱动，直接通过开发板系统命令验证<span class="green">GPIO</span>17控制LED：
  ```bash
  # 树莓派系统中导出GPIO17（用户层临时控制）
  echo 17 > /sys/class/gpio/export
  # 设置为输出模式
  echo out > /sys/class/gpio/gpio17/direction
  # 输出高电平，LED亮
  echo 1 > /sys/class/gpio/gpio17/value
  # 输出低电平，LED灭
  echo 0 > /sys/class/gpio/gpio17/value
  # 取消导出
  echo 17 > /sys/class/gpio/unexport
  ```<br>

### <strong>驱动开发步骤：设备号申请→接口函数实现→驱动注册与卸载</strong>

本实战基于内核<span class="green">GPIO</span>子系统接口开发LED驱动（B级推荐），
完整链路为“设备号申请→<span class="green">GPIO</span>资源申请→file_operations接口实现→驱动注册→资源释放”，代码兼顾工业规范与入门可读性。

1. 完整驱动代码（led_drv.c）
```c
#include <linux/module.h>
#include <linux/fs.h>
#include <linux/cdev.h>
#include <linux/device.h>
#include <linux/uaccess.h>
#include <linux/gpio.h>
#include <linux/errno.h>

// ==================== 1. 硬件配置（B级可修改） ====================
#define LED_GPIO    17          // 控制LED的GPIO引脚
#define LED_NAME    "led_drv"   // 驱动名称
#define LED_CLASS   "led_class" // 设备类名称
#define LED_DEV_NODE "led"      // /dev节点名称

// ==================== 2. 全局变量定义 ====================
static dev_t led_devno;         // 设备号（主+次）
static struct cdev led_cdev;    // 字符设备核心结构体
static struct class *led_class; // 设备类（用于自动创建设备节点）
static int led_open_count = 0;  // 设备打开次数（独占访问控制）

// ==================== 3. file_operations接口实现 ====================
/**
 * @brief 驱动open接口：申请GPIO资源+配置输出模式+独占访问控制
 * @param inode 设备节点inode结构体
 * @param file 内核文件结构体
 * @return 0=成功，负数=错误码
 */
static int led_open(struct inode *inode, struct file *file) {
    // B级：独占访问控制（仅允许一个进程打开）
    if (led_open_count > 0) {
        printk(KERN_ERR "[%s] device is already opened!\n", LED_NAME);
        return -EBUSY; // 内核标准错误码：设备忙
    }

    // I级：GPIO资源申请与模式配置（内核GPIO子系统接口）
    if (gpio_request(LED_GPIO, LED_NAME) < 0) {
        printk(KERN_ERR "[%s] gpio %d request failed!\n", LED_NAME, LED_GPIO);
        return -EINVAL; // 内核标准错误码：参数无效
    }
    gpio_direction_output(LED_GPIO, 0); // 配置为输出，默认灭

    led_open_count++;
    printk(KERN_INFO "[%s] device opened successfully!\n", LED_NAME);
    return 0;
}

/**
 * @brief 驱动release接口：释放GPIO资源
 * @param inode 设备节点inode结构体
 * @param file 内核文件结构体
 * @return 0=成功
 */
static int led_release(struct inode *inode, struct file *file) {
    // I级：释放GPIO资源（与申请反向操作）
    gpio_free(LED_GPIO);
    led_open_count--;

    printk(KERN_INFO "[%s] device released successfully!\n", LED_NAME);
    return 0;
}

/**
 * @brief 驱动write接口：接收用户层指令控制LED亮灭
 * @param file 内核文件结构体
 * @param buf 用户层传入的指令缓冲区
 * @param count 传入数据长度
 * @param ppos 文件偏移（字符设备无意义）
 * @return 写入字节数，负数=错误码
 */
static ssize_t led_write(struct file *file, const char __user *buf, size_t count, loff_t *ppos) {
    char cmd[32] = {0};
    int led_state;

    // B级：用户层→内核层数据拷贝（安全校验）
    if (copy_from_user(cmd, buf, count) != 0) {
        printk(KERN_ERR "[%s] copy_from_user failed!\n", LED_NAME);
        return -EFAULT; // 内核标准错误码：地址错误
    }

    // B级：解析用户层指令（支持"on"/"1"亮，"off"/"0"灭）
    if (strcmp(cmd, "1\n") == 0 || strcmp(cmd, "on\n") == 0) {
        led_state = 1;
        gpio_set_value(LED_GPIO, 1); // LED亮
    } else if (strcmp(cmd, "0\n") == 0 || strcmp(cmd, "off\n") == 0) {
        led_state = 0;
        gpio_set_value(LED_GPIO, 0); // LED灭
    } else {
        printk(KERN_ERR "[%s] invalid cmd: %s\n", LED_NAME, cmd);
        return -EINVAL;
    }

    printk(KERN_INFO "[%s] set LED state to %d\n", LED_NAME, led_state);
    return count; // 返回写入字节数
}

/**
 * @brief 驱动read接口：读取当前LED状态
 * @param file 内核文件结构体
 * @param buf 用户层缓冲区（存储状态）
 * @param count 读取长度
 * @param ppos 文件偏移
 * @return 读取字节数，负数=错误码
 */
static ssize_t led_read(struct file *file, char __user *buf, size_t count, loff_t *ppos) {
    int led_state = gpio_get_value(LED_GPIO); // I级：读取GPIO当前电平
    char state_str[8] = {0};
    sprintf(state_str, "%d\n", led_state); // 转换为字符串（0/1）

    // B级：内核层→用户层数据拷贝
    if (copy_to_user(buf, state_str, strlen(state_str)) != 0) {
        printk(KERN_ERR "[%s] copy_to_user failed!\n", LED_NAME);
        return -EFAULT;
    }

    return strlen(state_str); // 返回读取字节数
}

// ==================== 4. 绑定file_operations接口集 ====================
static const struct file_operations led_fops = {
    .owner = THIS_MODULE,    // I级：绑定模块所有权，避免卸载时崩溃
    .open = led_open,        // 绑定打开接口
    .release = led_release,  // 绑定关闭接口
    .read = led_read,        // 绑定读取状态接口
    .write = led_write,      // 绑定控制亮灭接口
};

// ==================== 5. 驱动初始化/退出函数 ====================
/**
 * @brief 驱动初始化（加载时执行）：设备号申请→cdev注册→创建设备节点
 */
static int __init led_drv_init(void) {
    int ret;

    // Step1：动态申请设备号（I级：避免冲突，嵌入式首选）
    ret = alloc_chrdev_region(&led_devno, 0, 1, LED_NAME);
    if (ret < 0) {
        printk(KERN_ERR "[%s] alloc chrdev region failed!\n", LED_NAME);
        return ret;
    }
    printk(KERN_INFO "[%s] alloc major=%d, minor=%d\n", LED_NAME, MAJOR(led_devno), MINOR(led_devno));

    // Step2：初始化cdev并绑定file_operations
    cdev_init(&led_cdev, &led_fops);
    led_cdev.owner = THIS_MODULE;

    // Step3：注册cdev到内核
    ret = cdev_add(&led_cdev, led_devno, 1);
    if (ret < 0) {
        printk(KERN_ERR "[%s] cdev add failed!\n", LED_NAME);
        unregister_chrdev_region(led_devno, 1); // 失败时释放设备号
        return ret;
    }

    // Step4：创建设备类（自动生成/dev节点）
    led_class = class_create(THIS_MODULE, LED_CLASS);
    if (IS_ERR(led_class)) {
        printk(KERN_ERR "[%s] class create failed!\n", LED_NAME);
        cdev_del(&led_cdev);
        unregister_chrdev_region(led_devno, 1);
        return PTR_ERR(led_class);
    }

    // Step5：自动创建/dev/led节点
    if (IS_ERR(device_create(led_class, NULL, led_devno, NULL, LED_DEV_NODE))) {
        printk(KERN_ERR "[%s] device create failed!\n", LED_NAME);
        class_destroy(led_class);
        cdev_del(&led_cdev);
        unregister_chrdev_region(led_devno, 1);
        return -EINVAL;
    }

    printk(KERN_INFO "[%s] driver loaded successfully!\n", LED_NAME);
    return 0;
}

/**
 * @brief 驱动退出（卸载时执行）：反向释放资源
 */
static void __exit led_drv_exit(void) {
    // 释放顺序：设备节点→设备类→cdev→设备号（与申请反向）
    device_destroy(led_class, led_devno);
    class_destroy(led_class);
    cdev_del(&led_cdev);
    unregister_chrdev_region(led_devno, 1);

    printk(KERN_INFO "[%s] driver unloaded successfully!\n", LED_NAME);
}

// ==================== 6. 模块注册与许可证 ====================
module_init(led_drv_init);
module_exit(led_drv_exit);

MODULE_LICENSE("GPL");          // 必须：GPL许可证，避免内核报tainted警告
MODULE_AUTHOR("Embedded Linux Developer");
MODULE_DESCRIPTION("GPIO-LED Char Device Driver for Raspberry Pi");
MODULE_VERSION("1.0");
```<br>

### <strong>编译与测试：Makefile编写、驱动加载/卸载、`echo`命令控制LED亮灭</strong>

1. 编写Makefile（适配树莓派ARM架构）
```makefile
# ==================== Makefile（led_drv.mk） ====================
# 内核源码路径（需替换为自己的树莓派内核源码目录）
# 树莓派3B+推荐内核版本：linux-5.4.70
KERNELDIR ?= ~/embedded/linux-5.4.70-rpi-3b
# 当前驱动代码目录
PWD := $(shell pwd)
# 交叉编译工具链（树莓派ARMv7）
CROSS_COMPILE := arm-linux-gnueabihf-
# 架构类型
ARCH := arm

# 默认目标：编译驱动模块
all:
 @echo "Compiling led_drv.ko..."
 make -C $(KERNELDIR) M=$(PWD) ARCH=$(ARCH) CROSS_COMPILE=$(CROSS_COMPILE) modules

# 清理编译产物
clean:
 @echo "Cleaning compile files..."
 make -C $(KERNELDIR) M=$(PWD) ARCH=$(ARCH) CROSS_COMPILE=$(CROSS_COMPILE) clean
 rm -rf .*.cmd *.o *.mod.c .tmp_versions modules.order Module.symvers

# 指定要编译的驱动文件（led_drv.c → led_drv.ko）
obj-m += led_drv.o
```<br>

### <strong>基础调试：`dmesg`排查驱动加载异常、驱动卸载失败的处理
驱动调试的核心是“通过内核日志定位问题”，B级开发者需掌握`<span class="green">dmesg</span>`的基础用法，
I级开发者需理解“错误码的内核含义”和“资源泄漏的排查方法”。</strong>

1. 驱动加载异常排查（B→I级）
（1）场景1：设备号被占用
```bash
# 现象：insmod加载失败，dmesg日志如下
dmesg | grep led_drv
# 输出：[1234.567890] led_drv: alloc chrdev region failed!
# I级分析：动态申请设备号失败，大概率是内核无空闲主设备号，或驱动名称冲突
# 解决方法：
# Step1：查看已占用的主设备号
cat /proc/devices | grep 240  # 若有输出，说明240被占用
# Step2：改用静态分配（指定未被占用的主设备号，如241）
# 修改代码：
#define LED_MAJOR 241
dev_t led_devno = MKDEV(LED_MAJOR, 0);
ret = register_chrdev_region(led_devno, 1, LED_NAME);
```

（2）场景2：<span class="green">GPIO</span>资源被占用
```bash
# 现象：insmod加载成功，但echo控制无反应，dmesg日志如下
dmesg | grep led_drv
# 输出：[1234.567890] led_drv: gpio 17 request failed!
# I级分析：GPIO17已被其他驱动/进程占用（如树莓派默认的LED驱动）
# 解决方法：
# Step1：查看GPIO占用状态
cat /sys/kernel/debug/gpio | grep 17
# 输出：gpio-17 (led_drv           ) out hi
# Step2：卸载占用GPIO的驱动
rmmod leds_gpio  # 卸载系统默认LED驱动
# Step3：重新加载自己的驱动
insmod led_drv.ko
```<br>

---
