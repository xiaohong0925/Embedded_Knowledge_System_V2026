# TileLink 实战与 RISC-V 生态 **[E]**

> <span class="badge-e">E</span>

### <strong>实战 1：Rocket Chip 生成器的 TileLink 总线结构分析</strong>

<span class="badge-e">E</span>

**场景**：用 Chipyard 配置一个双核 RISC-V SoC，分析 TileLink 总线拓扑。

**生成步骤**：
```bash
cd chipyard/sims/verilator
make CONFIG=DualRocketConfig
```

**结构分析**：
- 两个 Rocket 核 → TL-C → L2 cache（Inclusive，目录式一致性）
- L2 → TL-UH → DRAM 控制器
- L2 → TL-UL → UART/SPI/GPIO 外设

打开生成的 `*.top.v`，搜索 `TileLink` 模块名：
```bash
grep -n "tilelink\|TLXbar\|TLBuffer" generated-src/*.v | head -20
```

观察：TLXbar 是交叉开关，TLBuffer 是流水线缓冲，TLFIFOFixer 解决握手顺序问题。

### <strong>实战 2：TileLink 到 AXI4 桥接器设计与时序</strong>

<span class="badge-e">E</span>

**场景**：RISC-V SoC 需要接 DDR 控制器，但 DDR IP 只有 AXI4 接口。

桥接要点：
- TileLink Get → AXI4 AR + R 通道
- TileLink Put → AXI4 AW + W + B 通道
- TileLink Acquire（缓存一致性）→ 需要额外处理：写回脏数据 + 无效化缓存

Rocket Chip 自带 `TileLink2AXI4` 桥，可直接用：
```scala
val axiBridge = LazyModule(new TLToAXI4Adapter())
axiBridge.node := tlMasterNode
```

### <strong>实战 3：自定义加速器接 TileLink 接口设计 **[M]**</strong>

<span class="badge-m">M</span>

**场景**：自研 NPU 加速器需要接入 SiFive 的 TileLink 总线。

**TL-UL 从机设计**：
```verilog
module tl_ul_slave (
    input clk, reset,
    // TileLink A channel (Master -> Slave)
    input a_valid,
    output reg a_ready,
    input [2:0] a_opcode,   // PutFullData/Get
    input [31:0] a_address,
    input [63:0] a_data,
    input [7:0] a_mask,
    // TileLink D channel (Slave -> Master)
    output reg d_valid,
    input d_ready,
    output reg [2:0] d_opcode,  // AccessAck/Data
    output reg [63:0] d_data
);
    reg [63:0] ctrl_reg, status_reg;
    
    always @(posedge clk) begin
        if (a_valid && a_ready) begin
            case (a_opcode)
                3'd0: begin // Get (read)
                    d_data <= (a_address[3]) ? status_reg : ctrl_reg;
                    d_opcode <= 3'd1; // AccessAckData
                end
                3'd3: begin // PutFullData (write)
                    if (a_address[3]) status_reg <= a_data;
                    else ctrl_reg <= a_data;
                    d_opcode <= 3'd0; // AccessAck
                end
            endcase
            d_valid <= 1'b1;
        end
        if (d_valid && d_ready) begin
            d_valid <= 1'b0;
            a_ready <= 1'b1;
        end
    end
endmodule
```

**验证**：用 Chipyard 的 TileLink DPI 仿真模型做事务级验证，检查：
1. 单次读写正确性
2. 连续突发传输
3. 错误地址返回 Denied

<span class="blue">TileLink 从机比 AXI 简单，因为握手只有 A/D 两个通道。</span>
