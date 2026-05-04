# APB嵌入式实战案例

<span class="badge-i">[Intermediate]</span>

<span class="red">APB总线是嵌入式SoC中挂载外设的首选</span>，本节通过两个实例展示实战技巧。

---

## <strong>场景一：GPIO控制器挂载APB</strong>

### <strong>寄存器映射设计</strong>

| 偏移 | 名称 | 访问 | 说明 |
|------|------|------|------|
| 0x00 | GPIO_DIR | R/W | 方向：0=输入，1=输出 |
| 0x04 | GPIO_OUT | R/W | 输出值 |
| 0x08 | GPIO_IN | RO | 输入值（经同步器） |
| 0x0C | GPIO_IE | R/W | 中断使能 |
| 0x10 | GPIO_IS | R/W | 中断敏感：0=电平，1=边沿 |
| 0x14 | GPIO_IC | WO | 中断清除 |

### <strong>Linux驱动片段</strong>

```c
static void __iomem *gpio_base;
#define GPIO_DIR (gpio_base + 0x00)
#define GPIO_OUT (gpio_base + 0x04)

static int apb_gpio_probe(struct platform_device *pdev) {
    gpio_base = devm_ioremap_resource(&pdev->dev, 
        platform_get_resource(pdev, IORESOURCE_MEM, 0));
    writel(0xFF, GPIO_DIR); // 全部设为输出
    writel(0x01, GPIO_OUT); // 点亮LED
    return 0;
}
```

---

## <strong>场景二：16550 UART APB接口</strong>

<span class="blue">APB总线频率通常低于AHB，适合UART等低速外设。</span>

### <strong>波特率配置</strong>

```c
// 配置 115200bps，APB时钟 24MHz
divisor = 24000000 / (16 * 115200);  // = 13
writel(divisor & 0xFF, base + 0x00);   // DLL
writel(divisor >> 8, base + 0x04);      // DLH
writel(0x03, base + 0x0C);              // LCR: 8N1
```

---

## <strong>小结与练习</strong>

**练习**

1. 为一个SoC设计完整的APB地址映射表（含GPIO/UART/Timer/I2C）。
2. 分析APB外设中断如何路由到ARM GIC。
3. 计算APB总线在100MHz时钟下挂载8个外设的理论带宽。
