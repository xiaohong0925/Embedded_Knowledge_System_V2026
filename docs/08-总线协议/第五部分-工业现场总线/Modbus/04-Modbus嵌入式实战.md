# Modbus 嵌入式实战 [I]

> **本章学习目标**：
> - 掌握 <span class="red">libmodbus</span> 库的使用方法与典型调用流程
> - 理解 STM32 Modbus RTU 从站的硬件配置与中断处理
> - 了解 PLC 通信中的寄存器映射设计与地址规划

---

## libmodbus 使用

---

### <strong>库初始化与连接建立</strong>

<span class="badge-i">I</span><br>
<span class="red">libmodbus</span> 是开源的 Modbus 协议栈，支持 RTU、TCP 与 IPv6，提供简洁的 C API。
<br>

<span class="blue">libmodbus 如同一个标准插座——无论插什么电器（RTU/TCP），接口形状（API）都一致。</span><br>

**表 4-1：libmodbus 核心 API**

| 函数 | 功能 | 返回值 |
| --- | --- | --- |
| modbus_new_rtu() | 创建 RTU 上下文 | modbus_t* |
| modbus_new_tcp() | 创建 TCP 上下文 | modbus_t* |
| modbus_set_slave() | 设置从站地址 | 0/-1 |
| modbus_connect() | 建立连接 | 0/-1 |
| modbus_read_registers() | 读保持寄存器 | 读取数量/-1 |
| modbus_write_register() | 写单个寄存器 | 1/-1 |
| modbus_write_registers() | 写多个寄存器 | 写入数量/-1 |
| modbus_close() / free() | 关闭与释放 | — |

<span class="orange"><strong>1. RTU 主站示例</strong></span><br>

```c
// libmodbus RTU 主站示例
// 文件：modbus_master.c

#include <modbus/modbus.h>

int main() {
    modbus_t *ctx;
    uint16_t tab_reg[32];
    int rc;
    
    // 创建 RTU 上下文: /dev/ttyUSB0, 9600, N, 8, 1
    ctx = modbus_new_rtu("/dev/ttyUSB0", 9600, 'N', 8, 1);
    if (ctx == NULL) {
        fprintf(stderr, "Failed to create modbus context\n");
        return -1;
    }
    
    // 设置从站地址
    modbus_set_slave(ctx, 1);
    
    // 建立连接
    if (modbus_connect(ctx) == -1) {
        fprintf(stderr, "Connection failed: %s\n", modbus_strerror(errno));
        modbus_free(ctx);
        return -1;
    }
    
    // 读取 10 个保持寄存器，起始地址 0
    rc = modbus_read_registers(ctx, 0, 10, tab_reg);
    if (rc == -1) {
        fprintf(stderr, "Read failed: %s\n", modbus_strerror(errno));
    } else {
        for (int i = 0; i < rc; i++)
            printf("reg[%d]=%d\n", i, tab_reg[i]);
    }
    
    // 写单个寄存器
    rc = modbus_write_register(ctx, 5, 1234);
    if (rc != 1)
        fprintf(stderr, "Write failed\n");
    
    modbus_close(ctx);
    modbus_free(ctx);
    return 0;
}
```

<span class="orange"><strong>2. TCP 从站示例</strong></span><br>

```c
// libmodbus TCP 从站示例
// 文件：modbus_tcp_slave.c

modbus_t *ctx = modbus_new_tcp("127.0.0.1", 1502);
modbus_mapping_t *mb_mapping = modbus_mapping_new(0, 0, 100, 0);

modbus_set_slave(ctx, 1);
modbus_connect(ctx);

while (1) {
    uint8_t query[MODBUS_TCP_MAX_ADU_LENGTH];
    int rc = modbus_receive(ctx, query);
    if (rc > 0) {
        modbus_reply(ctx, query, rc, mb_mapping);
    }
}
```

---

## STM32 Modbus RTU

---

### <strong>USART 配置与 DMA 收发</strong>

<span class="badge-i">I</span><br>
<span class="red">STM32 Modbus RTU 从站</span> 基于 USART + DMA + Timer 实现，Timer 用于帧间隔检测。
<br>

**表 4-2：STM32 关键配置参数**

| 参数 | 值 | 说明 |
| --- | --- | --- |
| 波特率 | 9600 | 标准速率 |
| 数据位 | 8 | 固定 |
| 校验 | None | 或 Even（需双方一致） |
| 停止位 | 1 | RTU 标准 |
| DMA 通道 | USART2_RX | 循环接收模式 |
| 定时器 | TIM2 | 3.5 字符超时检测 |

<span class="orange"><strong>3. 帧间隔检测代码</strong></span><br>

```c
// STM32 Modbus RTU 帧间隔检测
// 文件：stm32_modbus_rtu.c
// 定时器配置：1 字符时间 = 10 bit / 9600 ≈ 1.04 ms

void TIM2_IRQHandler(void) {
    if (TIM2->SR & TIM_SR_UIF) {
        TIM2->SR &= ~TIM_SR_UIF;
        
        // 3.5 字符超时，帧接收完成
        if (rx_count > 0) {
            frame_ready = 1;
            frame_length = rx_count;
            rx_count = 0;
        }
    }
}

void USART2_IRQHandler(void) {
    if (USART2->SR & USART_SR_RXNE) {
        uint8_t data = USART2->DR;
        
        // 收到数据，重置定时器
        TIM2->CNT = 0;
        TIM2->CR1 |= TIM_CR1_CEN;
        
        if (rx_count < MODBUS_MAX_FRAME) {
            rx_buffer[rx_count++] = data;
        }
    }
}
```

---

## PLC 通信

---

### <strong>寄存器映射设计</strong>

<span class="badge-i">I</span><br>
<span class="red">寄存器映射</span> 是 Modbus 通信的核心契约，定义了物理量与保持寄存器地址的对应关系。
<br>

**表 4-3：典型 PLC 寄存器映射表**

| 地址 | 名称 | 数据类型 | 单位 | 读写 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 40001 | 温度设定值 | INT16 | 0.1℃ | RW | 目标温度 |
| 40002 | 温度实测值 | INT16 | 0.1℃ | RO | 传感器读数 |
| 40003 | 压力设定值 | INT16 | 0.1kPa | RW | 目标压力 |
| 40004 | 压力实测值 | INT16 | 0.1kPa | RO | 传感器读数 |
| 40005 | 运行模式 | UINT16 | — | RW | 0=停止,1=手动,2=自动 |
| 40006 | 报警状态 | UINT16 | — | RO | 每 bit 对应一种报警 |
| 40007~40010 | 保留 | — | — | — | 未来扩展 |

<span class="orange"><strong>4. 地址规划原则</strong></span><br>
* 连续地址：同功能组的寄存器连续排列，减少读请求次数。
<br>
* 对齐设计：32-bit 浮点数占用 2 个寄存器，起始地址偶数对齐。
<br>
* 保留空间：预留 10%~20% 地址空间用于后期扩展。
<br>

---

## 本章小结

| 小节 | 核心要点 |
| --- | --- |
| libmodbus 使用 | modbus_new_rtu/tcp → set_slave → connect → read/write → close/free |
| STM32 Modbus RTU | USART+DMA 接收，TIM 3.5 字符超时检测，帧完成标志 |
| PLC 通信 | 寄存器映射表设计，连续地址分组，对齐与预留原则 |

---

## 练习

1. **libmodbus 编程**：编写一个 libmodbus 程序，轮询 3 个 RTU 从站（地址 1~3），每站读取 40001~40010 共 10 个寄存器，间隔 1 秒，超时 500 ms。

2. **STM32 实现**：为 STM32F407 配置 USART2（PA2/PA3）作为 Modbus RTU 从站，从站地址 0x05。写出 USART 与 TIM 的初始化代码片段。

3. **寄存器映射**：为某温控系统设计寄存器映射表，包含：温度设定/实测（0.1℃）、PID 参数 Kp/Ki/Kd（放大 100 倍存 INT16）、运行状态、报警码。合理分配地址并说明读写属性。
