# QPI与OPI前沿趋势

<span class="badge-e">[Expert]</span>

<span class="red">QPI（QuickPath Interconnect）</span> 和 <span class="red">OPI（On-Package Interface）</span> 是 Intel 处理器互连技术，在嵌入式服务器领域有重要影响。

---

## <strong>前沿趋势</strong>

### <strong>Intel UPI 替代 QPI</strong>

| 特性 | QPI | UPI |
|------|-----|-----|
| 速率 | 6.4-9.6GT/s | 10.4-16GT/s |
| 用途 | 处理器互联 | 处理器+加速器互联 |
| 缓存一致性 | 支持 | 支持（CXL.cache扩展） |

<span class="blue">UPI 本质上是 QPI 的演进版本</span>，支持更多节点和更高带宽。

### <strong>ARM CHI 与 CCIX 竞争</strong>

| 技术 | 主导者 | 特点 |
|------|--------|------|
| CHI | ARM | AMBA 5 Coherent Hub Interface，ARM生态标准 |
| CCIX | AMD/Qualcomm | 缓存一致性加速器互联 |
| CXL | Intel | 内存扩展+缓存一致性，正在统一市场 |

<span class="red">CXL 正在整合 CCIX 和 CHI 的市场</span>，成为事实上的统一标准。

### <strong>CXL对QPI/OPI的影响</strong>

<span class="blue">CXL.mem 替代了传统处理器直连内存的模型</span>，允许通过外部内存池动态分配。

---

## 小结与练习

**练习**

1. 比较 UPI 和 CXL.cache 在缓存一致性实现上的异同。
2. 分析为什么 ARM 服务器生态选择 CHI 而非直接采用 CXL。
3. 预测 2028 年处理器互联标准的格局。
