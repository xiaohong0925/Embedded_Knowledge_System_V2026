# 第二部分：高速外设扩展总线

<span class="badge-i">[I]</span> <span class="badge-e">[E]</span>


> **难度等级**：I → E
> 
> 本部分覆盖嵌入式系统中用于高速数据传输的外设总线，
> 从 SD 卡到 USB，从 SATA 到 PCIe，
> 是存储扩展、网络连接和高速通信的核心基础设施。

---

## 本部分大章概览

| 大章 | 难度 | 核心内容 | 典型场景 |
| --- | --- | --- | --- |
| SD/MMC/SDIO | I → E | 命令/响应协议、卡检测、SDR/DDR 模式 | TF 卡、eMMC、WiFi 模组 |
| SATA/SAS | E | AHCI 命令队列、NCQ、热插拔 | 工业存储、NAS、边缘服务器 |
| PCI/PCIe | I → M | TLP 包格式、链路训练、MSI-X 中断 | GPU、NVMe SSD、高速网卡 |
| USB | I → E | 端点/管道、描述符、EHCI/xHCI | U 盘、摄像头、4G/5G 模组 |

---

## 学习路径建议

**路径 A（存储方向）**：
SD/MMC → SATA → PCIe NVMe

**路径 B（通信方向）**：
USB → PCIe → SDIO

**路径 C（快速入门）**：
SD/MMC → USB（覆盖 80% 的嵌入式项目）

---

## 选型速查表

| 场景 | 推荐总线 | 原因 |
| --- | --- | --- |
| 扩展 TF 卡存储 | SD/MMC | 标准协议，驱动成熟 |
| 连接 NVMe SSD | PCIe | 带宽最高，延迟最低 |
| 接 U 盘或 USB 摄像头 | USB 2.0/3.0 | 即插即用，驱动丰富 |
| 工业级大容量存储 | SATA | 热插拔，AHCI 标准化 |
| WiFi/BT 模组 | SDIO | 共享 SD 接口，省引脚 |
| 高速采集卡 | PCIe | DMA 直通，带宽无瓶颈 |

---

## 速率对比

| 总线 | 理论带宽 | 典型嵌入式速率 |
| --- | --- | --- |
| SD UHS-I | 104 MB/s | 80~90 MB/s |
| SD UHS-II | 312 MB/s | 250 MB/s |
| eMMC 5.1 | 400 MB/s | 320 MB/s |
| SATA III | 600 MB/s | 550 MB/s |
| USB 3.0 | 500 MB/s | 400 MB/s |
| USB 3.1 Gen2 | 1250 MB/s | 1000 MB/s |
| PCIe 3.0 x1 | 1 GB/s | 900 MB/s |
| PCIe 3.0 x4 | 4 GB/s | 3.5 GB/s |

