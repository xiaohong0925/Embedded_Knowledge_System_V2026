# AXI 嵌入式专属实战 **[E]**

> <span class="badge-e">E</span>

### <strong>实战 1：DDR 控制器 AXI 接口配置与带宽测试</strong>

<span class="badge-e">E</span>

**场景**：验证 SoC DDR4 接口是否达到标称带宽。

**硬件配置**：Cortex-A53 通过 AXI4 连接 DDR 控制器，配置突发长度 16，SIZE=6（64B per beat）。

**测试方法**：
1. 配置 DMA 控制器发起连续突发读/写，传输 1MB 数据
2. 记录总周期数，计算实测带宽：
   ```
   实测带宽 = 总字节数 / (总周期数 × 时钟周期)
   ```
3. 标称 25.6GB/s（3200MT/s × 64bit），实测通常 60-70%

**瓶颈定位命令**（假设使用 ARM CoreLink DDR 控制器）：
```bash
# 读取性能计数器（通过 sysfs 或 debugfs）
cat /sys/class/devfreq/dmc/cur_freq        # 当前 DDR 频率
cat /sys/kernel/debug/ddr_ctrl/bank_stats  # bank 命中统计
cat /sys/kernel/debug/ddr_ctrl/perf_cnt   # 总线利用率
```

常见问题：
- bank hit rate < 80% → 地址映射需要优化（row-bank-column 顺序调整）
- refresh 占比 > 5% → 正常，但如果 > 10% 考虑改用 DDR4 on-the-fly refresh

### <strong>实战 2：多主争用总线矩阵的延迟分析</strong>

<span class="badge-e">E</span>

**场景**：CPU 和 GPU 同时访问 DDR，GPU 延迟导致掉帧。

**测量方法**：
1. 在 AXI 总线矩阵的 AR/AW 出口加逻辑分析仪触发点
2. 记录每个 Master 的 AR 发出到第一个 R data 返回的周期数（读延迟）
3. 记录 AW 发出到 B 响应返回的周期数（写延迟）

**典型数据**：
| 场景 | CPU 读延迟 | GPU 读延迟 |
|------|-----------|-----------|
| CPU 单独访问 | 50 cycles | - |
| GPU 单独访问 | - | 80 cycles |
| CPU+GPU 并发 | 120 cycles | 150 cycles |

**优化策略**：
- 调整 QoS：CPU 读 QoS=15，GPU QoS=12，DMA=8
- 分离读/写到不同 DDR rank（DDR 控制器支持多 rank）
- 增加 GPU 突发长度：从 4 beat 增加到 16 beat，减少仲裁切换次数

### <strong>实战 3：AXI 从机 RTL 设计与仿真验证 **[M]**</strong>

<span class="badge-m">M</span>

**场景**：自研加速器需要 AXI 接口接入 SoC。

**RTL 设计要点**：

1. **状态机**：
   ```verilog
   localparam IDLE=0, ADDR=1, DATA=2, RESP=3;
   reg [1:0] state;
   always @(posedge clk)
     case(state)
       IDLE: if (awvalid) state <= ADDR;
       ADDR: if (awready) state <= DATA;
       DATA: if (wvalid && wready && wlast) state <= RESP;
       RESP: if (bvalid && bready) state <= IDLE;
     endcase
   ```

2. **寄存器化输出**：AXI 接口所有输出（awready, rdata, bvalid 等）必须打一拍寄存器输出，不能是组合逻辑直接输出。这是时序收敛的基本要求。

3. **支持突发**：实现地址递增逻辑 `next_addr = addr + (1 << size)`，处理 WLAST/RLAST。

**仿真验证**：
- 使用 ARM AXI VIP（Verification IP）或开源 cocotb-axi 作为主设备
- 测试用例：单次传输 → 4 beat 突发 → 16 beat 突发 → 乱序 ID → 窄传输 → 错误响应

**综合约束**：
```tcl
set_multicycle_path -setup 2 -from [get_pins slave/awready_reg] -to [get_pins master/awready]
set_false_path -hold -from [get_pins slave/awready_reg] -to [get_pins master/awready]
```

<span class="blue">AXI 从机设计不是写状态机，是写时序约束。</span>