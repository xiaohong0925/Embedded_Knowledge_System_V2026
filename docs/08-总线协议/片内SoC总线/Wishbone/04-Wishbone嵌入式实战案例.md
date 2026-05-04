# Wishbone嵌入式实战案例

<span class="badge-i">[Intermediate]</span>

<span class="red">Wishbone</span> 在开源FPGA生态中广泛使用，本节展示实战技巧。

---

## <strong>场景：OpenCores IP集成</strong>

### <strong>Wishbone仲裁器Verilog</strong>

```verilog
module wb_arbiter (
    input clk,
    input [1:0] wb_cyc_i,  // 2个主设备
    output reg [1:0] grant
);
    always @(posedge clk)
        grant <= wb_cyc_i[0] ? 2'b01 : 
                 wb_cyc_i[1] ? 2'b10 : 2'b00;
endmodule
```

### <strong>开源FPGA实战</strong>

<span class="blue">Wishbone 在 iCE40、ECP5 等低成本FPGA上广泛使用</span>，搭配 RISC-V 软核（如 PicoRV32）。

---

## <strong>小结与练习</strong>

**练习**

1. 设计一个4主4从的Wishbone交叉开关。
2. 比较Wishbone和AXI-Lite在FPGA资源占用上的差异。
3. 分析为什么开源硬件社区偏好Wishbone而非AMBA。
