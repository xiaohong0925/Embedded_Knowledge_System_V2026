# D. 专用网络总线

> 行业分化总线：PCIe/CXL、CAN/CANopen、EtherCAT/工业以太网、I2S 音频、车载与新型总线

## 板块定位

出了这块板卡，总线开始按行业分化：服务器插 PCIe、机器人跑 CAN 和 EtherCAT、汽车用 CAN/LIN/车载以太网、声卡走 I2S。本板块是 B 扩展中**岗位决定内容**的部分——不要全读，按下表对号入座。

PCIe 提至第一组是刻意的：它是高速互连的事实标准，PCIe 的枚举-配置-BAR-DMA 模型向上长出了 CXL，向下影响了几乎所有板级高速设计；先读它也符合"先通用后专用"的顺序。

## 组内结构

| 组 | 篇目 | 面向行业 |
|----|------|----------|
| D.10 PCIe | [10.1 基础与物理层](B-D.10.1_PCIe基础与物理层.md) · [10.2 枚举与配置空间](B-D.10.2_PCIe枚举与配置空间.md) · [10.3 Linux驱动与DMA](B-D.10.3_PCIe Linux驱动与DMA.md) · [10.4 进阶 Gen4/5/6 与 AER](B-D.10.4_PCIe进阶Gen456信号完整性与AER.md) · [10.5 CXL 生态](B-D.10.5_CXL与PCIe生态扩展.md) · [10.6 实战 EP 卡 BAR/DMA](B-D.10.6_实战PCIe_EP卡BAR访问与DMA驱动开发.md) | 服务器、加速卡、仪器仪表 |
| D.11 CAN | [11.1 CAN FD物理层](B-D.11.1_CAN FD物理层与帧格式.md) · [11.2 协议层与错误处理](B-D.11.2_CAN FD协议层与错误处理.md) · [11.3 Linux驱动与SocketCAN](B-D.11.3_CAN FD Linux驱动与SocketCAN.md) · [11.4 CANopen对象字典与NMT](B-D.11.4_CANopen协议对象字典与NMT.md) · [11.5 PDO/SDO与Linux驱动](B-D.11.5_CANopen_PDO_SDO与Linux驱动.md) · [11.6 实战双板收发+伺服控制](B-D.11.6_实战SocketCAN双板收发与CANopen伺服控制.md) | 机器人、汽车、工业控制 |
| D.12 工业以太网 | [12.1 版图总览 EtherCAT/PROFINET/EtherNet-IP](B-D.12.1_工业以太网总览EtherCAT_PROFINET_EtherNet-IP版图.md) · [12.2 EtherCAT协议](B-D.12.2_EtherCAT协议深度解析.md) · [12.3 分布式时钟与驱动](B-D.12.3_EtherCAT分布式时钟与Linux驱动.md) · [12.4 PROFINET与OPC UA](B-D.12.4_PROFINET与OPC_UA.md) · [12.5 实战 IgH 主站+伺服](B-D.12.5_实战IgH_EtherCAT主站搭建与CSP伺服控制.md) | 机器人、工厂自动化 |
| D.13 音频 | [13.1 I2S与PCM物理层](B-D.13.1_I2S与PCM物理层.md) · [13.2 Linux驱动与ASoC](B-D.13.2_I2S Linux驱动与ALSA.md) · [13.3 SPDIF与选型](B-D.13.3_SPDIF与音频接口选型.md) · [13.4 实战 codec 声卡注册](B-D.13.4_实战I2S_Codec声卡注册与放音录音.md) | 多媒体、座舱 |
| D.14 车载与新型 | [14.1 车载以太网与 TSN](B-D.14.1_车载以太网与TSN.md) · [14.2 LIN](B-D.14.2_LIN总线车载低成本子网.md) · [14.3 CAN XL 与功能安全 FSoE](B-D.14.3_CAN XL与功能安全FSoE.md) · [14.4 车载 SerDes 五标准](B-D.14.4_车载SerDes五标准.md) · [14.5 光模块管理面 CMIS/SFF-8636](B-D.14.5_光模块管理面CMIS与SFF-8636.md) | 汽车电子、数通 |

## 先修与后续

- **先修**：B 板块（B.5.3 的差分与寄存器模型是 CAN/Modbus 台阶）；C.7.2 的枚举模型先修于 D.10.2。
- **后续**：D.11+D.12 是 E.15 机器人整机实战的素材；D.14.3 CAN XL 与 D.14.1 TSN 是"CAN 与以太网合流"趋势的两端。

## 一个反复用到的知识点

**CANopen 的应用层（对象字典、PDO/SDO、CiA 402 伺服行规）在 CAN 和 EtherCAT 两个世界通用**——EtherCAT 的 CoE 协议直接复用它。所以 D.11.4~11.5 读一遍，D.12 的伺服控制内容就只剩"帧怎么跑"的新东西。

## 选读建议

| 你的产品/岗位 | 必读组 | 可缓读组 |
|---------------|--------|----------|
| PCIe 卡 / 服务器 / 数通 | D.10 全部（含规划中的进阶与实战）、D.14.5 | D.11~D.13 |
| 机器人（关节/运动控制） | D.11 全部、D.12.1~12.3 + 12.5、D.14.1/14.4 概读 | D.10、D.13 |
| 汽车电子 | D.11、D.14 全部 | D.10、D.12 |
| 音频/座舱多媒体 | D.13 全部、D.14.1/14.4 | D.10~D.12 |
| 工厂自动化（PLC/产线） | D.11、D.12 全部 | D.10、D.13、D.14 |

## 内容边界

SocketCAN、ALSA、PCIe 子系统的框架细节只讲到"够用调通"；完整的驱动开发范式（字符设备、DMA、中断）在 D 扩展；功能安全（FSoE）等认证体系在 C 扩展对应专题。
