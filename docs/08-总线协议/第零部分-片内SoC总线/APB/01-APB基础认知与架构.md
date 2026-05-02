# APB 基础认知与架构 **[B→I]**

> <span class="badge-b">B</span> → <span class="badge-i">I</span>

### <strong>APB 核心定义与价值</strong>

<span class="badge-b">B</span>

APB（Advanced Peripheral Bus）是 AMBA 家族中最低速、最简化的总线标准。它面向"寄存器型外设"：UART、I2C、GPIO、定时器、看门狗。

为什么不用 AHB/APB 直接连所有外设？
- **功耗**：高速总线时钟门控困难，APB 可以单独关时钟。一个 APB 桥下的 20 个外设，不用时整体关断
- **面积**：APB 从机接口只有十几个信号，AHB 需要几十个。50 个 APB 外设节省的面积很可观
- **速度匹配**：UART 波特率寄存器不需要 200MHz 访问，APB 的几十 MHz 足够

<span class="blue">APB 是总线世界的自行车，慢但省能量，短距离最合适。</span>

### <strong>APB 与 AHB 的本质差异</strong>

<span class="badge-b">B</span>

| 特性 | APB | AHB |
|------|-----|-----|
| 通道 | 1（地址+数据复用） | 1（地址+数据复用，但支持流水线） |
| 时钟 | 可单独分频/关断 | 通常与系统同频 |
| 突发 | 不支持 | 支持 |
| 等待 | 通过 PREADY 插入 | 通过 HREADY 插入 |
| 信号数 | ~12 个 | ~20+ 个 |

APB 不是 AHB 的"降级版"，而是"专用版"——专门为寄存器访问优化。

### <strong>APB 总线信号速览</strong>

<span class="badge-i">I</span>

| 信号 | 方向 | 作用 |
|------|------|------|
| PCLK / PRESETn | 系统 | 时钟与复位 |
| PADDR[31:0] | Master→Slave | 地址总线 |
| PWDATA / PRDATA | Master→Slave / Slave→Master | 写数据 / 读数据 |
| PWRITE | Master→Slave | 1=写，0=读 |
| PSELx | Master→Slave | Slave 选择（每个 Slave 一根） |
| PENABLE | Master→Slave | 传输使能 |
| PREADY | Slave→Master | 1=就绪，0=插入等待 |
| PSLVERR | Slave→Master | 1=传输错误（APB3+） |
| PPROT[2:0] | Master→Slave | 保护类型（APB4） |
| PSTRB[3:0] | Master→Slave | 字节选通（APB4） |

PSELx 是 APB 的特色：每个 Slave 有一根独立的 PSEL，由地址译码生成。这种设计简化了 Slave 逻辑——Slave 只需要看自己的 PSEL 是否拉高，不需要做地址比较。
