# AXI 五通道与握手机制 **[I→E]**

> <span class="badge-i">I</span> → <span class="badge-e">E</span>

### <strong>五通道架构详解</strong>

<span class="badge-i">I</span>

AXI4 把一次完整的数据传输拆分为 5 个独立通道，每个通道有各自的 VALID/READY 握手：

| 通道 | 方向 | 作用 | 关键信号 |
|------|------|------|----------|
| AR（读地址） | Master→Slave | 发读请求 | ARADDR, ARID, ARLEN, ARSIZE |
| R（读数据） | Slave→Master | 返回读数据 | RDATA, RID, RLAST, RRESP |
| AW（写地址） | Master→Slave | 发写请求 | AWADDR, AWID, AWLEN, AWSIZE |
| W（写数据） | Master→Slave | 发送写数据 | WDATA, WSTRB, WLAST |
| B（写响应） | Slave→Master | 返回写完成确认 | BID, BRESP |

为什么拆成 5 个通道？
- **读写地址分离** → 读和写可以同时发起，互不影响
- **数据与响应分离** → 写数据单向流（Master→Slave），写响应反向（Slave→Master），方向清晰
- **读数据与写数据分离** → 避免共享总线时的冲突

### <strong>握手协议：VALID / READY</strong>

<span class="badge-i">I</span>

所有 5 个通道使用同一套握手规则，只有两条控制线：

- **VALID**：发送方说"我有数据/地址准备好了"
- **READY**：接收方说"我准备好接收了"
- **传输发生**：VALID && READY 同时为高，一个时钟周期完成一次传输

VALID 一旦拉高，发送方必须保持它直到 READY 到来，不能中途撤回。这是 AXI 规范的铁律，违反会导致数据丢失。

三种握手场景：
1. **VALID 先等 READY**：发送方慢，先拉高 VALID，等接收方 READY
2. **READY 先等 VALID**：接收方慢，先拉高 READY，等发送方 VALID（流水线缓冲常用）
3. **同时有效**：最理想，单周期握手

```verilog
// 典型的 AXI 握手逻辑（简化）
always @(posedge clk) begin
    if (valid && ready)  // 传输发生
        data_reg <= data;
end
```

### <strong>通道间依赖关系与死锁规避</strong>

<span class="badge-e">E</span>

AXI 规范严格规定了通道之间的依赖关系，违反会导致死锁：

**必须遵守的规则：**
- AW 必须在 W 之前或同时发出（不能先给数据再告诉地址）
- W 可以在 AW 之前完成握手，但第一个 W beat 不能在 AW 之前开始传输
- AR 与 AW 之间无依赖，读写完全独立并发
- R 必须在 AR 之后，B 必须在 AW/W 之后

**典型死锁场景：**
Master 逻辑："我要等收到 B 响应，才发下一个 AW"
Slave 逻辑："我要等收齐 W 的最后一个 beat（WLAST），才发 B"
如果 W 还没发完，Master 就不发下一个 AW，而 Slave 等 WLAST 等不到——双方互锁。

**解决策略：**
- Master 不要用 B 阻塞下一个 AW，可以连续发多个 AW
- Slave 收到 WLAST 后立即发 B，不要等额外条件
- 设计时画状态机图，检查是否有循环等待

<span class="red">死锁不是硬件bug，是协议理解bug。</span>