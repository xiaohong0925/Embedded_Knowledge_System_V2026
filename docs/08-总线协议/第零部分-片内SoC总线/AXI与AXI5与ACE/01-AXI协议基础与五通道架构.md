# AXI协议基础与五通道架构

<span class="badge-i">[I]</span>

---

### AXI的定位

AXI（Advanced eXtensible Interface）是AMBA3引入的<span class="red">高性能片上互连协议</span>，<br>
核心思想：把读写交易的地址、数据、响应完全分离到独立通道。<br>

与AHB的差异：<br>
- AHB是共享总线，同一时刻只有一个master在传地址<br>
- AXI是交叉开关（crossbar），五个通道可以并行跑<br>

类比：AHB像单车道马路，AXI像五车道分离式高架——<br>
去程地址、去程数据、返程地址、返程数据、返程确认各自一条道，互不堵车。<br>

---

### 五通道详解

```mermaid
flowchart LR
    subgraph Master
        AW[AW Channel]
        W[W Channel]
        AR[AR Channel]
        R[R Channel]
        B[B Channel]
    end
    subgraph Slave
        SAW[AW]
        SW[W]
        SAR[AR]
        SR[R]
        SB[B]
    end
    AW -->|Write Address| SAW
    W -->|Write Data| SW
    B -->|Write Response| SB
    AR -->|Read Address| SAR
    R -->|Read Data| SR
```

| 通道 | 方向 | 作用 | 关键信号 |
|------|------|------|----------|
| AW | M→S | 写地址 | AWADDR, AWID, AWLEN, AWSIZE, AWBURST |
| W | M→S | 写数据 | WDATA, WSTRB, WLAST, WID |
| B | S→M | 写响应 | BRESP, BID |
| AR | M→S | 读地址 | ARADDR, ARID, ARLEN, ARSIZE, ARBURST |
| R | S→M | 读数据 | RDATA, RRESP, RLAST, RID |

<span class="blue">易错点：写响应B通道不是可选的，AXI规定每笔写交易必须收到BRESP才算完成。</span><br>

---

### 握手机制

AXI 每个通道独立握手，使用 <span class="red">VALID/READY 双信号握手</span>：<br>
- VALID 由发送方拉高，表示"数据有效"<br>
- READY 由接收方拉高，表示"我能收"<br>
- 两者同时为高时，时钟上升沿完成一次传输<br>

```mermaid
sequenceDiagram
    participant M as Master
    participant S as Slave
    M->>S: AWVALID + AWADDR
    S-->>M: AWREADY
    Note over M,S: 地址握手完成
    M->>S: WVALID + WDATA
    S-->>M: WREADY
    Note over M,S: 数据握手完成
    S->>M: BVALID + BRESP
    M-->>S: BREADY
    Note over M,S: 响应握手完成
```

<span class="green">VALID/READY 握手</span>的关键规则：<br>
1. VALID 一旦拉高，必须保持到 READY 为高后才能拉低<br>
2. READY 可以等 VALID 也可以不等（先READY后VALID叫"提前开门"）<br>
3. 不允许 VALID 等 READY 超过一个必要周期而降低<br>

---

### 关键信号字段解析

#### AxID[3:0] — 交易标识

<span class="red">AxID 是 AXI 乱序完成的灵魂</span>，每笔交易带一个ID，<br>
slave 返回响应时也带同样的ID，master靠ID匹配哪笔交易完成了。<br>

| 信号 | 宽度 | 含义 |
|------|------|------|
| AWID/ARID | 配置决定 | 写/读交易ID |
| BID/RID | 同AWID/ARID | 响应返回的ID |

#### AxADDR[31:0] — 起始地址

突发传输的起始字节地址。<br>
<span class="blue">注意：AXI4支持64位地址（AXI4 扩展为AxADDR[63:0]）。</span><br>

#### AxLEN[7:0] — 突发长度

AXI3：AxLEN[3:0]，突发长度 = AxLEN + 1，范围1~16拍<br>
AXI4：AxLEN[7:0]，突发长度 = AxLEN + 1，范围1~256拍<br>

#### AxSIZE[2:0] — 每拍数据宽度

| AxSIZE | 每拍字节数 |
|--------|----------|
| 0b000 | 1 Byte |
| 0b001 | 2 Bytes |
| 0b010 | 4 Bytes |
| 0b011 | 8 Bytes |
| 0b100 | 16 Bytes |
| 0b101 | 32 Bytes |
| 0b110 | 64 Bytes |
| 0b111 | 128 Bytes |

总传输字节数 = (AxLEN + 1) × (2^AxSIZE)<br>

#### AxBURST[1:0] — 突发类型

| 编码 | 类型 | 说明 |
|------|------|------|
| 0b00 | FIXED | 固定地址，FIFO队列专用 |
| 0b01 | INCR | 递增地址，常规内存访问 |
| 0b10 | WRAP | 回环地址，cache line填充 |
| 0b11 | Reserved | 保留 |

---

### AXI4新增信号

AXI4 在 AXI3 基础上新增了若干信号，<br>
<span class="red">其中QoS和Region信号对系统级性能调优至关重要</span>。<br>

| 新增信号 | 方向 | 作用 |
|----------|------|------|
| AxQOS[3:0] | M→S | 服务质量优先级，0~15，越大越优先 |
| AxREGION[3:0] | M→S | 地址区域标识，用于物理地址到 slave 的映射 |
| AxUSER | M→S | 用户自定义扩展，厂商可自由定义 |
| AxLOCK | M→S | 原子访问指示（AXI3原有但AXI4简化为1bit） |
| AxCACHE[3:0] | M→S | 缓存策略提示（Bufferable/Cacheable等） |
| AxPROT[2:0] | M→S | 保护类型（特权/安全/指令数据） |

<span class="blue">易错点：AxCACHE 只是"提示"，slave可以选择忽略。</span><br>
真正决定缓存行为的，是系统级的MMU配置和slave自身的实现。<br>

---

### AXI4-Lite 与 AXI4 的差异

| 特性 | AXI4 | AXI4-Lite |
|------|------|-----------|
| 突发传输 | 支持1~256拍 | 仅单拍（AxLEN固定为0） |
| ID信号 | 支持多ID乱序 | 无ID，顺序完成 |
| 数据宽度 | 32/64/128/256... | 32/64 bit |
| 锁传输 | 支持 | 不支持 |
| 应用场景 | DDR、DMA、高性能互联 | 寄存器映射外设、控制接口 |

<span class="purple">扩展</span>：AXI4-Lite 虽然简单，但在Zynq、Cortex-M这类系统中，<br>
90%的外设控制端口都是AXI4-Lite，因为寄存器访问本来就是单拍。<br>

---

**学习路径提示**：<br>
- <span class="badge-i">[I]</span> 读者：记住五通道的名字和方向，理解VALID/READY握手规则。<br>
- 重点掌握AxLEN、AxSIZE、AxBURST三个字段，它们是后续突发传输计算的基石。<br>
