# TileLink逻辑级与原子操作

<span class="badge-e">[Expert]</span>

<span class="red">TileLink</span> 是 SiFive（源自 Berkeley）提出的开源片上互连协议，为 RISC-V 生态提供缓存一致性支持。

---

## <strong>基础认知</strong>

### <strong>权限模型</strong>

| 权限 | 缩写 | 允许操作 |
|------|------|----------|
| 无 | N | 无 |
| 读 | R | 读取 |
| 写 | W | 写入 |
| 读+写 | RW | 读写 |
| 执行 | X | 取指 |
| 读+执行 | RX | 代码段 |

### <strong>LR/SC原子操作</strong>

<span class="blue">TileLink 原生支持 Load-Reserved / Store-Conditional</span>，实现无锁同步。

```
Core A: LR [addr]  → 保留地址
Core B: SC [addr]  → 检测保留失效，返回失败
Core A: SC [addr]  → 成功写入
```

---

## <strong>小结与练习</strong>

**练习**

1. 比较 TileLink TL-C 和 AXI ACE 在缓存一致性消息上的差异。
2. 分析为什么 RISC-V 选择 TileLink 而非直接采用 ACE。
3. 设计一个 TileLink 总线矩阵的仲裁策略。
