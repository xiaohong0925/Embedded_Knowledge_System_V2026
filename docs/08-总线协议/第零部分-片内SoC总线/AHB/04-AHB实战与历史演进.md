# AHB 实战与历史演进 **[E]**

> <span class="badge-e">E</span>

### <strong>实战 1：STM32 AHB 总线矩阵分析与 DMA 性能瓶颈</strong>

<span class="badge-e">E</span>

**场景**：STM32H7 上 DMA 从 SRAM 搬运数据到外设，实测带宽远低于理论值。

**STM32H7 总线矩阵拓扑**：
- Cortex-M7 内核：I-bus（取指）、D-bus（数据）、S-bus（系统外设）
- DMA1、DMA2、MDMA 共用 AHB 总线矩阵
- SRAM 分 Bank1（DTCM）和 Bank2（AXI SRAM）

**瓶颈分析**：
1. CPU 和 DMA 同时访问 SRAM Bank1 时，总线矩阵轮询仲裁，带宽减半
2. DMA 突发长度太短（默认单次），地址开销占比高

**优化方案**：
```c
// 配置 DMA 突发传输
DMA_InitStruct.Mode = DMA_NORMAL;
DMA_InitStruct.FIFOMode = DMA_FIFOMODE_ENABLE;  // FIFO 模式支持突发
DMA_InitStruct.MBurst = DMA_MBURST_INC16;       // 16 beat 突发
DMA_InitStruct.PBurst = DMA_PBURST_INC16;
// 把缓冲区放到 SRAM2（与 CPU 的 DTCM 分离）
// 链接脚本中：.dma_buffer : { *(.dma_buffer) } > SRAM2
```

**实测对比**：
| 配置 | 理论带宽 | 实测带宽 | 利用率 |
|------|----------|----------|--------|
| 单次传输 | 200MB/s | 45MB/s | 22% |
| 4 beat 突发 | 200MB/s | 120MB/s | 60% |
| 16 beat 突发 + SRAM2 | 200MB/s | 175MB/s | 87% |

### <strong>实战 2：AHB2APB 桥接器时序与寄存器访问延迟</strong>

<span class="badge-e">E</span>

**场景**：CPU 通过 AHB 访问 APB 外设寄存器，实测延迟 3-4 周期，分析来源。

**AHB2APB 桥时序拆解**：

| 周期 | AHB 侧 | APB 侧 |
|------|--------|--------|
| T1 | 地址阶段，桥采样 HADDR | - |
| T2 | 等待 | APB SETUP：PSEL 拉高 |
| T3 | 等待 | APB ENABLE：PENABLE 拉高，Slave 响应 |
| T4 | 数据阶段，HREADY 拉高 | PREADY 返回 |

**延迟来源**：APB 固定 2 周期（SETUP + ENABLE），桥接转换增加 1 周期，总共 3-4 周期。

**优化**：批量访问 APB 寄存器时，用 AHB burst 减少桥接开销。例如一次性读 4 个相邻寄存器，AHB INCR4 突发只需要 5 周期（1 地址 + 4 数据），而 4 次单次需要 4×4=16 周期。

### <strong>实战 3：AHB-Lite 从机 RTL 设计 **[M]**</strong>

<span class="badge-m">M</span>

**场景**：Cortex-M0 软核接自研外设，需要 AHB-Lite 从机接口。

**RTL 核心逻辑**：
```verilog
module ahb_lite_slave (
    input HCLK, HRESETn,
    input [31:0] HADDR,
    input [31:0] HWDATA,
    output reg [31:0] HRDATA,
    input HWRITE, HSEL, HREADY,
    output reg HREADYOUT,
    output reg [1:0] HRESP
);
    reg [31:0] reg_ctrl, reg_status, reg_data;
    reg [1:0] state;
    localparam IDLE=2'b00, READ=2'b01, WRITE=2'b10;

    always @(posedge HCLK or negedge HRESETn) begin
        if (!HRESETn) begin
            state <= IDLE;
            HREADYOUT <= 1'b1;
        end else begin
            case (state)
                IDLE: if (HSEL && HREADY) begin
                    if (HWRITE) state <= WRITE;
                    else state <= READ;
                    HREADYOUT <= 1'b0;  // 插入1周期等待
                end
                READ: begin
                    case (HADDR[3:2])
                        2'b00: HRDATA <= reg_ctrl;
                        2'b01: HRDATA <= reg_status;
                        2'b10: HRDATA <= reg_data;
                    endcase
                    HREADYOUT <= 1'b1;
                    state <= IDLE;
                end
                WRITE: begin
                    case (HADDR[3:2])
                        2'b00: reg_ctrl <= HWDATA;
                        2'b10: reg_data <= HWDATA;
                    endcase
                    HREADYOUT <= 1'b1;
                    state <= IDLE;
                end
            endcase
        end
    end
endmodule
```

**验证**：使用 ARM CMSDK 验证套件或手写 testbench：
1. 单次读 → 检查 HRDATA 是否正确
2. 单次写 → 检查寄存器是否更新
3. 连续读写 → 检查状态机是否卡死
4. 非法地址 → 检查 HRESP=ERROR

<span class="blue">AHB-Lite 简单到可以手写，复杂到可以跑系统。</span>