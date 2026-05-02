# AHB 仲裁与多主控制 **[I→E]**

> <span class="badge-i">I</span> → <span class="badge-e">E</span>

### <strong>多主仲裁机制</strong>

<span class="badge-i">I</span>

AHB 支持多 Master（如 CPU + DMA）共享总线，通过仲裁器决定谁获得访问权。

仲裁信号：
- **HBUSREQ**：Master 请求总线（"我要用总线"）
- **HLOCKx**：Master 锁定总线（"这 burst 不许打断"）
- **HGRANT**：仲裁器授权（"给你用"）

仲裁策略：

| 策略 | 实现 | 优点 | 缺点 |
|------|------|------|------|
| 固定优先级 | CPU=3, DMA=2, Debug=1 | 简单、延迟确定 | 低优先级可能饿死 |
| 轮询 | A→B→C→A... | 绝对公平 | 增加切换开销 |
| 混合策略 | 高优先级固定 + 同优先级轮询 | 兼顾确定性和公平性 | 实现稍复杂 |

嵌入式常用固定优先级：CPU > DMA > 调试。因为 CPU 取指不能等，DMA 可以缓一缓。

### <strong>总线矩阵与地址译码</strong>

<span class="badge-i">I</span>

AHB 总线矩阵是多主多从的交叉开关，内部由仲裁器 + 多路选择器组成。

地址译码：每个 Slave 对应一段地址空间，由 HSELx 信号选择。

典型地址映射：
```
0x0000_0000 - 0x0FFF_FFFF → DDR (HSEL0)
0x2000_0000 - 0x2FFF_FFFF → SRAM (HSEL1)
0x4000_0000 - 0x400F_FFFF → APB Bridge (HSEL2)
0x4010_0000 - 0x401F_FFFF → DMA (HSEL3)
```

默认 Slave：访问未映射地址时，HRESP=ERROR。

### <strong>RETRY 与 SPLIT 响应 **[M]**</strong>

<span class="badge-m">M</span>

AHB 定义了 4 种响应：

| 响应 | HRESP | 含义 | Master 行为 |
|------|-------|------|-------------|
| OKAY | 00 | 正常完成 | 继续 |
| ERROR | 01 | 地址/权限错误 | 报错，可能终止传输 |
| RETRY | 10 | Slave 忙，稍后重试 | 重试同一地址，不释放总线 |
| SPLIT | 11 | Slave 不能立即响应 | 释放总线，Slave 准备好后通知重试 |

**RETRY vs SPLIT 的关键区别**：
- RETRY：Master 占着总线重试，其他 Master 干等着
- SPLIT：Master 释放总线，仲裁器把总线给别人用；Slave 准备好后通过仲裁器通知原 Master 重新请求

SPLIT 效率更高但实现复杂：仲裁器需要维护一个"等待队列"，记录哪些 Master 在等哪个 Slave。

AHB-Lite：ARM 后来推出的简化子集，去掉了 RETRY/SPLIT 和多主仲裁，只保留单主模式。绝大多数 Cortex-M 系列使用 AHB-Lite。