# B-D.14.5 光模块管理面：CMIS 与 SFF-8636

> 所属章节：第五部 B. 总线协议 > D. 专用网络总线
>
> 难度：[I] | 预计阅读时间：35 分钟

## 本节导读

数通设备和 PCIe 卡上的光模块、AOC/DAC 线缆，业务面跑的是几百 Gbps 的 SerDes 信号，但工程师日常打交道的是它的**管理面**：一个 400 kHz 的 I2C 从机，挂着一张几百字节的内存映射表。光模块的温度、电压、发射功率、接收功率、告警标志、固件版本，全部通过这张表读写。这张表的格式标准，老的是 SFF-8636（SFP+/QSFP+ 时代），新的是 CMIS（QSFP-DD/OSFP，400G/800G 时代）。对数通和 PCIe 卡工程师来说，这是嵌入式低速总线知识在岗位上的最直接应用——I2C 驱动（B-B.3 组）+ 这张内存映射表，就是光模块管理的全部软件基础。

本节覆盖：光模块管理面的系统位置、SFF-8636 内存映射结构、分页机制、CMIS 相对 SFF-8636 的变化（模块状态机、lane 概念、固件管理）、DOM 诊断量读取与告警阈值、DAC/AOC/光模块的管理面差异、Linux 下的访问路径（phylink/ethtool/EEPROM 驱动）、典型排障。

## 管理面的系统位置

```
 业务面（数据通路）                    管理面（控制/监控）
 ─────────────────                    ──────────────────
 SerDes 高速信号 ══ 光模块 ══ 光纤      I2C（400 kHz）── 模块 EEPROM/MCU
                                            │
                                     SoC 的 I2C 控制器
                                     Linux：i2c-dev / phylink / ethtool
```

管理面是独立于业务面的一条 I2C 总线，地址固定 0x50（部分功能在 0x51）。模块内部有一枚小 MCU，负责采集 ADC（温度/电压/光功率）、维护告警逻辑、跑固件；I2C 表就是这颗 MCU 的寄存器窗口。业务面链路断了，管理面通常还活着——所以"模块认不认、光功率多少"这类问题，第一步永远是读管理面，而不是看 SerDes。

## SFF-8636：QSFP+ 时代的内存映射

SFF-8636 定义的 I2C 内存映射分两个区域：

```
 地址 0x50，256 字节基本页 + 分页扩展区

 Lower Page（0x00~0x7F，无需选页，直接读）：
   0x00~0x02   模块标识与类型（SFP/QSFP+/…）
   0x22~0x29   温度、电压（2 字节定点数）
   0x34~0x41   每通道 RX/TX 光功率
   0x03~0x21   告警与状态标志位

 Upper Page（0x80~0xFF，按"页"切换）：
   Page 00h    厂商信息：厂商名、型号、序列号、日期码、波长
   Page 01h    扩展标识与选项
   Page 02h    用户可写 EEPROM / 部分厂商密码区
   Page 03h    告警阈值上下限（与 Lower Page 的实测值比较）
   Page 20h/21h 厂商自定义
```

分页机制：Lower Page 固定可见；Upper Page 先往 0x7F 写字节选页，再读 0x80~0xFF。忘记选页直接读 Upper 区，读到的是上一次选中的页——管理面读数"对不上手册"的第一嫌疑。

DOM（Digital Optical Monitoring，数字光监控）值是定点多字节格式：温度是 1/256 °C 分辨率的 16 位有符号数，电压单位 100 µV，光功率单位 0.1 µW。dBm 换算：`dBm = 10·log10(mW)`，告警判定用 Page 03h 的阈值与实测值比较。这些换算与阈值比较，ethtool 已经替你做完了：

```bash
ethtool -m eth0
# 输出：模块类型、厂商、序列号、温度、电压、每 lane 收/发光功率（dBm）、告警标志
```

## CMIS：QSFP-DD / OSFP 时代

400G/800G 模块引入了 lane 组（8×50G → 8×100G）、可插拔固件、功耗分级、模块状态机，SFF-8636 的表结构装不下这些概念，CMIS（Common Management Interface Specification，QSFP-DD/OSFP MSA 制定）取而代之：

| 维度 | SFF-8636 | CMIS 5.x |
|:---|:---|:---|
| 模块形态 | SFP+/QSFP+/QSFP28 | QSFP-DD / OSFP / QSFP112 |
| 分页 | 扁平页表 | Bank+Page 二维寻址（页内再分 Bank） |
| 状态机 | 无显式定义 | 模块状态机（LowPwr → HighPwr 等），上电默认低功耗，主机显式切换 |
| Lane 管理 | 简单通道开关 | 按 lane 组的映射、速率协商、数据路径状态机 |
| 固件 | 不可升级/厂商私有 | 标准化固件升级流程（CDB 命令区） |
| 诊断 | 基础 DOM | 增强 DOM、每 lane 详细告警、性能监控计数器 |

两个对工程师最有实际影响的差异：

1. **上电默认 LowPwr**：CMIS 模块插上是低功耗状态，业务面不工作，主机必须通过管理面写控制位把模块切到 HighPwr——"模块插了、温度能读、链路就是不起来"，先查模块状态。
2. **Bank+Page 二维寻址**：读表先选 Bank 再选 Page，读错 Bank 得到的是另一组 lane 的数据。写脚本解析 CMIS  dump 时，把 Bank/Page 选择当成每次读操作的前置动作。

DAC/AOC 与光模块的管理面差异：无源 DAC 没有光功率，DOM 区域只报温度电压（甚至只报 EEPROM 信息）；AOC 是有源光缆，管理面等同光模块。ethtool 输出里 `Module type` 字段能区分这三类。

## Linux 访问路径

| 路径 | 适用 | 用法 |
|:---|:---|:---|
| `ethtool -m` | 网卡挂光模块 | 最常用，内核 phylink/sfp 框架读好并解析 |
| 内核 SFP 框架 | 设备树声明 `sfp` 节点 | SoC MAC + 可插拔模块的嵌入式板卡 |
| i2c-dev 直接读 | 自研板卡、PCIe 卡上的模块笼 | `i2ctransfer` 或自写脚本按 SFF-8636/CMIS 解析 |
| EEPROM 驱动 | 只读标识信息 | `at24` 类驱动把 0x50 挂成 eeprom sysfs |

自研 PCIe 卡上常见的拓扑：BMC 或主控的 I2C 挂 4~8 个模块笼（cage），每个笼还有复位脚（ModSelL/LPMode 等 GPIO 控制）。管理面软件 = I2C 读写 + GPIO 时序（LPMode 拉高是低功耗，上电时序里要先释放）+ 解析表。卡片热插拔检测（ModPrsL 引脚中断）后重新读表刷新 DOM，是带外管理软件的标准动作。

```bash
# i2c-dev 直读 QSFP-DD 的温度（Bank 0 / Lower Page 0x16~0x17，以 CMIS 5.x 为准）
i2ctransfer -y 3 w2@0x50 0x7f 0x00 r32@0x50   # 选页 0 后读 Lower 区前 32 字节
```

## 排障：管理面故障

| 症状 | 优先怀疑 | 验证方法 |
|:---|:---|:---|
| i2cdetect 看不到 0x50 | ModSelL 未拉低、模块未插到底、I2C 总线被模块拉死 | 量 ModSelL/LPMode 电平；换笼位交叉 |
| 读到全 0xFF/0x00 | 选页错、模块 MCU 未就绪（上电时序太早读） | 上电后延时 ≥2 s 再读；显式写页寄存器 |
| DOM 数值离谱 | 解析公式错（定点格式）或读了错的 Bank | 与 ethtool 输出交叉验证 |
| 模块温度可读但链路不起 | CMIS 模块停在 LowPwr | 读模块状态字段；写控制位切 HighPwr |
| 光功率 -inf | 激光器未使能（Tx Disable）或对端无光 | 查 Tx Disable 控制位与对端发光 |
| 收光功率低告警 | 对端发光弱、光纤脏、弯折 | 对端 ethtool -m 看发光功率；清洁端面 |

## 本节自查

读完本节，你应能独立完成以下动作：

- 说出管理面与业务面的关系，以及"链路断了先读管理面"的原因
- 画出 SFF-8636 的 Lower/Upper Page 结构与分页操作顺序
- 用 ethtool -m 读取并解读 DOM 五项（温度/电压/收发光功率/告警）
- 说出 CMIS 相对 SFF-8636 的三个关键变化，解释 LowPwr 默认状态的影响
- 在自研板卡上用 i2c-dev 读指定页的温度字段
- 区分 DAC/AOC/光模块在管理面上的差异

## 参考资料

- SFF-8636 — SFP+/QSFP+ 管理接口规范
- CMIS 5.x（QSFP-DD/OSFP MSA）— qsfp-dd.com / oiforum
- Linux 内核：`Documentation/networking/sfp-bus.rst`、drivers/net/phy/sfp.c、ethtool 源码
- INF-8074（SFP）、SFF-8472（SFP DOM 原始规范）
