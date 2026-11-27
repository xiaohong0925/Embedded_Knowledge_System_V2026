# B-D.10 PCIe 节组级修订设计归档

> 归档日期：2026-11-25
> 状态：节组级修订设计已由用户明确确认；10.1 两页 T3 改造、最小导航调整、连续阅读复核和严格构建已完成，等待用户人工教学验收。
> 用途：保存用户决策、六篇结构、跨篇边界、证据缺口、当前停点和下一步，供上下文压缩或新会话接续。
> 规则地位：本文件只是 B-D.10 的任务设计与进度归档，不是新的写作规则、SOP 或验收结论。写作与验收规则只以根目录 `agent.md`、`plan.md` 为真源；冲突时以用户最新明确确认和这两份规则为准。

## 0. 新上下文接续入口

### 0.1 当前停点

- 用户已确认采用**方案 B：Gen4 RC—NVMe 主实例，B-D.10.1 拆为两个正文页**。
- B-D.10 仍保留六个逻辑小节，10.2～10.6 编号不变；10.1 拆页后是七个正文阅读页。
- 10.1 已形成两个正式正文页：
  1. `B-D.10.1_PCIe基础与物理层.md`：**拓扑与物理链路**，沿同一 Gen4 RC—NVMe 从上电走到 L0；
  2. `B-D.10.1_PCIe基础与物理层_transaction.md`：**事务与软件模型**，读取 NVMe BAR0＋`0x08` 的 VS，完成 Memory Read 和 Completion 返回。
- `mkdocs.yml`、D 板块 README 和目录 v4 已同步两页结构；`agent.md` §9.7 已记录新基线并指向本归档。
- 两页已进行独立连续阅读和依赖、主线、盲删、跟随复核。两幅内联 SVG、两处 Mermaid 和前后页链接均已进入生成 HTML；严格构建退出码为 0。
- 桌面浏览器交互为 `not_verified（待统一桌面验收）`；教学代码编译、目标运行和仪器测量为 `not_applicable`。没有真实板卡或实机 `lspci` 输出，正文已明确标注教学构造。
- 下一步是用户人工连续阅读 10.1 两页；10.2～10.6 不在未逐节诊断、未获确认时批量重写。

### 0.2 接续时最小阅读顺序

1. `agent.md`、`plan.md`：重新读取现行规则，不凭本归档复述规则。
2. 本归档：恢复已经确认的节组结构、实例、边界和当前停点。
3. `docs/B. 总线协议/D. 专用网络总线/B-D.10.1_PCIe基础与物理层.md` 与 `_transaction.md`：本次待人工阅读的两页正文。
4. 理解衔接所必需的 B-C.9.5、B-D.10.2～10.4、B-F.16.1；按当前结论需要再读 10.5、10.6、B-F.16.2／16.3。
5. 仅按事实核验需要读取 PCIe 规范、v6.6 源码、目标 SoC／板卡手册，不通读旧返工清单或旧验收结论。

### 0.3 归档前基线

- Git HEAD：`c94933dde5c7670a050c6957e8bf4ff619c8d053`
- 归档前 `agent.md` SHA-256：`14935ba66e91491c7d704bc482b361eed53c6840c2f8fc5d52dbbdc0682a306d`
- `plan.md` SHA-256：`23afae390e29a56fa4cfd9e7f70386c718cbaee7ee15e4f1d6659d6f31f1dcdd`
- 归档前 B-D.10.1 SHA-256：`352054a7164c7499ac9224e0d07863b82b579e0ed9241261bcba6632e627d5c8`

上述哈希只用于识别归档后变化，不表示教学质量或验收通过。文件后续变化时，以新内容为准重新核对。

## 1. 已确认的用户决策

1. 不再沿用“10.1 单页、只以 Gen1～Gen3 为首读基线”的旧方案。
2. 先完成 B-D.10 节组级再设计，再进入 10.1 正文重写；不重做全书或其他节组设计。
3. 采用 **Gen4 RC—NVMe** 作为基础篇主实例。Gen4 是教学锚点，不是市场占有率判断。
4. 10.1 按阅读任务拆为“拓扑与物理链路”和“事务与软件模型”两页，不按字数拆页。
5. Gen1～Gen5 的共同机制进入首读主线；Gen3 只承担 8b/10b→128b/130b 和均衡出现的演进对照。
6. Gen4/5 的详细均衡、信道预算、AER 和完整降速定位仍归 10.4；Gen6 的 PAM4、FLIT、FEC 单独处理。
7. 热插拔按物理信号、重新枚举、驱动恢复和实战分层，不笼统全部归 10.4。
8. 将本设计归档到 `reviews/`，避免上下文压缩后恢复成旧方案。

## 2. 节组设计意图

B-D.10 面向没有 PCIe 硬件背景的嵌入式 Linux 软件工程师，形成以下能力链：

```text
链路能够建立
→ 系统能够发现并分配资源
→ 驱动能够消费资源
→ 高速链路问题能够定位
→ 能理解 CXL 扩展
→ 能完成一张 EP 卡的基本通信
```

教学代次策略：

- **Gen1～Gen5 共有机制**：拓扑、Lane、事务、配置模型和基本链路训练进入首读主线。
- **Gen3**：用于解释编码跃迁和均衡出现，不强制作为当前设备主实例。
- **Gen4**：基础篇主实例，可讲正常训练和基本状态观察，不提前展开完整高速排障。
- **Gen5**：与 Gen4 对照共同机制和速率提升，不重复整套教学。
- **Gen6**：PAM4、FLIT、FEC 及行为差异归 10.4；行业阶段、合规生态和路线判断归 B-F.16.2。

实际板卡型号、Lane 数、寄存器值和 `lspci` 输出必须在写作前核验。没有真实输出时可以采用教学假设，但必须明确标注，不能称为真实输出或实测结果。

## 3. 方案比较与选择理由

| 维度 | 方案 A：单页、Gen3 基线 | 方案 B：拆两页、Gen4 主实例（已确认） |
|---|---|---|
| 阅读任务 | 物理链路和事务协议在一页交替展开 | 先完成链路建立，再完成一笔事务 |
| 主实例 | Gen3 RC—NVMe | Gen4 RC—NVMe |
| Gen4/5 | 基本留到 10.4 | 共同机制在 10.1，高速故障在 10.4 |
| 首读负担 | 在线上线缆、协议包和软件模型间切换 | 每页一种主要推演方式，实例不换 |
| 工程衔接 | 读者自行迁移 Gen3 模型 | 直接说明哪些知识适用于 Gen1～Gen5 |
| 修改范围 | 10.1 单页 T2 | 10.1 拆页 T3，另查导航、链接和阅读顺序 |

选择方案 B 的理由是阅读任务不同，而非篇幅：

1. 物理链路页沿上电、复位、训练、编码和速率走到 L0；
2. 事务页沿一笔 Memory Read 走完 TLP、DLLP、物理传输和 Completion；
3. 两页沿用同一 RC—NVMe，不牺牲“上电训练→Memory Read”的完整链条。

## 4. 已确认的六篇结构

| 编号 | 目标篇目 | 唯一主问题 | 主要交付物与边界 |
|---|---|---|---|
| B-D.10.1 | PCIe 基础与物理层，拆两个正文页 | RC 和 NVMe 怎样建立链路并完成一次 Memory Read？ | 拓扑、Lane、时钟复位、LTSSM、Gen1～Gen5 编码、三层事务、Completion、PCI 软件模型。枚举细节归 10.2，高速故障归 10.4。 |
| B-D.10.2 | PCIe 枚举与配置空间 | 系统怎样发现这张 NVMe 并分配软件资源？ | BDF、深度优先枚举、Type 0/1、配置空间、BAR、Capability、只读工具验证。驱动代码归 10.3。 |
| B-D.10.3 | PCIe Linux 驱动与 DMA | 驱动怎样消费 BAR、中断和 DMA 能力？ | 正常 probe、失败清理、BAR、DMA 掩码、MSI-X、DMA 完整生命周期。通用设备模型归主线第 11 章。 |
| B-D.10.4 | PCIe 进阶、信号完整性与 AER | Gen4/5 链路为何不稳定，怎样用证据定位？ | 均衡、信道预算、retimer、AER、降速证据链、Gen6 变革、热插拔实战。不重复 10.1 共同机制。 |
| B-D.10.5 | CXL 与 PCIe 生态扩展 | CXL 为什么复用 PCIe，又改变了什么？ | CXL.io/cache/mem、设备类型、HDM、系统地址语义、Linux 对象和岗位判断。电气问题回 10.4。 |
| B-D.10.6 | PCIe EP 卡实战 | 面对 FPGA EP 卡，怎样完成 BAR 和 DMA 正常通信？ | 正常产品路径、完整代码、构建运行、失败清理、结果验证和 QEMU 后备。 |

## 5. B-D.10.1 两页的内部设计

### 5.1 第一页：拓扑与物理链路

主问题：**RC 和 NVMe 怎样从上电走到链路可用？**

内容顺序：

1. PCIe 是什么、连接谁、用于什么，以及一条链路需要哪些基本对象；
2. 为什么从共享并行 PCI 转向点对点串行 PCIe；
3. RC、Root Port、Switch、Endpoint 和 Type 1 Bridge 的关系；
4. Lane、全双工、xN 和实际布线限制；
5. REFCLK、PERST# 与链路建立前提；
6. Detect→Polling→Configuration→L0 的正常路径；
7. Recovery、变速和重训的基本职责；
8. Gen1～Gen5 编码与理论带宽，重点比较 Gen3 和 Gen4；
9. LnkCap/LnkSta 的基本含义及证据边界；
10. PRSNT# 和热插拔的物理基础。

页末产出：同一 Gen4 RC—NVMe 已进入 L0。读者知道链路参与者、物理前提和训练结果，但尚未解释一笔读写怎样完成。

建议资产：

- 改造现有拓扑 SVG，补 Root Port，纠正 Bridge，标出主路径；
- Lane 全双工内联 SVG，表达 TX／RX 空间连接，不用 ASCII 接线图；
- 简化 LTSSM 状态图，只画经规范核对的本页状态子集；
- 图前图后均有文字推演，盲删后正文仍完整。

### 5.2 第二页：事务与软件模型

主问题：**链路已经进入 L0 后，一次 Memory Read 怎样拿到结果？**

内容顺序：

1. 明确教学前提：枚举和 BAR 分配已经完成，具体过程归 10.2；
2. CPU 对 NVMe 寄存器窗口发起一次 32 位 Memory Read；
3. RC 和事务层生成 Non-Posted Request TLP；
4. 数据链路层处理 Sequence/LCRC、ACK/NAK、Replay 和流控；
5. 物理层完成编码和传输；
6. Endpoint 处理请求并返回 Completion；
7. 回程沿同一链路返回，CPU 得到寄存器值；
8. 用 DMA Memory Write 作为明确的第二操作，对照 Posted 与 Non-Posted；
9. Completion Timeout：能确认什么、还不能归责给谁；
10. PCI 配置模型兼容与设备驱动兼容的区别；
11. 交给 10.2：寄存器窗口怎样被发现和分配。

页末产出：读者完成一次正常事务，并能区分链路错误、事务未完成、枚举配置错误和驱动错误。

建议资产：用 Mermaid 时序图展示请求与 Completion，参与者、层级和状态在正文中同步解释。普通 `lspci` 不能证明线上 TLP 细节，协议分析仪或模型图不能冒充实测。

## 6. 主实例与后续页面衔接

| 范围 | 实例策略 | 代次策略 |
|---|---|---|
| 10.1 两页 | 同一 Gen4 RC—NVMe，先 L0，再 Memory Read | Gen4 主锚点，Gen3 编码对照，Gen5 同模型简述 |
| 10.2 | 延续同一 NVMe 的枚举和资源分配 | 不引入新代次问题 |
| 10.3 | NVMe 为主，AX210 只作明确对照 | 关注驱动共性，不重复按代次讲 API |
| 10.4 | 可引入 Gen4 FPGA 采集卡故障实例 | Gen4/5 高速机制与 Gen6 变革 |
| 10.5 | CXL Type 3 内存扩展卡 | 按 CXL 与 PCIe 的真实代次关系 |
| 10.6 | FPGA EP 卡／QEMU edu | 代次只用于带宽和验证边界 |

跨篇更换实例时必须说明原因，不把 FPGA 采集卡、CXL 内存卡或 EP 卡写成前面的同一笔 NVMe 访问，也不强行统一地址、长度和性能数字。

## 7. 相邻节组与跨篇边界

- **B-C.9.5 → 10.1**：重新建立 RC、Link、Lane 等基础对象，不假设摄像头篇已经提供 PCIe 知识。
- **10.1 ↔ B-F.16.1**：10.1 给差分、符号率、编码和均衡的最小工作定义；SerDes、CDR、眼图、抖动、信道预算和均衡内部机制归 F.16.1。顺序阅读时写“详见”，不能写“已经讲过”。
- **10.4 ↔ B-F.16.2**：10.4 负责机制与排障；F.16.2 负责行业阶段、合规生态、技术路线和岗位影响。避免重复整套 Gen6 教学推演。
- **10.5 ↔ B-F.16.3**：10.5 负责 CXL 入门、系统语义和岗位判断；F.16.3 负责更深入的协议、译码器链和前沿机制。
- **10.3 ↔ 主线**：MSI 到中断控制器归第 10 章；bus-device-driver、设备树和 devm 归第 11 章；通用字符设备和子系统封装归 D 扩展。
- **10.6 → B-D.11**：PCIe 实战结束后进入 CAN FD，不新增跨总线大比较。

## 8. 热插拔分配

| 内容 | 落点 |
|---|---|
| PRSNT#、PERST#、链路消失和重新训练 | 10.1 第一页 |
| 热插拔后的重新枚举和资源处理 | 10.2 |
| 驱动 `remove()`、异常移除和错误恢复 | 10.3 |
| 受控热插拔、意外移除、日志与故障操作 | 10.4 |
| EP 卡上的实际插拔或恢复验证 | 10.6，确有需要时 |

## 9. 当前内容缺口与后续落点

以下只记录新设计必须处理的缺口，不代替后续逐节诊断，也不表示其他页面已经通过或失败。

1. **10.1**：处理主实例、Bridge、Lane 宽度、LTSSM、LnkCap/LnkSta、Memory Read、Completion 和 PCI 软件兼容问题；现有拓扑 SVG 保留并改造。
2. **10.2**：复核“无设备读回全 1”的原因，不能沿用共享并行总线的上拉电阻解释；BAR 属性位和配置空间布局逐项按规范核对。
3. **10.3**：补正常 probe、错误返回、资源清理和 DMA 完整生命周期；代码、表格步骤和验证日志指向同一设备。
4. **10.4**：清除“单字段即可定性”的排障结论，将速率、宽度、均衡、AER 和负载状态组成证据链。
5. **10.5**：将时间敏感的行业判断与稳定机制分开；操作命令补前提、输出、停止条件和恢复。
6. **10.6**：教学寄存器约定与真实硬件事实分开；补 DMA 超时后的解除映射、等待结果处理、代码构建和 QEMU／真板验证边界；`devmem` 只作受控调试手段。
7. **跨篇**：10.4 与 F.16.2、10.5 与 F.16.3 分别保持“机制／行业”“入门／深入”的分工。

## 10. 证据现状与未决事项

### 已有方向性证据

- PCI-SIG FAQ 的 Recovery.RcvrLock 资料可用于纠正“速率变化只在 Polling”的旧稿结论。
- PCI-SIG 对 Root／Switch Port 的 Type 1 Bridge 描述可用于纠正 Bridge 角色。
- PCI 软件兼容资料只支持配置与系统软件模型兼容，不支持任意旧设备驱动直接驱动新设备。
- AMD/Xilinx 调试资料说明 Completion Timeout 还需检查 BAR 和 Memory Enable，不能据此排除主机软件。
- 2026 年内核文档补丁可用于辅助说明设备能力、链路现状和空闲降速的区别；正式正文仍须回查 v6.6 实现，不能把补丁当作已合入文档。

### 正式写作前必须补齐

- PCIe Base Specification 的 Polling、Configuration、Recovery、配置空间、事务层、数据链路层和电气章节原文及位置；
- CEM 或目标形态规范的 REFCLK、PERST#、PRSNT#、热插拔和机械插入条件；
- v6.6 `drivers/pci/`、`include/uapi/linux/pci_regs.h` 及 pciutils 对应解码实现；
- 主实例实际 SoC／RC、NVMe、板级 Lane 连接和真实 `lspci` 证据；
- Gen1～Gen5 编码后理论带宽与应用载荷吞吐的口径区别。

当前没有取得完整 Base Specification 印刷页码，没有选定并核验主实例真实板卡，也没有执行协议分析仪、目标运行或仪器测量。

## 11. 已确认的实施顺序与验收范围

1. 在 `agent.md` §9.7 更新 PCIe 基线并指向本归档，防止后续会话恢复旧方案。
2. 将现有 `B-D.10.1_PCIe基础与物理层.md` 重写为“拓扑与物理链路”。
3. 新增 `B-D.10.1_PCIe基础与物理层_transaction.md` 作为“事务与软件模型”。
4. 同步调整 `mkdocs.yml`、D 板块 README 和目录 v4，不改变 10.2～10.6 编号。
5. 10.1 按 T3 检查跨页链接、导航、标题、阅读顺序、首次依赖、四种读者、图示盲删和直接资源；因新增页面和图示执行严格构建，桌面 DOM 可留待统一桌面验收。
6. 10.1 完成并经用户人工确认后，再按 10.2→10.6 逐节诊断和修改，不批量重写六篇。
7. 本轮设计归档不创建、不刷新、不运行验收 JSON；正式 T2／T3 验收时再按规则处理。

严格构建只能使用项目指定 Python：

```bash
"/c/Users/75672/AppData/Local/Python/pythoncore-3.14-64/python.exe" -m mkdocs build --strict
```

未执行的浏览器、教学代码编译、目标运行和仪器测量不得写成通过；构建成功不等于硬件功能或人工教学验收通过。

## 12. 本次实施证据与检查记录

### 12.1 主要在线证据

以下资料用于本次正文事实核对，未声称已经建立本地源码快照：

- PCI-SIG FAQ，LTSSM Recovery 与 `directed_speed_change`：`https://pcisig.com/faq?keys=LTSSM`。
- PCI-SIG Flattening Portal Bridge，Root／Switch Port 的 Type 1 Bridge Function：`https://pcisig.com/PCIExpress/ECN/Base/FlatteningPortalBridge`。
- AMD PG346 Configuration Status Interface，LTSSM 子状态、当前速率和协商宽度：`https://docs.amd.com/r/en-US/pg346-cpm-pcie/Configuration-Status-Interface`。
- AMD《Understanding Performance of PCI Express Systems》，Sequence／LCRC、可选 ECRC、Replay 和流控信用：`https://docs.amd.com/api/khub/documents/4uw~7uS2eK5x7lKbNdxWlw/content`。
- pciutils v3.10.0 `ls-caps.c`，LnkCap／LnkSta、LnkCtl／LnkCtl2 和 `downgraded` 的打印逻辑：`https://raw.githubusercontent.com/pciutils/pciutils/v3.10.0/ls-caps.c`。
- NVM Express Base Specification 2.2，`Offset 8h: VS – Version` 及 Major／Minor／Tertiary 字段：`https://nvmexpress.org/wp-content/uploads/NVM-Express-Base-Specification-Revision-2.2-2025.03.11-Ratified.pdf`。
- Microsoft PCI Express FAQ，PCI 软件模型兼容与点对点 Lane：`https://learn.microsoft.com/en-us/windows-hardware/drivers/pci/pci-express-faq-for-graphics`。
- TI AM243x PCIe EP Enumeration，100 MHz REFCLK、PERST# 和参考时钟形态：`https://software-dl.ti.com/mcu-plus-sdk/esd/AM243X/latest/exports/docs/api_guide_am243x/EXAMPLES_DRIVERS_PCIE_ENUMERATE_EP.html`。

正文把 Gen4 RC—NVMe 和 `0x00010400` 标为教学构造，未把上述资料中的其他设备行为冒充本实例实测。尚未取得完整 PCI-SIG Base Specification 的印刷页码，也没有选定并测量一块真实 Gen4 主板。

### 12.2 实际修改范围

- 重写 `docs/B. 总线协议/D. 专用网络总线/B-D.10.1_PCIe基础与物理层.md`。
- 新增 `docs/B. 总线协议/D. 专用网络总线/B-D.10.1_PCIe基础与物理层_transaction.md`。
- 修改 `mkdocs.yml`、D 板块 README、目录 v4 和 `agent.md` §9.7。
- 新增并更新本设计归档；正式验收快照为 `reviews/sections/B-D.10.1.json`。
- 根据用户对 PCIe.xlsx 的反馈，后补两项实物图和两项机制图：
  - `images/10.1-nvme-ssd.jpg`：Samsung 980 Pro，摄影 D-Kuru／Wikimedia Commons，CC BY-SA 4.0，仅作 Gen4 NVMe 实物示例；
  - `images/10.1-pcie-slots.jpg`：不同长度的 PCIe 插槽，摄影 Csendesmark，作者释放为公有领域；
  - 事务页新增 TLP／Sequence／LCRC 内联 SVG，以及 `SEQ=5` 的 NAK→重发→ACK→清除 Replay Buffer 时序图。
- 两张照片均使用已核验内容的来源页预览文件，未裁切；Wikimedia 原站下载连接被重置后没有反复请求。正文保留来源和许可链接。
- 工作簿中的配置空间、BAR 和 `lspci` 图片只登记为 10.2 候选，未挤入 10.1；原 PCIe.xlsx 未修改。
- 根据用户“物理概念难懂、标题并列且不知道为什么出现”的反馈，再次重写第一页承接：统一为“路径→宽度→训练前提→L0→带宽→状态核对→插拔重建”，每个标题说明上一步为何不足。REFCLK／PERST# 增加参考时钟与数据速率区分、PLL、PERST# 的 0／1 状态、正常上电 sequenceDiagram 和 Q6，并明确主控驱动、固件、设备树及 NVMe 驱动各自的责任边界。
- 10.2～10.6 正文未修改。

### 12.3 已执行检查

- 两页分别完整连续阅读，随后执行依赖、主线、盲删和跟随复核；未把照片、图、表、代码块或 Mermaid 作为正文论证的唯一载体。
- `git diff --check` 无内容错误，只有项目既有 LF／CRLF 提示。
- 严格构建命令：

```bash
"/c/Users/75672/AppData/Local/Python/pythoncore-3.14-64/python.exe" -m mkdocs build --strict
```

- 首轮 T3 改造严格构建退出码为 0，`Documentation built in 41.06 seconds`。
- 新增两张实物照片、TLP SVG 和 Replay 时序后，第二次严格构建退出码为 0，`Documentation built in 60.26 seconds`。
- 重写标题任务承接和 REFCLK／PERST# 上电时序后，第三次严格构建退出码为 0，`Documentation built in 36.17 seconds`。输出包含 Material 团队公告和项目既有 slug／nav INFO，未出现 MkDocs 构建 WARNING。
- 生成 HTML 已直接检查：
  - `site/b-bus-protocols/d-zhuan-yong-wang-luo-zong-xian/b-d-10-1-pcie/index.html` 含两张实物照片、两幅内联 SVG、`stateDiagram-v2`、上电 `sequenceDiagram`、PERST# 由 0 变为 1 和 Q6，以及到事务页的链接；
  - `site/b-bus-protocols/d-zhuan-yong-wang-luo-zong-xian/b-d-10-1-pcie-transaction/index.html` 含 TLP 字段 SVG、两处 `sequenceDiagram`、VS 正常返回路径、ACK 下一期望 `SEQ=6` 以及前后页链接；
  - 输出目录两张 JPG 与 docs 来源文件经 `cmp` 逐字节一致；
  - 事务页 `rel=next` 指向 B-D.10.2。
- 桌面浏览器交互未执行：`not_verified（待统一桌面验收）`。未做窄屏或全站浏览器回归。
- 本组没有教学代码、编译实验或硬件操作，教学代码编译、目标运行和仪器测量均为 `not_applicable`。

## 13. 唯一下一步

由用户人工连续阅读 10.1 的“拓扑与物理链路”和“事务与软件模型”，重点判断标题任务链是否清楚、REFCLK／PERST# 上电过程是否易懂、Gen4 主实例是否贯穿、LTSSM 与 Memory Read 是否能独立推演，以及新增实物照片、TLP 字段图和 Replay 时序是否真正降低理解成本。人工确认后再单独诊断 B-D.10.2，不提前批量改写后续篇目。


## 14. 实机 `lspci` 记录的归档与后续落点（2026-11-27）

### 14.1 原始证据

- 原始附件是用户提供的 PCIe 实机终端记录，已保存为 `reviews/evidence/B-D.10/pcie-log-2026-11-27.txt`。
- 文件 SHA-256：`11f0d2692bbd11cd5c370496cbc6b88d8ea9446f3cdade2be6158094f2a92cee`。
- 记录包含多 Domain 的 `lspci`、`lspci -tv`、设备选择命令错误与修正，以及 `0000:e3:00.0`／`0001:e3:00.0` 两个 Domain 下 SATA Endpoint 的详细输出。
- 它是软件观察证据，不是 PCIe 规范事实来源。记录中的异常能力、工具 `<?>`、链路速率和状态位均须结合平台、工具版本及规范复核，不能反向证明硬件必然如此。

### 14.2 已确认的素材分配

| 内容 | 落点 | 展示纪律 |
|---|---|---|
| 多域、Root Port、下游总线和 Endpoint 的 `lspci -tv` 小分支 | 10.1 拓扑页；10.2 枚举页 | 10.1 只取一个最小分支解释物理拓扑与软件树的对应；10.2 再讲总线号分配，不展示整棵巨型树 |
| BDF、Domain、Class Code、BAR、Capability、驱动名 | 10.2 主归属 | 按“设备是谁→资源是什么→能力怎样组织→谁在使用”逐段解释；完整单设备输出折叠回查 |
| `Kernel driver in use`、`BusMaster+`、MSI 地址与向量 | 10.3 | 只作为驱动接管证据，不把绑定或配置成功写成 DMA 已完成 |
| LnkCap／LnkSta／LnkCap2／LnkCtl2／LnkSta2、AER | 10.4 | 组成证据组；不由单一状态位直接判训练失败，不把工具 `<?>` 当作硬件故障 |
| 缺少 `-s`、省略 Domain 后同时匹配两台设备 | 10.2 工具部分 | 保留“正常命令→错误输出→修正→验证”的闭环；精确选择时使用完整 Domain:BDF，并说明 `-D` |
| EP 卡 BAR／DMA 实战 | 10.6 暂不强行使用 | 当前记录主要来自 SATA 和已有设备，不冒充自研 FPGA EP 卡结果 |

### 14.3 具体展示候选

1. **10.1 最小拓扑对照**：使用 `0000:60` 根总线、`01.2` 上游端口、`[62]` 下游总线和 `62:00.0` Endpoint 的小片段，紧跟现有拓扑 SVG。用户指出具体厂商信息应脱敏，因此公开正文改为按输出格式构造的 NVMe SSD 教学示例，不冒充实机证据；原始厂商字段只留内部证据目录。只解释软件树与物理路径的对应，不提前展开枚举算法。
2. **10.2 主设备**：优先使用 `0000:e3:00.0`。主文分段解读，完整输出折叠；`0001:e3:00.0` 只用于对照 Domain、NUMA 节点、IOMMU group、IRQ 和 BAR 地址差异。
3. **10.2 可选交互**：左侧完整输出，右侧按身份／BAR／Capability／Link／AER／Driver 分类并高亮对应行。只有实际减少字段查找成本才实现，正文必须独立成立。
4. **10.4 证据组**：将 LnkCap、LnkSta、LnkCap2、LnkCtl2、LnkSta2 与 AER 放在同一观察对象上，分别回答单端能力、当前状态、目标速率、均衡状态和错误记录；不得从 `EqualizationComplete-` 单独推出训练失败。
5. **不进入正文**：登录横幅、SSH 地址、root 提示符、整份巨型输出、无输出的 `grep -i alt`、误粘贴 shell 错误和重复完整输出。

### 14.4 当前停点

- 用户允许先补 10.1，同时正在修改文档；执行时必须读取最新正文和 Git 差异，保留其现有修改，不整文件覆盖。
- 10.1 本轮只补最小拓扑对照，不提前把 10.2 的完整配置空间讲解移入。
- 10.2～10.6 的详细素材改造均留待各自逐节诊断和确认，不因本次归档自动获得修改授权。


## 15. 用户大篇幅修改后的复核与优化（2026-11-27）

### 15.1 复核结论

没有因页长再次重写。当前两页任务仍成立，主要问题是新增内容造成的局部重复、首次依赖、跨页职责和少量过度绝对化技术结论。

### 15.2 已实施的优化

- 清除 6 处代码围栏前的 U+200B、LnkCap 核对段的行尾空格，统一当前页 `<BR>` 大写。
- 修正上电 iframe 的错误“开漏输出”标题，删除废弃注释 iframe，补齐外部图片的有效 alt。
- 删除重复的 PCI／PCIe GIF 引用，保留主题一致的 SVG；连接器部分保留自绘等比图和已登记的公有领域实拍图，移除正文对两张 PixPin 截图的引用。
- 修正“两个以上设备必须经 Switch”：Root Port 下游扩展可用 Switch，RC 也可以提供多个 Root Port 直连设备。
- 将“最高公共代际”改为共同能力上限，实际结果还受目标配置、布线和训练限制。
- 将 LnkCap／LnkSta 相等改为“当前读取值与本端能力一致”，不再直接写成“无降级”；命令使用完整 Domain:BDF，示例输出明确为教学示意。
- LTSSM 正文明确硬件执行状态机，软件可配置目标、请求重训或禁用链路，但不逐拍执行；区分 LnkSta 与厂商专用状态调试接口，删除统一“几百毫秒”说法。
- LTSSM 交互页删除固定逐档升速／退档路径和“2.5 GT/s 已经足够鲁棒”的第一嫌疑式结论，改为平台相关路径和候选检查项。
- 将第一页的完整 NVMe 读取移到第二页，明确它是第二笔复合操作；补齐 SSD 通过 DMA 读取提交队列命令、NAND 取数、Posted Memory Write 写回 4 KB、完成队列与 MSI 通知，队列和驱动实现仍归 10.3。
- PRSNT 正文收敛为检测回路、软硬件分工和平台能力边界。删除“逻辑或”“只能依赖 in-band”“避免打火”“约 100 ms 后枚举”等未核验或过度绝对化表述；同步修改 SVG 内文字。
- 10.4 热插拔实战增加 Slot Capabilities 与 Slot Status 的证据分工：能力、当前 Presence Detect State、变化事件、`pciehp` 日志和重新枚举不能互相替代。

### 15.3 本轮证据补充

- Linux 主控驱动文档明确区分 T_PVPERL=100 ms、T_PERST-CLK=100 us、LTSSM 到 L0 和首次配置访问等待，支持删除“统一 100 ms 后枚举”的写法。
- TI Cadence PCIe 驱动资料同样区分电源／参考时钟稳定与 PERST# 释放。
- NVMe 复合读取按“主机内存队列→门铃→设备 DMA 取命令→数据 DMA→完成队列→MSI”展开，不把 4 KB 写成一个必然存在的单个 TLP。
- PRSNT 引脚资料用于核对检测回路，但正文不把检测回路直接写成当前 Lane 数或所有 CEM 版本统一的机械宽度识别机制。

### 15.4 最终检查与停点

- 两页在最终修改后重新完整阅读，依赖、主线、盲删和跟随复核完成。
- `git diff --check` 无内容错误，仅有既有 LF／CRLF 提示。
- 最终严格构建实际退出码为 0，`Documentation built in 27.74 seconds`；生成 HTML 已确认代码块、完整 Domain 命令、NVMe 第二笔操作、PRSNT SVG、正确 iframe 标题和跨页链接存在。
- 两个 iframe 的实际播放、点击、重置和桌面渲染为 `not_verified（待统一桌面验收）`。
- 验收记录 `reviews/sections/B-D.10.1.json` 已绑定最终正文哈希；`current` 仅表示哈希一致，不表示人工教学通过。
- 下一步由用户人工阅读两页；确认后按第 14 节单独诊断 B-D.10.2，不自动批量修改后续篇目。
