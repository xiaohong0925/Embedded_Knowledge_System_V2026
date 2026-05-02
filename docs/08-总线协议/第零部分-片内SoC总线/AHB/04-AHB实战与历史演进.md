# AHB 实战与历史演进 [B→I]

> **本章学习目标**：
> - 完成一次 <span class="red">AHB-Lite Slave RTL 设计</span>
> - 掌握 <span class="red">AHB 在 Cortex-M 系列</span> 中的典型配置
> - 了解 AHB 从 AMBA 2 到 AMBA 5 的演进

---

<span class="blue">从何而来 → 为什么需要 → 哪里用：</span><br>
<span class="red">AHB 实战技能</span>是嵌入式工程师日常工作的核心。<br>
从 <span class="green">1999 年</span> AHB 诞生至今，Cortex-M 系列处理器一直是嵌入式主流。<br>
<span class="blue">AHB-Lite 作为 Cortex-M 的标准总线，掌握其 Slave 设计、RCC 时钟配置和版本演进，是 STM32、NXP LPC 等 ARM 芯片开发的必备基础。</span><br>
如今，AHB 也出现在 <span class="green">RISC-V</span> SoC 中（如 SiFive E31 的 TileLink-to-AHB Bridge）。<br>

---

## 实战一：AHB-Lite Slave 寄存器模块设计

---

### <strong>设计目标：可配置 GPIO 控制器</strong>

<span class="red">本实战</span>设计一个 <span class="blue">"8 个 32-bit 寄存器"</span>的 AHB-Lite Slave：<br>
* 基地址：<span class="green">0x4000_0000</span><br>
* 寄存器：DIR（方向）、OUT（输出）、IN（输入）、MASK（中断屏蔽）<br>
* 支持 HREADY 反压<br>

<span class="blue">类比理解：AHB Slave 如同"便利店收银台"</span><br>
Master（顾客）来买东西（读写寄存器），<br>
Slave（收银员）根据地址（商品编号）找到对应寄存器（商品），<br>
HREADY 是"请稍等"手势（如果收银机卡了）。<br>

```verilog
module ahb_gpio_slave (
  input         HCLK, HRESETn,
  input  [31:0] HADDR,
  input  [1:0]  HTRANS,
  input         HWRITE,
  input  [2:0]  HSIZE,
  input  [31:0] HWDATA,
  output reg [31:0] HRDATA,
  input         HREADY,
  output reg    HREADYOUT,
  output        HRESP
);

  reg [31:0] reg_dir;
  reg [31:0] reg_out;
  reg [31:0] reg_mask;
  wire [3:0] reg_addr = HADDR[5:2];

  always @(posedge HCLK) begin
    if (!HRESETn) begin
      reg_dir  <= 32'h0000_0000;
      reg_out  <= 32'h0000_0000;
      reg_mask <= 32'h0000_0000;
    end else if (HTRANS != 2'b00 && HREADY) begin
      if (HWRITE) begin
        case (reg_addr)
          4'h0: reg_dir  <= HWDATA;
          4'h1: reg_out  <= HWDATA;
          4'h3: reg_mask <= HWDATA;
        endcase
      end
    end
  end

  always @(*) begin
    case (reg_addr)
      4'h0: HRDATA = reg_dir;
      4'h1: HRDATA = reg_out;
      4'h2: HRDATA = gpio_in_pins;
      4'h3: HRDATA = reg_mask;
      default: HRDATA = 32'h0;
    endcase
  end

  reg [1:0] wait_cnt;
  always @(posedge HCLK) begin
    if (!HRESETn) begin
      wait_cnt <= 2'b0;
      HREADYOUT <= 1'b1;
    end else if (HTRANS != 2'b00) begin
      if (wait_cnt < 2'b10) begin
        wait_cnt <= wait_cnt + 1;
        HREADYOUT <= 1'b0;
      end else begin
        wait_cnt <= 2'b0;
        HREADYOUT <= 1'b1;
      end
    end
  end

  assign HRESP = 1'b0;
endmodule
```

关键设计要点如下：<br>

| 要点 | 实现 | 原因 |
| --- | --- | --- |
| 地址对齐 | HADDR[5:2] 解码 | 32-bit 寄存器，4-byte 对齐 |
| 写使能 | HTRANS != IDLE && HREADY | 确保总线空闲时不误写 |
| 反压 | wait_cnt 计数器 | 模拟慢速外设 |
| 只读寄存器 | reg_in 不参与写解码 | 防止误写输入引脚 |

---

## 实战二：Cortex-M 系统的 AHB 配置

---

### <strong>STM32F4 的 AHB 矩阵配置</strong>

<span class="red">STM32F4</span> 的 AHB 矩阵是典型的 Cortex-M 配置：<br>

| 总线 | 时钟频率 | 连接外设 |
| --- | --- | --- |
| AHB1 | 168 MHz | GPIOA-K, DMA1/2, Ethernet, USB OTG HS |
| AHB2 | 168 MHz | DCMI, Cryp, Hash, RNG |
| AHB3 | 168 MHz | FMC, Quad SPI |
| APB1 | 42 MHz | UART2-5, I2C1-3, SPI2-3, TIM2-7 |
| APB2 | 84 MHz | UART1/6, SPI1, TIM1/8, ADC1-3 |

```c
// STM32F4 RCC 时钟使能示例
RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
RCC->AHB1ENR |= RCC_AHB1ENR_DMA2EN;
RCC->AHB2ENR |= RCC_AHB2ENR_RNGEN;
```

<span class="blue">RCC 时钟门控是访问 AHB 外设的前提，必须先使能时钟再访问寄存器。</span><br>

---

## 历史演进：AHB 的 20 年

---

### <strong>从 AMBA 2 到 AMBA 5 的 AHB 演进</strong>

<span class="red">AHB 总线</span>已演进 20 余年，每次升级都增加了新特性：<br>

| 规范 | 年份 | AHB 变化 |
| --- | --- | --- |
| AMBA 2 | 1999 | AHB 诞生，替代 ASB |
| AMBA 3 | 2003 | AHB-Lite 简化版 |
| AMBA 4 | 2010 | AHB4，新增 Exclusive Transfer |
| AMBA 5 | 2015 | AHB5，新增 TrustZone HNONSEC |

<span class="blue">AHB5 的 HNONSEC 信号支持 TrustZone 安全隔离，是汽车 ECU 和 IoT 安全芯片的关键特性。</span><br>

---

## 本章小结

| 概念 | 一句话总结 |
| --- | --- |
| AHB-Lite Slave | 地址解码 + 寄存器读写 + HREADYOUT 反压 |
| RCC 时钟 | AHB 外设必须开启时钟后才能访问 |
| AHB5 | 新增 TrustZone HNONSEC 信号，支持安全隔离 |

---

## 练习

1. 修改 GPIO Slave 使其支持字节写。<br>
2. 在 STM32F4 上配置 AHB 时钟：APB1=42MHz、APB2=84MHz。<br>
3. 为什么 AHB5 的 HNONSEC 信号对汽车 ECU 安全至关重要？
