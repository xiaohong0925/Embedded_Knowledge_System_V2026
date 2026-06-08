# B-A.3.3 SPI Linux驱动框架 [知识点285-286]

> 所属章节：第五部 B. 总线协议 > B-A.3 SPI串行外设接口
>
> 难度：[I] Intermediate | [M] Master | 预计阅读时间：45分钟

## <span class="blue"> 本节导读

上两节我们搞清楚了SPI的物理时序和硬件接线。本节进入实战核心——**Linux SPI子系统**。你将了解从`spi_master`到`spi_device`的完整软件架构，掌握`spi_sync()`与`spi_async()`两种传输模式，学会通过设备树配置SPI外设，并借助`spidev`在用户空间快速验证硬件。最后，我们将用两个完整的行业实例——**W25Q128 NOR Flash**的驱动开发和**ST7789 LCD屏**的spidev控制——把理论知识焊接到工程实践中。

<br>

---

## <span class="blue"> 知识点285 Linux SPI子系统架构 [I][M]

Linux的SPI子系统采用**总线-设备-驱动**的经典分层模型。与I2C子系统类似，但SPI的传输语义更灵活——每个`spi_message`可以由多个`spi_transfer`组成，支持全双工、半双工、多段传输等复杂场景。

<br>

### SPI子系统的五大核心结构体

| 结构体 | 职责 | 关键字段 |
|--------|------|----------|
| `struct spi_master` | 代表一个SPI控制器（总线主设备），管理片选、时钟、传输队列 | `bus_num`（总线号）, `num_chipselect`, `transfer()`/`transfer_one()`（传输方法）, `setup()`（设备配置）, `dma_tx`/`dma_rx`（DMA通道） |
| `struct spi_device` | 代表一个SPI从设备，挂在某个master下 | `master`（所属控制器）, `chip_select`（片选号）, `max_speed_hz`（最大时钟）, `mode`（CPOL/CPHA/LSB等模式位）, `irq` |
| `struct spi_driver` | 驱动程序，匹配并操作spi_device | `probe()`/`remove()`, `driver.name`, `driver.of_match_table` |
| `struct spi_transfer` | 单次SPI传输操作（读或写，或同时读写） | `tx_buf`/`rx_buf`（发送/接收缓冲区）, `len`（长度）, `speed_hz`（本次传输时钟）, `delay_usecs`（段间延迟）, `cs_change`（是否改变片选） |
| `struct spi_message` | 一次完整的SPI消息，由多个transfer组成 | `transfers`（transfer链表）, `spi`（目标设备）, `complete`（完成回调）, `context`（回调上下文）, `status`（执行结果） |

<br>

### 架构关系图

```
┌──────────────────────────────────────────────────────┐
│                    用户空间                            │
│  /dev/spidev0.0    /dev/spidev0.1    spi_flash mtd   │
├──────────────────────────────────────────────────────┤
│  spidev.c        spi-nor.c        fb_st7789.c        │
│     │                  │                │            │
│     ▼                  ▼                ▼            │
│  spi_driver        spi_driver       spi_driver        │
│     │                  │                │            │
├─────┴──────────────────┴────────────────┴────────────┤
│                   SPI 核心层 (spi.c)                  │
│   spi_sync() / spi_async() / spi_setup() / ...      │
├──────────────────────────────────────────────────────┤
│                  SPI 控制器驱动                        │
│   spi_master (注册/注销/transfer_one/ DMA支持)        │
├──────────────────────────────────────────────────────┤
│                  平台SPI控制器硬件                      │
│   AM335x SPI0/1  |  i.MX6 ECSPI  |  STM32 SPI        │
└──────────────────────────────────────────────────────┘
```

<br>

### 设备树SPI节点配置详解

SPI控制器节点在设备树中的标准结构如下。以AM335x为例：

```dts
// 1. SPI控制器节点（定义master）
&spi0 {
    pinctrl-names = "default";
    pinctrl-0 = <&spi0_pins>;
    status = "okay";
    
    // SPI控制器时钟和片选配置
    ti,spi-num-cs = <2>;           // 两个片选
    ti,spi-wdelay = <0>;
    
    // 2. SPI从设备子节点
    w25q128@0 {
        compatible = "jedec,spi-nor";
        reg = <0>;                  // 片选0
        spi-max-frequency = <50000000>;  // 50MHz
        spi-cpol;                   // CPOL=1
        spi-cpha;                   // CPHA=1 → Mode 3
        m25p,fast-read;             // 支持Fast Read
        label = "nor0";
    };
    
    st7789@1 {
        compatible = "sitronix,st7789";
        reg = <1>;                  // 片选1
        spi-max-frequency = <32000000>;  // 32MHz
        spi-cpol;
        spi-cpha;
        
        // LCD专用属性
        width = <240>;
        height = <320>;
        rotate = <0>;
        
        // 额外的控制GPIO
        reset-gpios = <&gpio1 18 GPIO_ACTIVE_LOW>;
        dc-gpios = <&gpio1 28 GPIO_ACTIVE_HIGH>;  // 数据/命令选择
        led-gpios = <&gpio1 16 GPIO_ACTIVE_HIGH>;  // 背光
    };
};
```

> ⚠️ **陷阱**：`spi-cpol`和`spi-cpha`是**布尔属性**，存在即表示置1。很多新手写成`spi-cpol = <1>`虽然不会报错，但语法上不规范。正确写法是直接写`spi-cpol;`。

<br>

### 驱动注册与匹配流程

```c
// SPI Flash驱动注册示例
static const struct of_device_id spi_nor_of_match[] = {
    { .compatible = "jedec,spi-nor" },
    { .compatible = "winbond,w25q128" },
    { }
};

static struct spi_driver spi_nor_driver = {
    .driver = {
        .name = "spi-nor",
        .of_match_table = spi_nor_of_match,
    },
    .probe  = spi_nor_probe,    // 匹配成功时调用
    .remove = spi_nor_remove,
};

module_spi_driver(spi_nor_driver);  // 宏展开为注册/注销
```

匹配顺序：设备树`compatible` → `spi_driver.id_table` → `spi_driver.driver.name`。通常只用`of_match_table`即可。

<br>

### 传输流程：从spi_message到硬件信号

```
用户调用 spi_sync(spi, msg)
        │
        ▼
┌───────────────┐
│  spi_validate │  检查msg合法性
│   _bits_per_word
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ master->queue │  加入控制器队列（或直接进入transfer_one）
│   _message    │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ spi_map_msg   │  DMA映射：tx_buf/rx_buf → dma_addr
│   (可选)      │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ master->      │  控制器驱动实现：配置时钟、极性、
│ transfer_one  │  逐段发送transfer，操作硬件寄存器
│ _message      │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ spi_unmap_msg │  DMA解映射
│   complete()  │  唤醒等待者 / 调用回调
└───────────────┘
```

<br>

---

## <span class="blue"> 知识点286 SPI核心API与spidev用户空间接口 [I]

### 同步与异步传输API

| 函数 | 功能 | 关键参数 | 返回值 |
|------|------|----------|--------|
| `int spi_sync(struct spi_device *spi, struct spi_message *msg)` | 同步传输：阻塞直到msg完成 | `spi`目标设备，`msg`组装好的消息 | 0成功，负值为错误码 |
| `int spi_async(struct spi_device *spi, struct spi_message *msg)` | 异步传输：提交到队列立即返回，完成时调用`msg->complete` | 同上，`msg->complete`不能为NULL | 0表示提交成功（非传输成功） |
| `int spi_write_then_read(struct spi_device *spi, const void *txbuf, unsigned n_tx, void *rxbuf, unsigned n_rx)` | 便捷函数：先写后读，常用于命令+数据的典型交互 | `n_tx`发送字节数，`n_rx`接收字节数 | 0成功 |
| `int spi_write(struct spi_device *spi, const void *buf, size_t len)` | 只发送不接收 | `buf`发送缓冲区，`len`长度 | 0成功 |
| `int spi_read(struct spi_device *spi, void *buf, size_t len)` | 只接收不发送（MOSI发0） | `rxbuf`接收缓冲区 | 0成功 |

<br>

### spi_sync() vs spi_async() 的选择

```
场景判断：

    传输长度 < 1KB 且 不追求极致吞吐？
         │
    ┌────┴────┐
    ▼         ▼
   是        否
    │         │
    ▼         ▼
 spi_sync  需要同时发起多个传输？
 简单可靠       │
            ┌───┴───┐
            ▼       ▼
           是       否
            │       │
            ▼       ▼
         spi_async  spi_sync + DMA
        + 完成回调
        注意：ISR上下文
        不能睡眠！
```

<br>

### spidev：用户空间直接操作SPI

`spidev`是Linux内核提供的通用SPI驱动，将SPI设备暴露为`/dev/spidevB.C`字符设备（B=总线号，C=片选号）。

**常用ioctl命令：**

| 命令 | 功能 | 参数类型 | 说明 |
|------|------|----------|------|
| `SPI_IOC_RD_MODE` / `SPI_IOC_WR_MODE` | 读/写SPI模式 | `__u8` | CPOL/CPHA/CS_HIGH/LSB_FIRST等位掩码 |
| `SPI_IOC_RD_BITS_PER_WORD` / `SPI_IOC_WR_BITS_PER_WORD` | 读/写每字位数 | `__u8` | 通常为8 |
| `SPI_IOC_RD_MAX_SPEED_HZ` / `SPI_IOC_WR_MAX_SPEED_HZ` | 读/写最大时钟 | `__u32` | Hz单位 |
| `SPI_IOC_MESSAGE(n)` | 执行一次完整传输 | `struct spi_ioc_transfer[n]` | 最核心的命令 |

<br>

### spidev与专用驱动的对比

```
        ┌─────────────────────────────────────────┐
        │            你的应用代码                    │
        └─────────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
    ┌───────────┐          ┌──────────────┐
    │ /dev/spi  │          │ /dev/mtd0    │
    │ dev0.0    │          │ /dev/fb0     │
    └─────┬─────┘          └──────┬───────┘
          │                       │
          ▼                       ▼
    ┌───────────┐          ┌──────────────┐
    │  spidev   │          │ spi-nor /    │
    │  (通用)   │          │ fb_st7789    │
    │           │          │ (专用驱动)    │
    │  每次ioctl│          │  内核缓冲    │
    │  都copy   │          │  批量传输    │
    │  _from/to│          │  性能更好    │
    │  _user   │          │              │
    └─────┬─────┘          └──────┬───────┘
          │                       │
          └───────────┬───────────┘
                      ▼
              ┌──────────────┐
              │   SPI核心层   │
              └──────────────┘
```

> 💡 **提示**：`spidev`适合**快速原型验证**和**非性能敏感**的场景。生产环境中，建议为外设编写**专用驱动**——可以在内核空间批量缓冲数据、利用DMA一次性传输、避免每次系统调用的用户态/内核态切换开销。

<br>

### DMA传输优化要点

1. **DMA友好的缓冲区**：使用`kmalloc()`分配的内存（物理连续），或预先通过`dma_alloc_coherent()`分配DMA一致性内存
2. **传输阈值**：短传输（< 32字节）用PIO反而更快，避免DMA设置开销
3. **批量传输**：将多个小transfer合并为一个大的`spi_message`，减少中断次数
4. **检查控制器DMA支持**：`master->dma_tx && master->dma_rx`表示控制器支持DMA

<br>

---

## <span class="blue"> 行业实例：SPI NOR Flash（W25Q128）+ SPI LCD（ST7789）

### 实例概述

我们将构建一个完整的双设备SPI系统：

```
                    AM335x SPI0
                        │
            ┌───────────┴───────────┐
            │ CS0                   │ CS1
            ▼                       ▼
    ┌──────────────┐      ┌──────────────────┐
    │  W25Q128JV   │      │    ST7789        │
    │  128Mbit     │      │  240×320 LCD     │
    │  NOR Flash   │      │   Controller     │
    │              │      │                  │
    │  命令交互：  │      │  DC ── GPIO1_28  │
    │  0x9F 读ID  │      │  RST ─ GPIO1_18  │
    │  0x20 擦除  │      │  BL ── GPIO1_16  │
    │  0x02 编程  │      │                  │
    │  0x03 读取  │      │  命令+数据突发    │
    └──────────────┘      └──────────────────┘
```

<br>

### 完整设备树配置

```dts
// arch/arm/boot/dts/am335x-custom.dts

/ {
    model = "Custom SPI Board";
    compatible = "ti,am335x-bone-black", "ti,am335x-bone", "ti,am33xx";
};

&am33xx_pinmux {
    spi0_pins: spi0_pins {
        pinctrl-single,pins = <
            AM33XX_PADCONF(AM335X_SPI0_SCLK, PIN_INPUT_PULLUP, MUX_MODE0)
            AM33XX_PADCONF(AM335X_SPI0_D0,   PIN_INPUT_PULLUP, MUX_MODE0)
            AM33XX_PADCONF(AM335X_SPI0_D1,   PIN_OUTPUT_PULLDOWN, MUX_MODE0)
            AM33XX_PADCONF(AM335X_SPI0_CS0,  PIN_OUTPUT_PULLUP, MUX_MODE0)
            AM33XX_PADCONF(AM335X_SPI0_CS1,  PIN_OUTPUT_PULLUP, MUX_MODE0)
        >;
    };
    
    st7789_gpio_pins: st7789_gpio_pins {
        pinctrl-single,pins = <
            AM33XX_PADCONF(AM335X_GPMC_A0,   PIN_OUTPUT, MUX_MODE7)   /* GPIO1_16 BL */
            AM33XX_PADCONF(AM335X_GPMC_A1,   PIN_OUTPUT, MUX_MODE7)   /* GPIO1_17 RST */
            AM33XX_PADCONF(AM335X_GPMC_A2,   PIN_OUTPUT, MUX_MODE7)   /* GPIO1_18 DC */
        >;
    };
};

&spi0 {
    pinctrl-names = "default";
    pinctrl-0 = <&spi0_pins>;
    status = "okay";
    ti,spi-num-cs = <2>;
    
    /* --- 设备1：W25Q128 NOR Flash --- */
    flash@0 {
        compatible = "jedec,spi-nor";
        reg = <0>;
        spi-max-frequency = <50000000>;  /* 50MHz，Flash最高支持104MHz */
        spi-cpol;
        spi-cpha;
        m25p,fast-read;
        label = "w25q128";
        
        /* 分区表 */
        partitions {
            compatible = "fixed-partitions";
            #address-cells = <1>;
            #size-cells = <1>;
            
            partition@0 {
                label = "uboot";
                reg = <0x000000 0x080000>;   /* 512KB */
                read-only;
            };
            partition@80000 {
                label = "kernel";
                reg = <0x080000 0x700000>;   /* 7MB */
            };
            partition@780000 {
                label = "rootfs";
                reg = <0x780000 0x880000>;   /* 8.5MB */
            };
        };
    };
    
    /* --- 设备2：ST7789 LCD --- */
    display@1 {
        compatible = "sitronix,st7789";
        reg = <1>;
        spi-max-frequency = <32000000>;  /* 32MHz */
        spi-cpol;
        spi-cpha;
        
        width = <240>;
        height = <320>;
        rotate = <0>;
        
        reset-gpios = <&gpio1 17 GPIO_ACTIVE_LOW>;
        dc-gpios = <&gpio1 18 GPIO_ACTIVE_HIGH>;
        led-gpios = <&gpio1 16 GPIO_ACTIVE_HIGH>;
    };
};
```

<br>

### W25Q128 驱动代码：JEDEC ID读取 + 页编程 + 整片擦除

```c
/* drivers/mtd/spi-nor/spi-nor-w25q128.c - W25Q128 Flash操作示例 */
#include <linux/module.h>
#include <linux/mtd/mtd.h>
#include <linux/mtd/spi-nor.h>
#include <linux/spi/spi.h>
#include <linux/of.h>
#include <linux/slab.h>

/* W25Q128 命令定义 */
#define W25X_WRITE_ENABLE       0x06
#define W25X_WRITE_DISABLE      0x04
#define W25X_READ_STATUS_REG1   0x05
#define W25X_READ_DATA          0x03
#define W25X_PAGE_PROGRAM       0x02
#define W25X_SECTOR_ERASE       0x20    /* 4KB */
#define W25X_BLOCK_ERASE_32K    0x52
#define W25X_BLOCK_ERASE_64K    0xD8
#define W25X_CHIP_ERASE         0xC7
#define W25X_JEDEC_ID           0x9F

#define W25X_SR1_WIP            BIT(0)  /* Write In Progress */
#define W25X_PAGE_SIZE          256
#define W25X_SECTOR_SIZE        4096

struct w25q128_flash {
    struct spi_device *spi;
    struct mtd_info mtd;
};

/**
 * w25q128_read_jedec_id() - 读取JEDEC ID，验证Flash型号
 * 
 * 发送0x9F命令，接收3字节：Manufacturer ID + Memory Type + Capacity
 * W25Q128JV 应返回：0xEF 0x40 0x18
 */
static int w25q128_read_jedec_id(struct spi_device *spi, u8 *id)
{
    u8 tx = W25X_JEDEC_ID;
    int ret;
    
    /* spi_write_then_read: 先发1字节命令，再读3字节 */
    ret = spi_write_then_read(spi, &tx, 1, id, 3);
    if (ret < 0) {
        dev_err(&spi->dev, "JEDEC ID读取失败: %d\n", ret);
        return ret;
    }
    
    dev_info(&spi->dev, "JEDEC ID: %02X %02X %02X\n", id[0], id[1], id[2]);
    
    if (id[0] != 0xEF || id[2] != 0x18) {
        dev_warn(&spi->dev, "非预期Flash型号 (期望Winbond 128Mbit)\n");
        return -ENODEV;
    }
    
    dev_info(&spi->dev, "W25Q128JV 检测成功\n");
    return 0;
}

/**
 * w25q128_wait_ready() - 等待Flash完成内部操作
 * 
 * Flash编程/擦除是异步的——命令发出后内部控制器需要时间完成。
 * 必须轮询状态寄存器的WIP位，直到变为0。
 */
static int w25q128_wait_ready(struct spi_device *spi)
{
    u8 tx = W25X_READ_STATUS_REG1;
    u8 status;
    int ret;
    unsigned int timeout = 10000;  /* 10秒超时 */
    
    do {
        ret = spi_write_then_read(spi, &tx, 1, &status, 1);
        if (ret < 0)
            return ret;
        
        if (--timeout == 0) {
            dev_err(&spi->dev, "Flash操作超时!\n");
            return -ETIMEDOUT;
        }
        udelay(10);  /* 短暂等待，减轻总线负载 */
    } while (status & W25X_SR1_WIP);
    
    return 0;
}

/**
 * w25q128_write_enable() - 设置写使能锁存器
 * 
 * W25Q128每次编程/擦除前必须先发送Write Enable(0x06)，
 * 否则后续写命令会被静默忽略！
 */
static int w25q128_write_enable(struct spi_device *spi)
{
    u8 tx = W25X_WRITE_ENABLE;
    return spi_write(spi, &tx, 1);
}

/**
 * w25q128_erase_sector() - 擦除一个4KB扇区
 * 
 * ⚠️ 擦除操作将扇区内所有位设为1（即0xFF）。
 * 这是Flash物理特性决定的——只能从1写到0，反过来必须先擦除。
 */
static int w25q128_erase_sector(struct spi_device *spi, u32 addr)
{
    u8 cmd[4] = { W25X_SECTOR_ERASE,
                  (addr >> 16) & 0xFF,
                  (addr >> 8) & 0xFF,
                  addr & 0xFF };
    int ret;
    
    ret = w25q128_write_enable(spi);
    if (ret) return ret;
    
    ret = spi_write(spi, cmd, 4);
    if (ret) return ret;
    
    return w25q128_wait_ready(spi);  /* 典型擦除时间：45ms */
}

/**
 * w25q128_page_program() - 向一页（256字节）写入数据
 * 
 * ⚠️ 写入前必须确保目标区域已擦除！
 * Flash的位只能从1→0，不能直接0→1。
 * 如果试图在未擦除的0x00位置写入0xFF，结果仍是0x00。
 */
static int w25q128_page_program(struct spi_device *spi, u32 addr,
                                 const u8 *buf, size_t len)
{
    u8 *cmd_buf;
    int ret;
    
    if (len > W25X_PAGE_SIZE)
        len = W25X_PAGE_SIZE;
    
    /* 分配命令+数据的连续缓冲区 */
    cmd_buf = kmalloc(1 + 3 + len, GFP_KERNEL);
    if (!cmd_buf)
        return -ENOMEM;
    
    cmd_buf[0] = W25X_PAGE_PROGRAM;
    cmd_buf[1] = (addr >> 16) & 0xFF;
    cmd_buf[2] = (addr >> 8) & 0xFF;
    cmd_buf[3] = addr & 0xFF;
    memcpy(cmd_buf + 4, buf, len);
    
    ret = w25q128_write_enable(spi);
    if (ret) goto out;
    
    ret = spi_write(spi, cmd_buf, 4 + len);
    if (ret) goto out;
    
    ret = w25q128_wait_ready(spi);  /* 典型编程时间：0.4ms/页 */
    
out:
    kfree(cmd_buf);
    return ret;
}

/* probe函数：设备匹配时调用 */
static int w25q128_probe(struct spi_device *spi)
{
    struct w25q128_flash *flash;
    u8 jedec_id[3];
    int ret;
    
    dev_info(&spi->dev, "W25Q128 驱动 probe\n");
    
    /* 1. 验证JEDEC ID */
    ret = w25q128_read_jedec_id(spi, jedec_id);
    if (ret)
        return ret;
    
    /* 2. 初始化结构体 */
    flash = devm_kzalloc(&spi->dev, sizeof(*flash), GFP_KERNEL);
    if (!flash)
        return -ENOMEM;
    
    flash->spi = spi;
    spi_set_drvdata(spi, flash);
    
    /* 3. 注册MTD设备（实际驱动中使用spi-nor子系统框架） */
    flash->mtd.name = "w25q128";
    flash->mtd.type = MTD_NORFLASH;
    flash->mtd.size = 16 * 1024 * 1024;  /* 16MB = 128Mbit */
    flash->mtd.writesize = 1;
    flash->mtd.writebufsize = W25X_PAGE_SIZE;
    flash->mtd.erasesize = W25X_SECTOR_SIZE;
    
    dev_info(&spi->dev, "W25Q128 16MB Flash 初始化完成\n");
    return 0;
}

static int w25q128_remove(struct spi_device *spi)
{
    dev_info(&spi->dev, "W25Q128 驱动 remove\n");
    return 0;
}

static const struct of_device_id w25q128_of_match[] = {
    { .compatible = "winbond,w25q128" },
    { .compatible = "jedec,spi-nor" },
    { }
};
MODULE_DEVICE_TABLE(of, w25q128_of_match);

static struct spi_driver w25q128_driver = {
    .driver = {
        .name = "w25q128",
        .of_match_table = w25q128_of_match,
    },
    .probe  = w25q128_probe,
    .remove = w25q128_remove,
};
module_spi_driver(w25q128_driver);

MODULE_AUTHOR("Embedded Linux Developer");
MODULE_DESCRIPTION("W25Q128 SPI NOR Flash Driver");
MODULE_LICENSE("GPL");
```

> ⚠️ **陷阱**：**SPI Flash编程前必须先擦除**。这是NOR Flash的物理特性——浮栅晶体管只能通过擦除操作将所有位释放为1，编程操作只能将1压为0。直接对未擦除区域写入会导致数据错乱，且不会有任何错误返回！

<br>

### 用户空间spidev代码：ST7789 LCD初始化 + 画像素

```c
/* userspace/st7789_spidev.c - 通过spidev控制ST7789 LCD */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/spi/spidev.h>
#include <linux/gpio.h>

#define SPI_DEVICE      "/dev/spidev0.1"
#define GPIO_DC         "/sys/class/gpio/gpio48/value"  /* GPIO1_16 = 48 */
#define GPIO_RST        "/sys/class/gpio/gpio49/value"  /* GPIO1_17 = 49 */

#define ST7789_WIDTH    240
#define ST7789_HEIGHT   320

/* ST7789 命令定义 */
#define CMD_SWRESET     0x01    /* 软件复位 */
#define CMD_SLPOUT      0x11    /* 退出睡眠 */
#define CMD_NORON       0x13    /* 正常显示 */
#define CMD_INVON       0x21    /* 反色开启 */
#define CMD_CASET       0x2A    /* 列地址设置 */
#define CMD_RASET       0x2B    /* 行地址设置 */
#define CMD_RAMWR       0x2C    /* 写显存 */
#define CMD_COLMOD      0x3A    /* 颜色模式 */
#define CMD_MADCTL      0x36    /* 存储访问控制 */
#define CMD_DISPON      0x29    /* 显示开启 */

static int spi_fd;
static int gpio_dc_fd;
static int gpio_rst_fd;

/**
 * gpio_write() - 通过sysfs控制GPIO电平
 */
static void gpio_write(int fd, int val)
{
    char buf[2];
    buf[0] = val ? '1' : '0';
    buf[1] = '\0';
    lseek(fd, 0, SEEK_SET);
    write(fd, buf, 1);
}

/**
 * st7789_write_command() - 发送命令（DC=0）
 * st7789_write_data() - 发送数据（DC=1）
 */
static void st7789_write_command(u_int8_t cmd)
{
    gpio_write(gpio_dc_fd, 0);  /* DC=0: 命令 */
    struct spi_ioc_transfer tr = {
        .tx_buf = (unsigned long)&cmd,
        .len = 1,
        .speed_hz = 32000000,
        .delay_usecs = 0,
    };
    ioctl(spi_fd, SPI_IOC_MESSAGE(1), &tr);
}

static void st7789_write_data(const u_int8_t *data, size_t len)
{
    gpio_write(gpio_dc_fd, 1);  /* DC=1: 数据 */
    struct spi_ioc_transfer tr = {
        .tx_buf = (unsigned long)data,
        .len = len,
        .speed_hz = 32000000,
    };
    ioctl(spi_fd, SPI_IOC_MESSAGE(1), &tr);
}

/**
 * st7789_reset() - 硬件复位序列
 */
static void st7789_reset(void)
{
    gpio_write(gpio_rst_fd, 1);
    usleep(10000);
    gpio_write(gpio_rst_fd, 0);   /* 拉低复位 */
    usleep(10000);
    gpio_write(gpio_rst_fd, 1);   /* 释放 */
    usleep(120000);                /* 等待稳定（>120ms） */
}

/**
 * st7789_init() - ST7789完整初始化命令序列
 * 
 * 每个LCD控制器都有厂家规定的初始化序列，必须严格按顺序执行。
 */
static void st7789_init(void)
{
    st7789_reset();
    
    /* 1. 软件复位 */
    st7789_write_command(CMD_SWRESET);
    usleep(150000);
    
    /* 2. 退出睡眠模式 */
    st7789_write_command(CMD_SLPOUT);
    usleep(120000);
    
    /* 3. 设置颜色模式：16bit RGB565 */
    st7789_write_command(CMD_COLMOD);
    u_int8_t colmod = 0x55;  /* 16-bit/pixel */
    st7789_write_data(&colmod, 1);
    
    /* 4. 设置方向：MY=0, MX=0, MV=0, RGB=1 */
    st7789_write_command(CMD_MADCTL);
    u_int8_t madctl = 0x00;  /* 正常方向 */
    st7789_write_data(&madctl, 1);
    
    /* 5. 反色开启（部分屏需要） */
    st7789_write_command(CMD_INVON);
    
    /* 6. 开启显示 */
    st7789_write_command(CMD_NORON);
    usleep(10000);
    
    /* 7. 主显示开启 */
    st7789_write_command(CMD_DISPON);
    usleep(10000);
    
    printf("ST7789 初始化完成\n");
}

/**
 * st7789_set_address() - 设置绘图窗口
 */
static void st7789_set_address(u_int16_t x1, u_int16_t y1, u_int16_t x2, u_int16_t y2)
{
    u_int8_t buf[4];
    
    /* 列地址：X */
    st7789_write_command(CMD_CASET);
    buf[0] = (x1 >> 8) & 0xFF; buf[1] = x1 & 0xFF;
    buf[2] = (x2 >> 8) & 0xFF; buf[3] = x2 & 0xFF;
    st7789_write_data(buf, 4);
    
    /* 行地址：Y */
    st7789_write_command(CMD_RASET);
    buf[0] = (y1 >> 8) & 0xFF; buf[1] = y1 & 0xFF;
    buf[2] = (y2 >> 8) & 0xFF; buf[3] = y2 & 0xFF;
    st7789_write_data(buf, 4);
}

/**
 * st7789_fill_rect() - 填充矩形区域（RGB565颜色）
 */
static void st7789_fill_rect(u_int16_t x, u_int16_t y, u_int16_t w, u_int16_t h,
                              u_int16_t color)
{
    size_t pixel_count = w * h;
    size_t buf_size = pixel_count * 2;  /* RGB565 = 2 bytes */
    u_int8_t *buf = malloc(buf_size);
    if (!buf) return;
    
    /* 填充颜色 */
    for (size_t i = 0; i < pixel_count; i++) {
        buf[i * 2] = (color >> 8) & 0xFF;      /* 高字节 */
        buf[i * 2 + 1] = color & 0xFF;         /* 低字节 */
    }
    
    /* 设置绘图窗口 */
    st7789_set_address(x, y, x + w - 1, y + h - 1);
    
    /* 突发写入显存 */
    st7789_write_command(CMD_RAMWR);
    st7789_write_data(buf, buf_size);
    
    free(buf);
}

int main(int argc, char *argv[])
{
    /* 打开SPI设备 */
    spi_fd = open(SPI_DEVICE, O_RDWR);
    if (spi_fd < 0) {
        perror("打开spidev失败");
        return 1;
    }
    
    /* 配置SPI参数 */
    u_int8_t mode = SPI_MODE_0;  /* CPOL=0, CPHA=0 */
    u_int8_t bits = 8;
    u_int32_t speed = 32000000;
    ioctl(spi_fd, SPI_IOC_WR_MODE, &mode);
    ioctl(spi_fd, SPI_IOC_WR_BITS_PER_WORD, &bits);
    ioctl(spi_fd, SPI_IOC_WR_MAX_SPEED_HZ, &speed);
    
    /* 打开GPIO控制 */
    gpio_dc_fd = open(GPIO_DC, O_WRONLY);
    gpio_rst_fd = open(GPIO_RST, O_WRONLY);
    
    /* 初始化LCD */
    st7789_init();
    
    /* 清屏为黑色 */
    st7789_fill_rect(0, 0, ST7789_WIDTH, ST7789_HEIGHT, 0x0000);
    
    /* 画一个红色矩形 */
    st7789_fill_rect(50, 50, 100, 80, 0xF800);  /* RGB565红色 */
    
    /* 画一个绿色矩形 */
    st7789_fill_rect(100, 100, 80, 60, 0x07E0);  /* RGB565绿色 */
    
    /* 画一个蓝色矩形 */
    st7789_fill_rect(150, 150, 60, 40, 0x001F);  /* RGB565蓝色 */
    
    printf("绘制完成\n");
    
    close(gpio_dc_fd);
    close(gpio_rst_fd);
    close(spi_fd);
    return 0;
}
```

<br>

### 编译与验证

**编译用户空间程序：**

```bash
# 交叉编译ST7789 spidev程序
arm-linux-gnueabihf-gcc -o st7789_spidev st7789_spidev.c

# 板端：导出GPIO（如未在设备树中配置）
echo 48 > /sys/class/gpio/export   # DC
echo 49 > /sys/class/gpio/export   # RST
echo out > /sys/class/gpio/gpio48/direction
echo out > /sys/class/gpio/gpio49/direction

# 运行
./st7789_spidev
```

<br>

### Flash验证命令

```bash
# 查看系统识别的SPI Flash
root@beaglebone:~# dmesg | grep spi
[    3.456789] spi-nor spi0.0: w25q128 (16384 Kbytes)
[    3.467123] 3 mtd partitions on "spi0.0"
[    3.471456] Creating 3 MTD partitions on "spi0.0":
[    3.476789] 0x000000000000-0x000000080000 : "uboot"
[    3.482345] 0x000000080000-0x000000780000 : "kernel"
[    3.487901] 0x000000780000-0x000001000000 : "rootfs"

# 查看MTD设备
root@beaglebone:~# cat /proc/mtd
dev:    size   erasesize  name
mtd0: 00080000 00001000 "uboot"
mtd1: 00700000 00001000 "kernel"
mtd2: 00880000 00001000 "rootfs"

# 读取JEDEC ID（通过mtd_debug或手动spi读写）
root@beaglebone:~# mtd_debug read /dev/mtd0 0x0 256 /tmp/uboot_header.bin
Copied 256 bytes from address 0x00000000 in flash to /tmp/uboot_header.bin

# 使用flashcp烧录固件
root@beaglebone:~# flashcp -v u-boot.img /dev/mtd0
Erasing blocks: 32/32 (100%)
Writing data: 512k/512k (100%)
Verifying data: 512k/512k (100%)

# 使用flash_erase擦除整个分区
root@beaglebone:~# flash_erase /dev/mtd1 0 0   # 0 0 = 从偏移0开始，擦除所有块
Erasing 4096 Kibyte @ 700000 -- 100 % complete

# 直接读取Flash原始内容
root@beaglebone:~# hexdump -C /dev/mtd0 | head -5
00000000  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
```

<br>

---

## <span class="blue"> 调试技巧

### SPI调试命令速查

| 命令 | 用途 | 示例输出 |
|------|------|----------|
| `dmesg \| grep -i spi` | 查看SPI控制器和设备的注册日志 | `spi-nor spi0.0: w25q128 (16384 Kbytes)` |
| `ls /sys/bus/spi/devices/` | 列出所有SPI设备 | `spi0.0 spi0.1` |
| `cat /sys/kernel/debug/spi/*` | SPI控制器调试信息 | 传输统计、队列状态 |
| `cat /proc/mtd` | 查看MTD分区表 | `mtd0: 00080000 00001000 "uboot"` |
| `flashcp -v file /dev/mtdN` | 烧录固件到Flash | 擦除/写入/校验进度 |
| `flash_erase /dev/mtdN offset count` | 擦除Flash分区 | `Erasing 4096 Kibyte @ 700000` |
| `hexdump -C /dev/mtdN` | 读取Flash原始数据 | 十六进制+ASCII显示 |
| `spidev_test -v -D /dev/spidev0.0` | spidev回环测试（需短接MOSI-MISO） | 收发数据比对 |
| `logic_analyzer_spi` | 逻辑分析仪抓取SPI波形 | 验证CPOL/CPHA/时钟频率 |

<br>

### 常见问题排查

```
问题：SPI设备probe失败，dmesg无相关日志
排查：
  1. 检查设备树status = "okay"
  2. 确认compatible字符串与驱动of_match_table匹配
  3. 检查pinctrl是否正确配置（SCLK/MOSI/MISO引脚）
  4. 确认SPI控制器驱动已加载（ls /sys/bus/spi/devices/应非空）

问题：数据读写全为0xFF或全为0x00
排查：
  1. 示波器检查物理连接——SCLK有否时钟波形
  2. 检查CS信号是否在传输期间保持低电平
  3. 确认CPOL/CPHA模式与从设备要求一致
  4. 检查spi-max-frequency是否超过从设备上限

问题：Flash编程后数据不正确
排查：
  1. ⚠️ 确认已先擦除再编程！这是#1原因
  2. 检查地址是否跨越页边界（256字节/页）
  3. 确认Write Enable命令已发送
  4. 等待WIP位清零后再发下一条命令

问题：LCD显示花屏/无显示
排查：
  1. 示波器抓CS信号——确保命令和数据在同一CS周期内
  2. 检查DC（数据/命令）GPIO控制时序
  3. 确认初始化命令序列完整执行
  4. 验证RGB565颜色格式与COLMOD设置一致
```

<br>

---

## <span class="blue"> 本节总结

| 主题 | 核心要点 |
|------|----------|
| **SPI子系统架构** | 5个核心结构体：`spi_master`（控制器）、`spi_device`（从设备）、`spi_driver`（驱动）、`spi_transfer`（单次传输）、`spi_message`（完整消息） |
| **设备树配置** | 控制器节点+子设备节点，`compatible`、`reg`（片选）、`spi-max-frequency`、`spi-cpol`/`spi-cpha`为关键属性 |
| **传输API** | `spi_sync()`阻塞同步、`spi_async()`非异步+回调、`spi_write_then_read()`便捷命令+数据交互 |
| **spidev** | `/dev/spidevB.C`字符设备，`SPI_IOC_MESSAGE`为核心ioctl，适合原型验证 |
| **Flash操作** | 三步走：Write Enable → Erase → Page Program；必须轮询WIP位；**必须先擦除再编程** |
| **LCD驱动** | 初始化命令序列+DC GPIO控制+显存窗口设置+RGB565像素写入 |
| **DMA优化** | 物理连续缓冲区、PIO/DMA传输阈值判断、批量消息合并 |
| **调试工具** | `dmesg\|grep spi`、`flashcp`、`flash_erase`、示波器抓波形 |

<br>

**关键对比——同步 vs 异步：**

| 维度 | `spi_sync()` | `spi_async()` |
|------|-------------|---------------|
| 调用方式 | 阻塞，等待完成 | 非阻塞，提交即返回 |
| 适用场景 | 配置寄存器、小数据量 | 大批量连续传输 |
| 上下文限制 | 可睡眠的进程上下文 | 不能睡眠（ISR安全） |
| 完成通知 | 函数返回即完成 | `msg->complete`回调 |
| 复杂度 | 简单，不易出错 | 需注意并发和内存生命周期 |

<br>

---

## <span class="blue"> 下一步

下一节 **B-A.3.4 SPI调试与选型**，我们将深入：

- SPI时序问题定位（示波器+逻辑分析仪实战）
- 多从设备共享总线的CS切换策略与信号完整性
- SPI速率计算与上拉电阻选型
- 与I2C的选型对比矩阵（速率/距离/复杂度/成本）

<br>

---

## <span class="blue"> 配套资源

- **内核文档**：`Documentation/spi/spi-summary.rst`、`Documentation/devicetree/bindings/spi/`
- **工具源码**：`tools/spi/spidev_test.c`（内核源码树）
- **W25Q128JV datasheet**：Winbond官方文档（重点看Command Table和AC特性）
- **ST7789 datasheet**：Sitronix官方文档（重点看Initial Code和命令时序）
- **MTD工具**：`mtd-utils`包（`flashcp`、`flash_erase`、`nanddump`、`ubiformat`）
- **推荐硬件**：Saleae Logic（逻辑分析仪，支持SPI协议解码）
