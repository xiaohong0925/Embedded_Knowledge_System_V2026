# APB逻辑级与桥接器

<span class="badge-i">[Intermediate]</span>

<span class="red">APB（Advanced Peripheral Bus）</span> 是 AMBA 家族中最简单的总线，专为低速外设设计。

---

## <strong>基础认知</strong>

### <strong>APB 传输时序</strong>

```
        T1      T2      T3
PCLK    |       |       |
PSEL    |______/‾‾‾‾‾‾‾\_____  选中从设备
PENABLE |____________/‾‾‾‾‾‾‾\  使能
PWRITE  |‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  写操作
PWDATA  |====DATA=============  数据
PRDATA  |                     读数据
PREADY  |____________/‾‾‾‾‾‾‾  从设备就绪
```

<span class="blue">APB 传输固定为两个周期（Setup + Access）</span>，无流水线，无突发。

### <strong>APB2/3/4/5 差异</strong>

| 版本 | 新增特性 |
|------|----------|
| APB2 | 基础协议 |
| APB3 | PREADY（从设备可扩展周期） |
| APB4 | PPROT（保护类型）、PSTRB（字节选通） |
| APB5 | PWAKEUP（低功耗唤醒）、PCHK（校验） |

---

## <strong>软硬件实战</strong>

### <strong>APB桥设计</strong>

```verilog
// AHB-to-APB Bridge 简化逻辑
always @(posedge HCLK) begin
    if (HTRANS == NONSEQ && HADDR inside [APB_BASE:APB_END]) begin
        apb_psel <= 1;
        apb_paddr <= HADDR;
        apb_pwrite <= HWRITE;
        apb_pwdata <= HWDATA;
    end
end
```

---

## <strong>小结与练习</strong>

**练习**

1. 画出APB4写传输的完整时序图（含PPROT和PSTRB）。
2. 分析为什么APB不能有流水线传输。
3. 设计一个APB GPIO控制器的寄存器映射。
