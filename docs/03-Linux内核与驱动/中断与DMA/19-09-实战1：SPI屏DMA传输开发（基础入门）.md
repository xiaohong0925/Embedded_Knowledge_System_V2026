# 实战1：SPI屏DMA传输开发（基础入门）

> 📊 **本节难度等级：** <span class="badge-i">**I级**</span>

---

### <strong>场景背景：嵌入式LCD屏显示图像（通过SPI-DMA传输像素数据）</strong>

嵌入式<span class="green">SPI</span>屏（如1.44寸ST7735、2.4寸ILI9341）是物联网设备的核心外设，
其显示原理是“CPU将像素数据通过<span class="green">SPI</span>总线写入屏显控制器的GRAM（显存）”——传统CPU轮询传输方式存在两大痛点：
1. CPU占用率高：
1.44寸ST7735的像素分辨率为128×128，24位色的像素数据量为128×128×3=49152字节，CPU逐字节写入需耗时约50ms，期间CPU被完全占用，无法处理传感器采集、网络通信等其他任务；
2. 帧率低：
CPU传输的刷新帧率仅能达到20fps左右，无法满足动态图像（如实时波形、视频流）的显示需求。

而<span class="green">SPI</span>-<span class="red">DMA</span>传输通过“内存→外设（MEM_TO_DEV）”的DMA模式，将像素数据从内存缓冲区自动传输到SPI控制器，全程无需CPU干预：传输49152字节仅需8ms，CPU占用率从100%降至5%以下，刷新帧率可提升至60fps以上，这是SPI屏实战开发中DMA的核心价值。<br>

### <strong>硬件准备：带DMA功能的SPI控制器、1.44寸SPI屏、开发板</strong>

（1）核心硬件清单（入门级推荐）
| 硬件名称                | 型号/规格                                  | 核心特性（DMA适配）|
|-------------------------|-------------------------------------------|-----------------------------------|
| 开发板                  | STM32MP157（ARM Cortex-A7+M4）| 内置SPI2控制器，支持DMA2通道1传输 |
| SPI屏                   | 1.44寸ST7735（24位色，128×128分辨率）| SPI接口，支持8位/16位数据传输     |
| 电源/连接线             | 5V供电、杜邦线                             | SPI引脚（SCLK/MOSI/CS/DC/RES）|

（2）硬件连接逻辑（<span class="green">SPI</span>2→ST7735）
<span class="green">SPI</span>屏的显示依赖“控制指令+像素数据”两类传输，硬件需连接SPI核心引脚+屏显控制引脚：

（3）硬件关键注意点（<span class="red">DMA</span>适配）
1. <span class="green">SPI</span>控制器的<span class="red">DMA</span>绑定：
STM32MP157的<span class="green">SPI</span>2_TX（发送）仅绑定<span class="red">DMA</span>2通道1，SPI2_RX无DMA支持（需查芯片手册确认“SPI-DMA通道映射”）；
2. <span class="green">SPI</span>数据宽度匹配：
ST7735支持8位数据传输，需将<span class="green">SPI</span>控制器的数据宽度配置为8位，否则<span class="red">DMA</span>传输会因宽度不匹配导致图像花屏；
3. 片选/DC引脚控制：
<span class="red">DMA</span>仅负责数据传输，<span class="green">SPI</span>屏的“指令/数据切换（DC）”“片选（CS）”仍需CPU通过GPIO控制（DMA无法直接操作GPIO）。<br>

### <strong>驱动开发步骤</strong>

1. <span class="red">设备树</span>配置：<span class="green">SPI</span>节点添加DMA属性（指定通道号）
<span class="red">设备树</span>是<span class="green">SPI</span>-DMA传输的“硬件适配入口”，需在SPI2节点中添加DMA通道、名称、传输参数等属性，告知内核SPI2与DMA2通道1的绑定关系。<br>

### <strong>关键技巧：DMA传输方向配置（MEM_TO_DEV）与长度校准</strong>

（1）MEM_TO_DEV传输方向的核心配置要点
1. 地址赋值规则：
`src_addr`为内存缓冲区物理地址（<span class="red">DMA</span>读取端），`dst_addr`为<span class="green">SPI</span>控制器的发送缓冲区物理地址（DMA写入端），不可颠倒；
2. 总线宽度匹配：
<span class="green">SPI</span>屏的像素数据为8位，需将`src_addr_width`和`dst_addr_width`均配置为`<span class="red">DMA</span>_SLAVE_BUSWIDTH_1_BYTE`，若配置为2字节会导致“像素数据错位”；
3. 触发源确认：
<span class="green">SPI</span>-DMA传输为硬件触发，需确认<span class="red">设备树</span>中dmas属性的触发源为SPI2_TX（如STM32MP157的0x800）。

（2）长度校准：避免传输截断或溢出
1. 像素长度计算：
24位色<span class="green">SPI</span>屏的像素长度=宽度×高度×3（如128×128×3=49152），16位色为宽度×高度×2；
2. 长度寄存器限制：
若使用STM32F103（16位长度寄存器），单次最大传输65535字节，128×128×3=49152<65535，无需拆分；若为更大屏（如320×240），需拆分传输；
3. 内存对齐：
像素缓冲区地址需按4字节对齐（`__aligned(4)`），避免<span class="red">DMA</span>地址错误。<br>

---
