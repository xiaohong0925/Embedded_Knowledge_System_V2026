# SATA历史演进

<span class="badge-i">[Intermediate]</span>

<span class="red">SATA 的演进是存储接口从并行到串行、从机械到闪存的历史缩影。</span>

---

## <strong>历史演进</strong>

- <span class="green">1986 年 IDE/ATA</span> — 集成驱动电子，40针并行接口，最高 8.3MB/s<br>
- <span class="green">1994 年 Ultra ATA/33</span> — 引入 DMA，33MB/s<br>
- <span class="green">2000 年 Ultra ATA/133</span> — 并行极限，133MB/s，信号串扰严重<br>
- <span class="green">2003 年 SATA 1.0</span> — 串行化，1.5Gbps，解决并行瓶颈<br>
- <span class="green">2004 年 SATA 2.0</span> — 3Gbps，引入NCQ<br>
- <span class="green">2009 年 SATA 3.0</span> — 6Gbps，主流沿用至今<br>
- <span class="green">2013 年 SATA Express</span> — 尝试融合PCIe，市场失败<br>
- <span class="green">2015 年 NVMe 崛起</span> — PCIe 替代 SATA 成为高性能存储标准<br>

## <strong>嵌入式存储接口选择</strong>

| 场景 | 推荐接口 | 理由 |
|------|----------|------|
| 低成本大容量 | SATA SSD | 成熟、便宜、易维护 |
| 高性能嵌入式 | NVMe | 低延迟、高并发 |
| 可移动存储 | SD/microSD | 热插拔、标准化 |
| 板载存储 | eMMC/UFS | 焊接固定、省空间 |

---

## 小结与练习

**练习**

1. 画出从 IDE 到 NVMe 的存储接口演进时间线。
2. 分析为什么 SATA Express 未能成功替代 SATA。
3. 预测未来5年嵌入式存储接口的格局。
