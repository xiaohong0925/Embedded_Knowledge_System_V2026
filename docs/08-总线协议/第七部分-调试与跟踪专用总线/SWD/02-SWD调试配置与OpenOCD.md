# SWD 调试配置与 OpenOCD [I]

> **本章学习目标**：
> - 理解 <span class="red">OpenOCD SWD 配置</span>的接口定义与命令差异
> - 掌握 CMSIS-DAP 适配器的固件特性与使用方式
> - 了解自动化调试脚本（TCL/Python）的编写方法

---

## OpenOCD SWD 配置

---

### <strong>SWD 与 JTAG 的配置差异</strong>

<span class="badge-i">I</span><br>
<span class="red">SWD（Serial Wire Debug）</span> 使用 2 线接口（SWDIO + SWCLK）替代 JTAG 的 4/5 线，OpenOCD 配置需选择 SWD 传输层。<br>

<span class="blue">SWD 如同 JTAG 的"精简版"——用一根双向数据线（SWDIO）替代了 TDI+TMS+TDO 三根线，如同把三车道并线为一条潮汐车道。</span><br>

**表 2-1：SWD vs JTAG 配置对比**

| 参数 | SWD | JTAG |
| --- | --- | --- |
| 信号线 | SWDIO + SWCLK | TDI + TDO + TMS + TCK |
| 传输层 | `transport select swd` | `transport select jtag` |
| 扫描链 | 无（直接访问 DAP） | 有（IR/DR 扫描） |
| 调试端口 | SWJ-DP | JTAG-DP |
| 速率上限 | ~50 MHz | ~20 MHz |
| 引脚复用 | 常与 JTAG 引脚共享 | 专用引脚 |

<span class="orange"><strong>1. SWD 配置示例</strong></span><br>

```tcl
# OpenOCD SWD 配置文件
# 文件：openocd_swd.cfg
# 适配器：CMSIS-DAP / ST-Link / J-Link

# 选择调试适配器
source [find interface/cmsis-dap.cfg]

# 配置为 SWD 模式
transport select swd

# 设置时钟频率
adapter speed 4000

# 目标芯片（以 STM32F4 为例）
source [find target/stm32f4x.cfg]
```

<span class="orange"><strong>2. SWD 连接验证</strong></span><br>

```bash
# 启动 OpenOCD 并验证 SWD 连接
$ openocd -f openocd_swd.cfg -c "init; halt; targets"
Open On-Chip Debugger 0.12.0
Info : CMSIS-DAP: SWD supported
Info : CMSIS-DAP: JTAG supported
Info : CMSIS-DAP: FW Version = 2.0.0
Info : SWCLK = 4000 kHz
Info : stm32f4x.cpu: hardware has 6 breakpoints, 4 watchpoints
```

---

## CMSIS-DAP

---

### <strong>CMSIS-DAP 适配器特性</strong>

<span class="badge-i">I</span><br>
<span class="red">CMSIS-DAP</span> 是 ARM 官方定义的调试适配器标准，常见于mbed板载调试器、LPC-Link2、DAP-Link等。<br>

**表 2-2：CMSIS-DAP 关键特性**

| 特性 | 说明 | 优势 |
| --- | --- | --- |
| USB HID 接口 | 免驱动，即插即用 | 跨平台兼容 |
| SWD + JTAG | 双模式支持 | 灵活切换 |
| 虚拟串口 | 内置 CDC ACM | 调试+串口二合一 |
| 拖拽烧录 | 模拟 U 盘 | 非技术人员友好 |
| 固件开源 | DAPLink 项目 | 可自定义扩展 |

<span class="orange"><strong>3. 固件升级与识别</strong></span><br>
* VID/PID：0x0D28 / 0x0204（mbed/DAP-Link 标准）。
* 固件升级通过 USB 拖拽新固件 bin 文件完成。
* Windows 下识别为 "CMSIS-DAP" 或 "mbed Serial Port"。

---

## 调试脚本

---

### <strong>TCL 自动化脚本</strong>

<span class="badge-i">I</span><br>
<span class="red">OpenOCD 脚本</span> 使用 TCL 语法，支持自动化复位、烧录、断点设置与日志记录。<br>

<span class="blue">调试脚本如同"自动驾驶程序"——设定好路线（断点列表）、速度（时钟配置）、目的地（烧录地址），一键启动全程无需人工干预。</span><br>

<span class="orange"><strong>4. 完整调试脚本示例</strong></span><br>

```tcl
# OpenOCD 自动化调试脚本
# 文件：auto_debug.tcl
# 功能：连接→复位→烧录→设置断点→运行→捕获日志

proc auto_debug {elf_file} {
    # 1. 初始化连接
    init
    reset init
    
    # 2. 烧录 ELF 文件
    flash write_image erase $elf_file
    verify_image $elf_file
    
    # 3. 设置断点
    bp main 1 hw
    bp HardFault_Handler 1 hw
    
    # 4. 配置 ITM（若支持）
    # TPIU 配置：CoreClock = 168 MHz, SWO 分频 = 4
    mmw 0xE0040304 0x00000002 0xFFFFFFFF  ; ; SWO 输出模式
    mmw 0xE0040010 0x400003F2 0xFFFFFFFF  ; ; 异步模式，波特率匹配
    
    # 5. 启动运行
    reset run
    
    # 6. 等待断点触发
    echo "Waiting for breakpoint..."
}

# 执行
auto_debug /path/to/firmware.elf
```

<span class="orange"><strong>5. Python 集成</strong></span><br>

```python
# Python 调用 OpenOCD 示例
# 使用 pyOCD 或 telnetlib

import telnetlib

class OpenOCDClient:
    def __init__(self, host='localhost', port=4444):
        self.tn = telnetlib.Telnet(host, port)
    
    def command(self, cmd):
        self.tn.write(f"{cmd}\n".encode())
        return self.tn.read_until(b"> ").decode()
    
    def halt(self):
        return self.command("halt")
    
    def read_reg(self, reg):
        resp = self.command(f"reg {reg}")
        # 解析返回值
        return int(resp.split('=')[1].split()[0], 0)

# 使用示例
ocd = OpenOCDClient()
ocd.halt()
pc = ocd.read_reg('pc')
print(f"PC = 0x{pc:08X}")
```

---

## 本章小结

| 小节 | 核心要点 |
| --- | --- |
| OpenOCD SWD 配置 | transport select swd，SWDIO+SWCLK 双线，速率上限 50 MHz |
| CMSIS-DAP | ARM 标准适配器，USB HID 免驱，SWD+JTAG 双模，虚拟串口+拖拽烧录 |
| 调试脚本 | TCL proc 自动化复位→烧录→断点→运行，Python telnetlib 远程控制 |

---

## 练习

1. **配置对比**：对比同一目标芯片（STM32F407）在 JTAG 4 线与 SWD 2 线模式下的 OpenOCD 配置差异，列出需修改的配置项。

2. **脚本编写**：编写一个 TCL 脚本，实现：连接目标 → 读取芯片 ID → 擦除 Flash → 烧录 firmware.bin → 校验 → 复位运行，并打印各阶段耗时。

3. **Python 工具**：使用 Python 编写一个 OpenOCD 内存转储工具，将 0x20000000~0x20010000 的 RAM 区域保存为 bin 文件。
