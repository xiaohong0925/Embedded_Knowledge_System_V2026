# AXI 嵌入式专属实战 [E]

> **本章学习目标**：
> - 完成一次 <span class="red">AXI Master RTL 设计</span> 的完整流程
> - 掌握 <span class="red">Linux 内核中 AXI 设备树配置</span> 与驱动对接
> - 学会用 <span class="red">逻辑分析仪 + Python</span> 抓取并解析 AXI 波形

---

<span class="blue">从何而来 → 为什么需要 → 哪里用：</span><br>
<span class="red">AXI 实战技能</span>是嵌入式工程师从"看懂文档"到"能出产品"的关键跨越。<br>
早期 FPGA 开发中，工程师需手写复杂的 AXI 状态机，容易出错。<br>
<span class="green">Xilinx</span> 推出 <span class="green">AXI DMA IP</span>、<span class="green">AXI Interconnect IP</span> 后，开发效率大幅提升。<br>
<span class="blue">如今，自定义 AXI Master 设计、设备树配置、波形调试已成为 SoC 工程师的必备技能，广泛应用于 Zynq、R-Car、Rockchip 等平台。</span><br>

---

## 实战一：自定义 AXI Master RTL 设计

---

### <strong>设计目标：DMA 引擎的 AXI 接口</strong>

<span class="red">自定义 DMA 引擎</span>是最常见的 AXI Master 设计场景。<br>
本实战设计一个 <span class="blue">"内存到内存拷贝 DMA"</span>，<br>
支持 INCR 突发传输。<br>

<span class="blue">类比理解：DMA 引擎如同"自动驾驶卡车"</span><br>
CPU 是"人类司机"（智能但慢），负责规划路线和下达指令。<br>
DMA 是"自动驾驶卡车"（无脑但快），按照预设路线连续搬运货物。<br>
CPU 只需告诉 DMA "从 A 搬到 B，搬多少"，然后 DMA 自动完成所有搬运。<br>

<span class="orange"><strong>1. 状态机设计</strong></span><br>

```verilog
module axi_dma_master (
  input         ACLK, ARESETn,
  // AXI 写地址通道
  output [31:0] AWADDR,
  output [7:0]  AWLEN,
  output [2:0]  AWSIZE,
  output [1:0]  AWBURST,
  output        AWVALID,
  input         AWREADY,
  // AXI 写数据通道
  output [63:0] WDATA,
  output [7:0]  WSTRB,
  output        WLAST,
  output        WVALID,
  input         WREADY,
  // AXI 写响应通道
  input         BVALID,
  output        BREADY,
  // 控制接口
  input         dma_start,
  input  [31:0] src_addr, dst_addr,
  input  [15:0] xfer_len
);

  localparam IDLE = 3'b000;
  localparam AW   = 3'b001;
  localparam W    = 3'b010;
  localparam B    = 3'b011;
  localparam DONE = 3'b100;

  reg [2:0] state;
  reg [7:0] beat_cnt;
  reg [15:0] total_cnt;

  always @(posedge ACLK) begin
    if (!ARESETn) state <= IDLE;
    else case (state)
      IDLE: if (dma_start) state <= AW;
      AW:   if (AWVALID && AWREADY) state <= W;
      W:    if (WVALID && WREADY && WLAST) begin
              if (total_cnt >= xfer_len) state <= B;
              else state <= AW;
            end
      B:    if (BVALID && BREADY) state <= DONE;
      DONE: state <= IDLE;
    endcase
  end

  // AW 通道赋值
  assign AWADDR  = dst_addr + total_cnt;
  assign AWLEN   = (xfer_len - total_cnt >= 16) ? 15 : (xfer_len - total_cnt - 1);
  assign AWSIZE  = 3'b011;     // 8 bytes per beat
  assign AWBURST = 2'b01;      // INCR
  assign AWVALID = (state == AW);

  // W 通道赋值
  assign WDATA   = fifo_rdata;  // 从 FIFO 读取源数据
  assign WSTRB   = 8'hFF;       // 全字节有效
  assign WLAST   = (beat_cnt == AWLEN);
  assign WVALID  = (state == W) && !fifo_empty;

  // B 通道
  assign BREADY  = (state == B);
endmodule
```

<span class="blue">状态机核心：AW → W（burst）→ B → 判断剩余长度 → 循环或结束。</span><br>

---

### <strong>2. AXI 握手合规性检查清单</strong>

下表列出了 DMA Master 设计必须遵守的 AXI 规范：<br>

| 检查项 | 规则 | 本设计是否合规 |
| --- | --- | --- |
| VALID 保持 | VALID 拉高后必须保持到 READY 也高 | 是：AWVALID/WVALID 由状态机控制 |
| 地址对齐 | AWADDR 必须对齐到 AWSIZE | 是：8-byte 对齐，地址增量为 16×8=128 |
| WLAST 时序 | WLAST 必须在最后一个 WDATA 时拉高 | 是：beat_cnt == AWLEN 时拉高 |
| B 通道等待 | 必须收到 BVALID 后才能发新 AW | 是：状态机强制在 B 状态等待 |

---

## 实战二：Linux 设备树与 AXI 外设驱动对接

---

### <strong>Zynq-7000 的 AXI DMA 设备树配置</strong>

```dts
// arch/arm/boot/dts/zynq-7000.dtsi
axi_dma_0: dma@40400000 {
    compatible = "xlnx,axi-dma-1.00.a";
    reg = <0x40400000 0x10000>;        // AXI-Lite 寄存器空间
    interrupts = <0 29 4>;              // IRQ 29，高电平触发
    interrupt-parent = <&intc>;
    dmas = <&axi_dma_0>;
    dma-names = "axi-dma";

    // AXI 数据通道属性
    xlnx,include-sg;                     // 支持 Scatter-Gather
    xlnx,addrwidth = <32>;               // 32-bit 地址空间
    xlnx,datawidth = <64>;               // 64-bit 数据宽度
};
```

<span class="blue">设备树描述 AXI 外设的寄存器基地址、中断号和 DMA 属性，驱动通过 platform_get_resource() 解析。</span><br>

---

### <strong>驱动中的 AXI 寄存器操作</strong>

```c
// drivers/dma/xilinx_dma.c（简化片段）
static int xilinx_dma_start(struct xilinx_dma_chan *chan)
{
    void __iomem *regs = chan->ctrl_reg;

    // 写 AXI-Lite 寄存器：配置源地址
    iowrite32(chan->src_addr, regs + XILINX_DMA_REG_SRCADDR);

    // 写目标地址
    iowrite32(chan->dst_addr, regs + XILINX_DMA_REG_DSTADDR);

    // 写传输长度（单位：beat）
    iowrite32(chan->len / 8, regs + XILINX_DMA_REG_BTT);

    // 启动 DMA
    iowrite32(XILINX_DMA_CR_RUNSTOP, regs + XILINX_DMA_REG_CR);

    return 0;
}
```

<span class="blue">驱动通过 AXI-Lite 接口配置 DMA 寄存器，DMA 引擎通过 AXI4 高速通道搬运数据。</span><br>

---

## 实战三：逻辑分析仪抓取 AXI 波形

---

### <strong>Saleae Logic 抓取与 Python 解析</strong>

```python
# parse_axi_saleae.py
import saleae

# 连接 Logic 设备
device = saleae.Saleae()
device.capture_start()

# 等待触发（AWVALID && AWREADY）
device.set_trigger(
    digital=[
        ('AWVALID', 'R'),  # 上升沿触发
        ('AWREADY', 'H'),  # 高电平
    ]
)

# 抓取 1 秒波形
device.capture_wait()
device.export_data('axi_trace.csv')

# 解析 CSV
def parse_axi_csv(filename):
    import csv
    with open(filename) as f:
        reader = csv.DictReader(f)
        transactions = []
        for row in reader:
            if row['AWVALID'] == '1' and row['AWREADY'] == '1':
                txn = {
                    'addr': row['AWADDR'],
                    'len': int(row['AWLEN']),
                    'burst': 'INCR' if row['AWBURST'] == '01' else 'OTHER'
                }
                transactions.append(txn)
        return transactions

# 输出结果
for txn in parse_axi_csv('axi_trace.csv'):
    print(f"AW: addr={txn['addr']}, len={txn['len']}, burst={txn['burst']}")
```

<span class="blue">抓取 16 通道数字信号（AW/W/AR/R/B），用 Python 解析地址、突发长度和握手时序。</span><br>

---

## 本章小结

| 概念 | 一句话总结 |
| --- | --- |
| DMA 状态机 | AW → W(burst) → B → 循环或结束 |
| 握手合规 | VALID 保持、地址对齐、WLAST 在最后 beat |
| 设备树配置 | reg + interrupts + dma-names 描述 AXI 外设 |
| AXI-Lite 驱动 | 通过寄存器配置 DMA，AXI4 搬运数据 |
| 逻辑分析仪 | 16 通道抓取，Python 解析事务 |

---

## 练习

1. 修改 DMA 状态机使其支持 WRAP 突发（用于环形缓冲）。<br>
2. 在 Zynq 设备树中添加一个自定义 AXI GPIO 外设（32-bit，AXI-Lite）。<br>
3. 用 Saleae 抓取一次 DDR 突发读，计算实际带宽并与理论值对比。
