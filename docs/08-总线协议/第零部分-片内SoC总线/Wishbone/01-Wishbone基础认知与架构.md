# Wishbone 基础认知与架构 **[B→I]**

> <span class="badge-b">B</span> → <span class="badge-i">I</span>

### <strong>Wishbone 核心定义与价值</strong>

<span class="badge-b">B</span>

Wishbone 是 OpenCores 组织推出的开源片上总线标准，2002 年发布 B.3 版。设计目标：简单到可以在课堂上手写 RTL，开放到没有授权费用。

为什么还需要 Wishbone？
- **FPGA 友好**：信号少、时序简单，综合工具容易优化
- **教学友好**：本科生能在一节课里理解并写出 Wishbone Master/Slave
- **开源惯性**：OpenCores 上有数百个 Wishbone IP 核（UART、SDRAM、VGA），即插即用

<span class="blue">Wishbone 是总线世界里的乐高积木，简单、开放、适合动手玩。</span>

典型应用场景：
- 学术项目：FPGA 课程设计、毕业设计中的 SoC 原型
- 开源处理器：OpenRISC、RISC-V 早期软核（如 PicoRV32）的默认总线
- 工业原型：快速验证外设 IP，验证通过后再迁移到 AXI/TileLink

### <strong>Wishbone 与 AMBA/TileLink 的定位差异</strong>

<span class="badge-b">B</span>

| 维度 | Wishbone | AMBA | TileLink |
|------|----------|------|----------|
| 出身 | OpenCores 开源 | ARM 商业 | RISC-V/SiFive |
| 协议页数 | ~30 页 | ~300 页 | ~100 页 |
| 缓存一致性 | 不支持 | ACE/CHI | 原生 TL-C |
| 突发传输 | 可选（循环突发） | 原生支持 | 原生支持 |
| 典型频率 | FPGA 50-100MHz | ASIC GHz 级 | ASIC/FPGA |

选择逻辑：FPGA 教学/原型 → Wishbone；商业 ASIC → AMBA；RISC-V ASIC → TileLink。

### <strong>Wishbone 信号速览</strong>

<span class="badge-i">I</span>

| 信号 | 方向 | 作用 |
|------|------|------|
| CLK_I / RST_I | 系统 | 时钟与复位 |
| ADR_O / ADR_I | Master→Slave | 地址总线（通常 8-32bit） |
| DAT_O / DAT_I | Master↔Slave | 数据总线（双向，通常 8/16/32bit） |
| WE_O | Master→Slave | 1=写，0=读 |
| SEL_O | Master→Slave | 字节选通 |
| STB_O | Master→Slave | 选通信号（Transaction 有效） |
| CYC_O | Master→Slave | 总线周期（burst 期间保持拉高） |
| ACK_I | Slave→Master | 1=确认完成 |
| ERR_I | Slave→Master | 1=错误（可选） |
| RTY_I | Slave→Master | 1=重试（可选） |

信号总数约 10-15 根，远少于 AXI 的 50+。
