# APB 实战与桥接设计 [B→I]

> **本章学习目标**：
> - 完成一次 <span class="red">APB Slave RTL 设计</span>
> - 掌握 <span class="red">APB-to-AXI Bridge</span> 的逆向桥接
> - 了解 APB 在 <span class="red">RISC-V SoC</span> 中的应用

---

<span class="blue">从何而来 → 为什么需要 → 哪里用：</span><br>
<span class="red">APB 实战技能</span>是嵌入式工程师接触最多的总线工作。<br>
从 <span class="green">1996 年</span> APB 诞生至今，几乎每个 SoC 都有 APB 外设。<br>
早期设计 APB Slave 只需实现 PSELx + PENABLE 握手，<span class="blue">如今 APB-to-AXI 逆向桥接让 APB Master 也能访问 AXI 高速设备，扩展了 APB 的应用场景。</span><br>
如今，APB Slave 设计是 <span class="green">FPGA 开发</span>、<span class="green">芯片验证</span>、<span class="green">RISC-V SoC</span> 的入门必修课。<br>

---

## 实战一：APB UART Slave 设计

---

### <strong>设计目标：带 FIFO 的可配置 UART</strong>

<span class="red">本实战</span>设计一个带寄存器映射的 APB UART Slave：<br>
* 波特率可配置<br>
* 状态寄存器写 1 清零<br>
* 支持中断<br>

<span class="blue">类比理解：APB Slave 如同"自动售货机"</span><br>
Master（顾客）投币（PSELx=1）并按键（PADDR），<br>
Slave（售货机）根据按键返回商品（PRDATA）或接收商品（PWDATA）。<br>
PENABLE 是"确认键"，PREADY 是"出货完成"指示灯。<br>

```verilog
module apb_uart (
  input         PCLK, PRESETn,
  input  [31:0] PADDR,
  input         PSELx,
  input         PENABLE,
  input         PWRITE,
  input  [31:0] PWDATA,
  output reg [31:0] PRDATA,
  output reg    PREADY,
  output        txd,
  input         rxd,
  output        irq
);

  reg [15:0] baud_div;
  reg [7:0]  tx_data;
  reg [7:0]  rx_data;
  reg [3:0]  status;
  reg [3:0]  ctrl;
  wire [3:0] reg_addr = PADDR[3:0];

  always @(posedge PCLK) begin
    if (!PRESETn) begin
      baud_div <= 16'd104;
      ctrl     <= 4'b0;
    end else if (PSELx && PENABLE && PWRITE) begin
      case (reg_addr)
        4'h0: baud_div <= PWDATA[15:0];
        4'h4: tx_data  <= PWDATA[7:0];
        4'hC: status   <= status & ~PWDATA[3:0];
        4'h1: ctrl     <= PWDATA[3:0];
      endcase
    end
  end

  always @(*) begin
    case (reg_addr)
      4'h0: PRDATA = {16'b0, baud_div};
      4'h4: PRDATA = {24'b0, tx_data};
      4'h8: PRDATA = {24'b0, rx_data};
      4'hC: PRDATA = {28'b0, status};
      4'h1: PRDATA = {28'b0, ctrl};
      default: PRDATA = 32'b0;
    endcase
  end

  always @(posedge PCLK) begin
    if (!PRESETn) PREADY <= 1'b0;
    else PREADY <= PSELx && PENABLE;
  end

  assign irq = (status[1] && ctrl[1]) || (status[2] && ctrl[2]);
endmodule
```

关键设计要点如下：<br>

| 要点 | 实现 | 原因 |
| --- | --- | --- |
| 波特率 | 软件配置 baud_div | 灵活适配不同晶振 |
| 状态寄存器 | 写 1 清零 | 避免读-改-写竞争 |
| 中断 | TXE/RXNE 使能 | 支持中断驱动收发 |
| PREADY | 固定 1 周期 | 寄存器访问无需等待 |

---

## 实战二：APB-to-AXI Bridge

---

### <strong>逆向桥接：APB Master 访问 AXI Slave</strong>

<span class="red">APB-to-AXI Bridge</span>将 APB 的单周期事务映射为 AXI 的多通道事务。<br>

```verilog
module apb_axi_bridge (
  input         ACLK, ARESETn,
  input  [31:0] PADDR,
  input         PSELx, PENABLE, PWRITE,
  input  [31:0] PWDATA,
  output [31:0] PRDATA,
  output        PREADY,
  output [31:0] AWADDR, output AWVALID, input AWREADY,
  output [31:0] WDATA,  output WVALID,  input WREADY,
  input         BVALID, output BREADY,
  output [31:0] ARADDR, output ARVALID, input ARREADY,
  input  [31:0] RDATA,  input RVALID,   output RREADY
);
  localparam IDLE = 3'b000, ADDR = 3'b001, DATA = 3'b010, RESP = 3'b011;
  reg [2:0] state;

  always @(posedge ACLK) begin
    if (!ARESETn) state <= IDLE;
    else case (state)
      IDLE:  if (PSELx) state <= ADDR;
      ADDR:  if (AWREADY || ARREADY) state <= DATA;
      DATA:  if (WREADY || RVALID) state <= RESP;
      RESP:  if (BVALID || RVALID) state <= IDLE;
    endcase
  end

  assign AWADDR  = PADDR;
  assign AWVALID = (state == ADDR) && PWRITE;
  assign WDATA   = PWDATA;
  assign WVALID  = (state == DATA) && PWRITE;
  assign BREADY  = (state == RESP) && PWRITE;
  assign ARADDR  = PADDR;
  assign ARVALID = (state == ADDR) && !PWRITE;
  assign RREADY  = (state == DATA) && !PWRITE;
  assign PRDATA  = RDATA;
  assign PREADY  = (state == RESP) && (BVALID || RVALID);
endmodule
```

<span class="blue">状态机将 APB 的 Setup/Access 映射为 AXI 的 ADDR/DATA/RESP 三阶段。</span><br>

---

## APB 在 RISC-V SoC 中的应用

---

### <strong>SiFive E31 的 APB 外设映射</strong>

<span class="red">RISC-V SoC</span> 广泛使用 APB 挂接寄存器外设。<br>
以 <span class="green">SiFive E31</span> 为例：<br>

| APB Slave | 基地址 | 功能 |
| --- | --- | --- |
| UART0 | 0x1001_3000 | 调试串口 |
| SPI0 | 0x1001_4000 | QSPI Flash |
| GPIO | 0x1001_2000 | 通用 IO |
| PWM | 0x1001_5000 | 脉宽调制 |

<span class="blue">RISC-V 的 TileLink 总线通过 TileLink-to-APB Bridge 连接低速外设。</span><br>

---

## 本章小结

| 概念 | 一句话总结 |
| --- | --- |
| APB UART | 波特率/数据/状态/控制寄存器，写 1 清零 |
| APB-to-AXI | 状态机映射 APB 单周期到 AXI 多通道 |
| RISC-V APB | SiFive 用 APB 挂寄存器外设 |

---

## 练习

1. 修改 UART Slave 使其支持 16-byte FIFO。<br>
2. APB-to-AXI Bridge 中，AXI Slave 延迟 10 周期，APB Master 会看到什么？<br>
3. RISC-V SoC 中 GPIO 为什么用 APB 而不是 AXI？
