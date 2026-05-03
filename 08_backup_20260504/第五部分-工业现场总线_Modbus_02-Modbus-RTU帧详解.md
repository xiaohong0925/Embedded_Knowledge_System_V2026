# Modbus-RTU 帧详解 [I]

> **本章学习目标**：
> - 理解 <span class="red">Modbus-RTU 帧格式</span> 的字段定义与字节序规则
> - 掌握 CRC16 校验的计算方法与实现代码
> - 了解异常响应帧的结构与错误码含义

---

## RTU 帧格式

---

### <strong>帧结构总览</strong>

<span class="badge-i">I</span><br>
<span class="red">Modbus-RTU 帧</span> 采用紧凑的二进制格式，由地址域、功能码、数据域与 CRC 校验四部分组成。<br>

<span class="blue">类比：Modbus-RTU 帧如同邮政包裹——地址域是收件人邮编，功能码是包裹类型（挂号/平邮），数据域是内件清单，CRC 是封条防伪码。</span><br>

```mermaid
flowchart LR
    A["地址\n1 byte"] --> B["功能码\n1 byte"]
    B --> C["数据\n0~252 byte"]
    C --> D["CRC\n2 byte"]
    D --> E["帧间隔\n≥3.5字符"]
```

**表 2-1：RTU 帧结构**

| 字段 | 长度 | 说明 |
| --- | --- | --- |
| 地址域 | 1 byte | 从站地址 0x01~0xF7（0x00 广播） |
| 功能码 | 1 byte | 操作类型，如 0x03 读保持寄存器 |
| 数据域 | N byte | 请求/响应数据，长度由功能码决定 |
| CRC16 | 2 byte | 低字节在前，高字节在后 |
| 帧间隔 | ≥3.5字符时间 | 标识帧边界 |

<span class="orange"><strong>1. 地址域</strong></span><br>
* 0x00：广播地址，所有从站接收但不响应。<br>
* 0x01~0xF7：单站地址，最多 247 个从站。<br>
* 0xF8~0xFF：保留。<br>

<span class="orange"><strong>2. 功能码</strong></span><br>
* 公共功能码：0x01~0x6F，标准化定义。<br>
* 用户定义功能码：0x65~0x6F 与 0x7F~0xFF。<br>

---

### <strong>常用功能码详解</strong>

<span class="badge-i">I</span><br>
<span class="red">功能码</span> 定义了主站对从站的操作类型，是 Modbus 协议的核心。<br>

**表 2-2：常用功能码列表**

| 功能码 | 名称 | 操作对象 | 数据域长度 |
| --- | --- | --- | --- |
| 0x01 | Read Coils | 线圈（离散输出） | 请求 4B，响应 N/8+1 B |
| 0x02 | Read Discrete Inputs | 离散输入 | 请求 4B，响应 N/8+1 B |
| 0x03 | Read Holding Registers | 保持寄存器 | 请求 4B，响应 2N B |
| 0x04 | Read Input Registers | 输入寄存器 | 请求 4B，响应 2N B |
| 0x05 | Write Single Coil | 单个线圈 | 请求 4B，响应 4B |
| 0x06 | Write Single Register | 单个保持寄存器 | 请求 4B，响应 4B |
| 0x0F | Write Multiple Coils | 多个线圈 | 请求 5+N/8 B |
| 0x10 | Write Multiple Registers | 多个保持寄存器 | 请求 5+2N B |

<span class="orange"><strong>3. 读保持寄存器（0x03）请求帧</strong></span><br>
* 请求：地址 + 0x03 + 起始地址（2B）+ 寄存器数量（2B）+ CRC。<br>
* 响应：地址 + 0x03 + 字节数（1B）+ 数据（2N B）+ CRC。<br>

```
示例：读取从站1，起始地址0x0000，4个寄存器
请求:  01 03 00 00 00 04 44 09
响应:  01 03 08 00 0A 00 14 00 1E 00 28 XX XX
```

---

## CRC16 计算

---

### <strong>CRC16 算法原理</strong>

<span class="badge-i">I</span><br>
<span class="red">CRC16（Modbus）</span> 采用多项式 0xA001（或等价地 0x8005 反向），初始值 0xFFFF。<br>

<span class="blue">CRC 的本质是"多项式除法求余"——将数据视为一个超大二进制数，除以固定的生成多项式，余数即为校验值。</span><br>

**表 2-3：CRC16 计算参数**

| 参数 | 值 | 说明 |
| --- | --- | --- |
| 多项式 | 0xA001 | x^16 + x^15 + x^2 + 1（反向） |
| 初始值 | 0xFFFF | 寄存器初始值 |
| 输入反向 | True | LSB first |
| 输出反向 | True | CRC 结果反向 |
| 输出异或 | 0x0000 | 最终不异或 |

---

### <strong>CRC16 实现代码</strong>

<span class="badge-i">I</span><br>

```c
// CRC16 Modbus 计算实现
// 文件：modbus_crc.c

static const uint16_t crc16_table[256] = {
    0x0000, 0xC0C1, 0xC181, 0x0140, /* ... 完整 256 项表省略 ... */
};

uint16_t modbus_crc16(const uint8_t *data, uint16_t len) {
    uint16_t crc = 0xFFFF;
    uint16_t i;
    
    for (i = 0; i < len; i++) {
        crc = (crc >> 8) ^ crc16_table[(crc ^ data[i]) & 0xFF];
    }
    return crc;  // 结果已是小端序
}

// 使用示例
uint8_t frame[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x04};
uint16_t crc = modbus_crc16(frame, 6);
// crc = 0x0944，帧尾追加 0x44, 0x09
```

<span class="orange"><strong>4. CRC 验证流程</strong></span><br>
* 发送端：计算 CRC，附加至帧尾（低字节在前）。<br>
* 接收端：重新计算整个帧（含 CRC）的 CRC，结果为 0x0000 表示正确。<br>
* 非零：丢弃帧，不发送响应（超时由主站处理）。<br>

---

## 异常响应

---

### <strong>异常帧格式</strong>

<span class="badge-i">I</span><br>
<span class="red">异常响应</span> 在功能码最高位置 1，指示请求无法执行，并携带异常码说明原因。<br>

**表 2-4：异常码定义**

| 异常码 | 名称 | 说明 |
| --- | --- | --- |
| 0x01 | Illegal Function | 不支持该功能码 |
| 0x02 | Illegal Data Address | 数据地址无效或越界 |
| 0x03 | Illegal Data Value | 数据值无效 |
| 0x04 | Slave Device Failure | 从站执行错误 |
| 0x05 | Acknowledge | 已接受，处理中（长操作） |
| 0x06 | Slave Device Busy | 从站忙，稍后重试 |
| 0x08 | Memory Parity Error | 存储器校验错误 |
| 0x0A | Gateway Path Unavailable | 网关路径不可用 |
| 0x0B | Gateway Target Device Failed | 网关目标设备无响应 |

<span class="orange"><strong>5. 异常响应示例</strong></span><br>

```
请求：  01 03 01 00 00 01 CRC   // 读取地址 0x0100（越界）
响应：  01 83 02 CRC           // 功能码 0x83 = 0x03 | 0x80，异常码 0x02
```

---

## 技术演进与发展历史

Modbus的发展历史可追溯至1979年，当时Modicon公司（现为Schneider Electric旗下）为其可编程逻辑控制器（PLC）设计了Modbus串行通信协议。Modbus的简洁性使其迅速成为工业自动化领域事实上的标准——仅需读写寄存器这一核心抽象，即可覆盖绝大多数传感器、执行器和控制器的交互需求。1990年代，Modbus TCP将协议映射到以太网层，摆脱了RS-485的物理束缚。2004年，Modbus-IDA组织成立，负责协议的维护与推广。2006年，Modbus成为GB/T标准。此后，Modbus RTU与Modbus TCP长期并存：RTU继续在成本敏感的串口设备中占据主导，TCP则在网络化、分布式系统中广泛应用。近年来，Modbus与MQTT、OPC UA等上层协议的网关转换方案日益成熟，赋予这一经典协议在工业物联网时代的持续生命力。

<br>

---

## 本章小结

| 小节 | 核心要点 |
| --- | --- |
| RTU 帧格式 | 地址+功能码+数据+CRC，帧间隔≥3.5字符时间，最多247从站 |
| CRC16 计算 | 多项式 0xA001，初始 0xFFFF，查表法实现，结果小端序 |
| 异常响应 | 功能码最高位置1，异常码0x01~0x0B指示具体错误原因 |

---



## 练习

1. **帧构造**：构造一个读取从站地址 0x05、起始地址 0x0064、10 个保持寄存器的 RTU 请求帧，并计算 CRC16。

2. **CRC 验证**：给定帧 `02 03 00 00 00 02 C4 38`，验证 CRC 是否正确。若最后一个字节被干扰变为 0x39，接收端 CRC 验证结果是什么？

3. **异常分析**：主站发送 `03 06 00 01 00 7D CRC`（写单个寄存器），从站返回 `03 86 02 CRC`。分析请求帧的问题及从站的异常原因。
