# AXI 性能优化与 QoS [E→M]

> **本章学习目标**：
> - 理解 <span class="red">AXI 总线性能瓶颈</span> 的根因分析
> - 掌握 <span class="red">QoS 优先级调度</span> 与仲裁策略
> - 学会用 RTL 仿真评估总线利用率

---

<span class="blue">从何而来 → 为什么需要 → 哪里用：</span><br>
<span class="red">AXI QoS 机制</span>诞生于 <span class="green">AMBA 4</span> 规范（2010 年）。<br>
随着多核 SoC 的兴起，CPU、GPU、DMA 等多个 Master 共享 DDR，<br>
低优先级事务可能阻塞高优先级实时任务。<span class="blue">AXI4 引入 4-bit QoS 信号，让 Interconnect 根据优先级动态仲裁，保障 CPU 实时性。</span><br>
如今，QoS 调度是手机 SoC、汽车 ECU、<span class="green">AI 加速器</span>等场景的必备机制。<br>

---

## AXI 总线的性能瓶颈分析

---

### <strong>瓶颈来源：地址通道、数据通道与响应通道</strong>

<span class="red">AXI 性能瓶颈</span>通常出现在三个位置：<br>

<span class="blue">类比理解：AXI 总线如同"多车道高速公路"</span><br>
地址通道 = 收费站（车辆排队缴费）<br>
数据通道 = 主车道（车辆实际行驶）<br>
响应通道 = 出口匝道（车辆下高速）<br>
任何一个环节拥堵，都会导致整条高速公路瘫痪。<br>

<span class="orange"><strong>1. 地址通道拥塞</strong></span><br>
多个 Master 同时发起地址请求，<br>
Interconnect 的地址通道成为瓶颈。<br>
<span class="blue">症状：AWVALID/ARVALID 持续为高，但 AWREADY/ARREADY 长期为低。</span><br>

<span class="orange"><strong>2. 数据通道带宽不足</strong></span><br>
数据宽度或时钟频率不足，<br>
无法支撑峰值带宽需求。<br>
<span class="blue">症状：WREADY/RVALID 间歇性为低，数据流不连续。</span><br>

<span class="orange"><strong>3. 响应通道反压</strong></span><br>
Slave 处理速度慢，BVALID/RVALID 延迟大。<br>
Master 必须等待响应后才能释放事务 ID。<br>
<span class="blue">症状：BVALID 在 WLAST 后数百 cycle 才拉高。</span><br>

---

### <strong>性能指标测量方法</strong>

| 指标 | 测量方法 | 目标值 |
| --- | --- | --- |
| 地址握手延迟 | AWVALID→AWREADY 的 cycle 数 | < 2 cycle |
| 数据吞吐率 | 单位时间内传输的 byte 数 / 理论带宽 | > 80% |
| 响应延迟 | WLAST→BVALID 的 cycle 数 | < 50 cycle（DDR） |
| 总线利用率 | 有效传输 cycle / 总 cycle | > 70% |

```verilog
// 性能计数器模块（RTL 实现）
module axi_perf_counter (
  input        ACLK,
  input        ARESETn,
  input        AWVALID, AWREADY,
  input        WVALID, WREADY, WLAST,
  input        BVALID, BREADY,
  output [31:0] addr_latency,   // 地址握手延迟
  output [31:0] resp_latency,     // 响应延迟
  output [31:0] byte_count        // 传输字节数
);
  reg [31:0] aw_wait_cycles;
  reg [31:0] resp_wait_cycles;
  reg [31:0] byte_cnt;
  
  always @(posedge ACLK) begin
    if (AWVALID && !AWREADY) aw_wait_cycles <= aw_wait_cycles + 1;
    if (WLAST && !BVALID) resp_wait_cycles <= resp_wait_cycles + 1;
    if (WVALID && WREADY) byte_cnt <= byte_cnt + 8;  // 假设 64-bit 宽度
  end
  
  assign addr_latency = aw_wait_cycles;
  assign resp_latency = resp_wait_cycles;
  assign byte_count = byte_cnt;
endmodule
```

---

## QoS 优先级调度与仲裁策略

---

### <strong>固定优先级 vs 轮询仲裁</strong>

Interconnect 的仲裁器决定多主争用时的 winner。<br>

| 仲裁策略 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- |
| 固定优先级 | 高优先级 Master 延迟确定性 | 低优先级可能饿死 | CPU + DMA 混合系统 |
| 轮询（Round-Robin） | 公平，无饿死 | 高优先级无特权 | 同级 Master 对等系统 |
| 加权轮询 | 兼顾公平与优先级 | 配置复杂 | 多核 CPU + GPU |
| QoS 感知 | 实时保障最高优先级 | 实现面积大 | 手机/汽车 SoC |

<span class="blue">手机 SoC 通常采用 QoS 感知仲裁：CPU 实时任务（QoS=0xF）可随时抢占 DMA（QoS=0x4）。</span><br>

---

### <strong>AXI QoS 信号的使用规范</strong>

<span class="red">QoS 信号</span>是 <span class="green">AWQOS/ARQOS</span>（4-bit），<br>
由 Master 在发起事务时设置。<br>

```c
// Linux Coresight ETB 驱动中设置 QoS（内核代码片段）
// 调试跟踪缓冲区写 DDR，优先级低于 CPU
dma_set_qos(dev, 0x2);  // 低优先级，不干扰正常运行

// GPU 驱动中设置 QoS（高优先级，保障帧率）
dma_set_qos(dev, 0x8);  // 高优先级，抢占 DMA 拷贝
```

<span class="blue">QoS 值仅在 Interconnect 内部使用，Slave 不可见。</span><br>

---

### <strong>嵌入式专属：实时系统的确定性延迟保障</strong>

<span class="orange"><strong>1. 汽车 ECU 的 AXI QoS 配置</strong></span><br>

在 <span class="green">R-Car H3</span> 汽车 SoC 中：<br>
* 制动控制 CPU：QoS = 0xF（最高，延迟 < 1us）<br>
* 仪表盘 GPU：QoS = 0xA（高，保障 60fps）<br>
* 信息娱乐 DMA：QoS = 0x2（低，可中断）<br>

<span class="orange"><strong>2. 工业 PLC 的总线隔离</strong></span><br>

通过 <span class="green">AXI Firewalls</span> 实现物理隔离：<br>
* 安全相关 Master（PLC 控制核）→ 固定优先级仲裁 → 独立 DDR 区域<br>
* 非安全 Master（HMI 显示）→ 轮询仲裁 → 共享 DDR 区域<br>

---

## RTL 仿真与性能评估

---

### <strong>SystemVerilog 验证环境的搭建</strong>

```systemverilog
// AXI VIP（Verification IP）随机压力测试
class axi_random_test extends uvm_test;
  axi_master_agent master;
  axi_slave_agent  slave;
  
  task run_phase(uvm_phase phase);
    // 发起 1000 次随机突发事务
    repeat (1000) begin
      axi_transaction txn = new();
      txn.randomize() with {
        burst_type == INCR;
        burst_len inside {[1:16]};
        qos inside {[0:15]};
      };
      master.send(txn);
    end
    
    // 检查总线利用率
    $display("Bus utilization: %0.2f%%", 
             slave.get_utilization() * 100);
  endtask
endclass
```

---

## 本章小结

| 概念 | 一句话总结 |
| --- | --- |
| 地址拥塞 | AW/AR 通道成为瓶颈，READY 长期为低 |
| 数据带宽不足 | 宽度或频率不够，数据流断续 |
| 响应反压 | Slave 慢，BVALID/RVALID 延迟大 |
| 固定优先级 | 高优先级延迟确定，但低优先级可能饿死 |
| QoS 感知 | 根据 QoS 值动态仲裁，实时系统必备 |
| 性能计数器 | RTL 内嵌计数器，实时测量握手延迟和吞吐 |

---

## 练习

1. 分析一个 AXI 波形：AWVALID=1 持续 20 cycle 但 AWREADY=0，可能是什么原因？<br>
2. 为什么轮询仲裁不适合 CPU + DMA 的混合系统？<br>
3. 在汽车 SoC 中，如果制动控制 CPU 和信息娱乐 DMA 共享 DDR，如何用 QoS 保障制动实时性？
