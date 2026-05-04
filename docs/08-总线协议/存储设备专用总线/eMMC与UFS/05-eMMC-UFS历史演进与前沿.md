# eMMC与UFS历史演进

<span class="badge-e">[Expert]</span>

<span class="red">eMMC（embedded MultiMediaCard）</span> 和 <span class="red">UFS（Universal Flash Storage）</span> 是嵌入式系统的主流板载存储标准。

---

## <strong>历史演进</strong>

### <strong>eMMC 路线</strong>

- <span class="green">eMMC 4.5 (2011)</span> — 200MB/s，HS200模式<br>
- <span class="green">eMMC 5.0 (2013)</span> — 400MB/s，HS400模式，缓存增强<br>
- <span class="green">eMMC 5.1 (2015)</span> — 命令队列，安全写入保护<br>

### <strong>UFS 路线</strong>

- <span class="green">UFS 1.0 (2011)</span> — 300MB/s，MIPI M-PHY<br>
- <span class="green">UFS 2.0 (2013)</span> — 1.2GB/s<br>
- <span class="green">UFS 3.0 (2018)</span> — 2.9GB/s，2.5mm封装<br>
- <span class="green">UFS 4.0 (2022)</span> — 4.6GB/s，MIPI M-PHY v5.0<br>

## <strong>JEDEC标准路线</strong>

<span class="blue">JEDEC 统一制定 eMMC 和 UFS 规范</span>，确保全球兼容性。eMMC 定义在 JESD84 系列，UFS 在 JESD220 系列。

---

## 小结与练习

**练习**

1. 比较 eMMC HS400 与 UFS 2.1 在随机读写性能上的差异。
2. 分析为什么 UFS 采用 SCSI 命令集而非 eMMC 的简化命令。
3. 预测 eMMC 何时会被 UFS 完全替代。
