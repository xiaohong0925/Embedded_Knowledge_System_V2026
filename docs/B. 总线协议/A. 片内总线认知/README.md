# A. 片内总线认知

> SoC 内部互连总线：APB、AHB、AXI、TileLink、NoC、CHI、UCIe

本目录覆盖 SoC 芯片内部的片上互连，从 ARM 的 AMBA 家族到 RISC-V 的 TileLink，再到多核一致性（CHI）与封装内 Chiplet 互连（UCIe）。按 v4 目录设计，本板块为 B 扩展第一站：先建立片内互连认知，再向板级与系统级总线延伸。

| 文件 | 主题 |
|------|------|
| [B-A.1.1 APB/AHB/AXI/TileLink概念认知](B-A.1.1_APB_AHB_AXI_TileLink概念认知.md) | 片内总线分层地图、设备树地址映射、`/proc/iomem` 核对 |
| [B-A.1.2 AXI深入与NoC片上网络](B-A.1.2_AXI深入与NoC片上网络.md) | 突发与对齐约束、AxCACHE/AxPROT 与映射 API、Crossbar→NoC、带宽竞争排查 |
| [B-A.1.3 CHI与UCIe互连](B-A.1.3_CHI与UCIe互连.md) | 目录式一致性、DMA 一致性根因链、Chiplet 封装、UCIe 3.0、NUMA 实践 |
