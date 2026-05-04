# 高级错误报告

<span class="badge-e">[Expert]</span>

<span class="red">AER（Advanced Error Reporting）</span> 是 PCIe 的错误检测与报告机制，区分 Correctable 和 Uncorrectable 错误，帮助系统实现高可用性。

---

## <strong>基础认知</strong>

### <strong>为什么需要 AER</strong>

<span class="blue">高速串行传输中，比特错误不可避免。</span> AER 提供细粒度的错误分类和报告，使系统能够采取针对性恢复措施。

---

## <strong>原理解析</strong>

### <strong>错误分类</strong>

| 类别 | 示例 | 处理方式 |
|------|------|----------|
| Correctable | 接收端检测到 LCRC 错误，请求重传 | 硬件自动恢复，软件可选记录 |
| Uncorrectable Non-Fatal |  Poisoned TLP 到达 | 软件终止相关事务，设备继续运行 |
| Uncorrectable Fatal | 链路训练失败 | 系统可能需要复位链路或重启 |

### <strong>AER 寄存器结构</strong>

```
Advanced Error Reporting Capability:
  + UnCorrectable Error Status/ Mask
  + Correctable Error Status / Mask
  + Advanced Error Capabilities and Control
  + Header Log Register (4DW)
  + Root Error Command / Status
  + Error Source Identification
```

### <strong>Linux AER 驱动</strong>

```bash
# 查看 AER 统计
cat /sys/bus/pci/devices/0000:01:00.0/aer_
# aer_correctable  aer_uncorrectable  aer_stats

cat /sys/bus/pci/devices/0000:01:00.0/aer_correctable
# RxErr 0
# BadTLP 0
# BadDLLP 0
# Rollover 0
```

---

## <strong>软硬件实战</strong>

### <strong>场景：注入错误测试 AER</strong>

```bash
# 通过 debugfs 注入可纠正错误
echo 1 > /sys/kernel/debug/pcie_inject/correctable
```

<span class="red">错误注入仅在测试环境使用</span>，生产系统禁用。

---

## <strong>历史演进</strong>

- <span class="green">PCIe 1.1</span> — 引入基础 AER<br>
- <span class="green">PCIe 3.0</span> — 扩展错误分类，增加 TLP Prefix 相关错误<br>
- <span class="green">PCIe 4.0</span> — 支持 16GT/s 特有的物理层错误检测

---

## 小结与练习

| 要点 | 说明 |
|------|------|
| 核心概念 | AER 将错误分为 Correctable/Uncorrectable，实现分级恢复 |
| 关键技能 | 配置 AER Mask、读取错误日志、分析故障根因 |

**练习**

1. 列出 Correctable 和 Uncorrectable 各三种典型错误类型。
2. 分析为什么 AER 需要 Root Port 和 Endpoint 协同工作。
3. 编写脚本定期检查 `/sys/bus/pci/*/aer_*` 并生成错误趋势报告。
