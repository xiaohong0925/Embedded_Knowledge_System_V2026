# SD 与 MMC 与 SDIO 基础认知与协议 [I→E]

> **本章学习目标**：
> - 理解 <span class="red">SD（Secure Digital）</span> 从 MMC 演进的完整脉络
> - 掌握 <span class="red">命令/响应协议</span> 与 SDR/DDR 传输模式
> - 了解 SDIO 在 WiFi/BT 模组中的典型应用

---

## SD/MMC 的诞生：从闪存卡到嵌入式存储

---

### <strong>为什么需要 SD：统一闪存卡标准</strong>

<span class="red">SD 卡</span>由 <span class="green">SanDisk、Panasonic、Toshiba</span> 在 <span class="green">1999 年</span>联合推出，
<br>
前身是 <span class="green">1997 年</span>的 <span class="green">MMC（MultiMediaCard）</span>。
<br>

在 SD 出现之前，数码相机使用各种私有格式：
<br>
* <span class="green">CompactFlash</span>（CF，1994，体积大）
<br>
* <span class="green">SmartMedia</span>（1995，东芝，已淘汰）
<br>
* <span class="green">Memory Stick</span>（1998，索尼，封闭生态）
<br>

<span class="blue">SD 通过开放标准 + 小型化 + 安全版权保护（DRM），统一了消费电子存储卡市场。</span>
<br>

<span class="blue">类比：SD 如同"USB 闪存盘的鼻祖"——在 USB 闪存盘普及之前（2000 年后），SD 卡是数码相机、MP3 播放器的通用存储介质。</span>
<br>

---

### <strong>SD 的物理层：9-pin 接口与信号定义</strong>

<span class="red">SD 卡</span>使用 9 根引脚：
<br>

| 引脚 | 名称 | 方向 | 说明 |
| --- | --- | --- | --- |
| 1 | DAT3/CS | 双向 | 数据线 3（SD 模式）/ 片选（SPI 模式） |
| 2 | CMD | 双向 | 命令/响应线 |
| 3 | VSS | — | 地 |
| 4 | VDD | — | 电源（2.7~3.6V） |
| 5 | CLK | 主机→卡 | 时钟（0~208MHz） |
| 6 | VSS | — | 地 |
| 7 | DAT0 | 双向 | 数据线 0 |
| 8 | DAT1 | 双向 | 数据线 1 / IRQ（SDIO） |
| 9 | DAT2 | 双向 | 数据线 2 / 读等待 |

```mermaid
flowchart TD
    HOST["SD Host\nSoC 控制器"]
    CARD["SD Card\n/eMMC"]
    
    HOST --"CMD"--> CARD
    HOST --"CLK"--> CARD
    HOST --"DAT0-3"--> CARD
    
    subgraph 信号说明
        CMD["CMD: 命令/响应\n48-bit 帧"]
        CLK["CLK: 0~208MHz"]
        DAT["DAT0-3: 4-bit 并行数据"]
    end
```

<span class="blue">SD 协议支持两种模式：SD 模式（4-bit 并行，高性能）和 SPI 模式（1-bit 串行，兼容低成本 MCU）。</span>
<br>

---

### <strong>从 SD 到 eMMC：嵌入式封装的演进</strong>

<span class="red">eMMC（embedded MultiMediaCard）</span>是 SD 协议的嵌入式版本：
<br>

| 特性 | SD 卡 | eMMC | 差异原因 |
| --- | --- | --- | --- |
| 封装 | 可插拔 | BGA 贴片 | eMMC 固定焊接 |
| 引脚 | 9 pin | 153 ball BGA | 更多电源/地 |
| 速率 | UHS-I 104MB/s | HS400 400MB/s | eMMC 走 PCB 更短 |
| 容量 | 2TB max | 256GB typical | 嵌入式场景需求 |
| 可靠性 | 消费级 | 工业级可选 | eMMC 支持 pSLC |

<span class="blue">eMMC 将 NAND Flash + Flash 控制器 + 标准接口封装在一起，SoC 只需实现标准 SD/MMC 控制器即可。</span>
<br>

---

### <strong>SDIO：把 SD 接口变成通用外设总线</strong>

<span class="red">SDIO（SD Input/Output）</span>是 SD 协议的扩展：
<br>
* 不仅传输存储数据，还传输 I/O 数据
<br>
* <span class="green">WiFi 模组</span>（如 ESP8089、AP6212）通过 SDIO 接口连接 SoC
<br>
* <span class="green">蓝牙模组</span>、<span class="green">GPS 模组</span>也常用 SDIO
<br>

```mermaid
flowchart TD
    SOC["SoC\nSDIO Host"]
    WIFI["WiFi 模组\nAP6212"]
    BT["蓝牙模组\nAP6212"]
    
    SOC --"CMD + CLK + DAT0-3"--> WIFI
    SOC --"CMD + CLK + DAT0-3"--> BT
    
    subgraph SDIO 共享
        NOTE["同一 SDIO 总线\n可挂多个 SDIO 设备\n通过地址区分"]
    end
```

<span class="blue">SDIO 的优势：省引脚（9 pin 实现存储+WiFi+BT）、标准化驱动、热插拔支持。</span>
<br>

---

## 本章小结

| 概念 | 一句话总结 |
| --- | --- |
| SD | SanDisk/Panasonic/Toshiba 1999 年推出的闪存卡标准 |
| MMC | SD 的前身，1997 年由西门子/闪迪提出 |
| eMMC | 嵌入式 MMC，BGA 封装，焊在 PCB 上 |
| SDIO | SD 的 I/O 扩展，WiFi/BT/GPS 模组常用 |
| UHS-I/II | 超高速模式，104/312 MB/s |
| HS400 | eMMC 高速模式，400 MB/s |

---

## 练习

1. 为什么 eMMC 的带宽比 SD 卡更高？画出两者信号走线的差异。
2. SDIO WiFi 模组和 USB WiFi 模组各有什么优劣？在嵌入式场景中如何选择？
3. 在 STM32MP1 上配置 SDMMC1 为 4-bit 模式、50MHz，计算理论带宽。
