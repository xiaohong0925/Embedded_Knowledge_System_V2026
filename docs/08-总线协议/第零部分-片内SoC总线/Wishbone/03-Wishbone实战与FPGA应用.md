# Wishbone 实战与 FPGA 应用 **[I→E]**

> <span class="badge-i">I</span> → <span class="badge-e">E</span>

### <strong>实战 1：Wishbone 简单外设（GPIO 控制器）RTL 设计</strong>

<span class="badge-i">I</span>

**场景**：FPGA 上实现 32 路 GPIO，通过 Wishbone 接口配置方向/数据。

**RTL 结构**：

```verilog
module wb_gpio (
    input CLK_I, RST_I,
    input [31:0] ADR_I,
    input [31:0] DAT_I,
    output reg [31:0] DAT_O,
    input WE_I, STB_I, CYC_I,
    output reg ACK_O,
    output reg [31:0] gpio_out,
    input [31:0] gpio_in,
    output reg [31:0] gpio_dir   // 1=output, 0=input
);
    always @(posedge CLK_I or negedge RST_I) begin
        if (!RST_I) begin
            ACK_O <= 1'b0;
            gpio_out <= 32'h0;
            gpio_dir <= 32'h0;
        end else begin
            ACK_O <= 1'b0;
            if (STB_I && CYC_I && !ACK_O) begin
                case (ADR_I[3:2])
                    2'b00: begin  // 方向寄存器
                        if (WE_I) gpio_dir <= DAT_I;
                        else DAT_O <= gpio_dir;
                    end
                    2'b01: begin  // 输出寄存器
                        if (WE_I) gpio_out <= DAT_I;
                        else DAT_O <= gpio_out;
                    end
                    2'b10: begin  // 输入寄存器（只读）
                        DAT_O <= gpio_in;
                    end
                endcase
                ACK_O <= 1'b1;  // 单周期响应
            end
        end
    end
endmodule
```

**验证**：用 Verilator 仿真，写 testbench 模拟 Master 发起读写。

### <strong>实战 2：多外设 Wishbone 地址映射与仲裁器设计</strong>

<span class="badge-e">E</span>

**场景**：FPGA SoC 有 UART、SPI、Timer、GPIO，共用一条 Wishbone 总线。

**地址分配**：
```
0x0000-0x0FFF → UART
0x1000-0x1FFF → SPI
0x2000-0x2FFF → Timer
0x3000-0x3FFF → GPIO
```

**仲裁器**：固定优先级（CPU > DMA）或轮询，生成对应 Slave 的 STB 信号。

**时序注意**：仲裁切换时插入 1 个空闲周期，避免地址冲突。

### <strong>实战 3：Wishbone to AXI4 桥接器（FPGA 原型迁移路径）**[M]**</strong>

<span class="badge-m">M</span>

**场景**：FPGA 原型验证通过，要迁移到 ASIC，ASIC IP 只支持 AXI4。

**桥设计要点**：
- Wishbone 单次传输 → AXI4 单次 burst（LEN=0）
- Wishbone 块传输 → AXI4 INCR burst（地址递增）
- 没有缓存一致性：Wishbone 不支持，桥接时直接透传，一致性由上层保证

**开源参考**：ZipCPU 的 `wbm2axisp` 桥，可直接综合到 FPGA 验证。

```verilog
// 简化的 Wishbone Master -> AXI4 Slave 桥
always @(posedge clk) begin
    if (wb_cyc && wb_stb && !wb_ack) begin
        // 发起 AXI 传输
        axi_awvalid <= wb_we;
        axi_arvalid <= !wb_we;
        axi_awaddr <= wb_adr;
        axi_araddr <= wb_adr;
        // 等待 AXI 响应
        if (axi_bvalid || axi_rvalid) begin
            wb_ack <= 1'b1;
            wb_dat_o <= axi_rdata;
        end
    end else begin
        wb_ack <= 1'b0;
    end
end
```

<span class="blue">Wishbone 到 AXI 的桥，是 FPGA 原型走向 ASIC 的必经之路。</span>
