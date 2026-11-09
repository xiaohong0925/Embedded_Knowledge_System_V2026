# B-B.3.6 源码与验证边界

本目录只服务 B-B.3.6《SMBus 与 PMBus》。代码快照用于让读者从步骤片段跳回完整定义，不表示这些源码已在本环境编译、运行或部署。

## 原创教学文件

- `pmbus_vout_demo.c`：Linux v6.6 外部模块示例。每次加载通过 `mode=0` 或 `mode=1` 选择 SMBus／raw I2C 一条路径，完成 TPS40422 第二路 PAGE、VOUT_MODE、READ_VOUT、页恢复与解码。仅静态审阅，未编译、未运行、未上板。
- `rk3568-tps40422.dts`：板级 DTS 片段，不是完整板级 DTS，不能独立编译成可用 DTB。`i2c2` 和地址 `0x30` 必须按实际硬件替换或确认。未编译、未部署。
- `Makefile`：外部模块构建入口示例，未执行。需要匹配目标板的内核源码树、配置、工具链和头文件。

教学模块只比较不带 PEC 的事务。probe 在受控读取期间暂时清除 client 的 `I2C_CLIENT_PEC`，读取结束恢复原标志；这不表示模块实现了 PEC。

## Linux v6.6 快照

快照来自 Linux 官方仓库 `https://github.com/torvalds/linux` 的 `v6.6` 标签，按原始相对路径保存：

- `drivers/i2c/i2c-core-smbus.c`：SMBus 辅助函数、原生／模拟执行、消息组织、返回值和低高字节组合。
- `drivers/hwmon/pmbus/tps40422.c`：TPS40422 的页数、数据格式和命令能力声明。
- `drivers/hwmon/pmbus/pmbus_core.c`：`pmbus_data`、`pmbus_sensor`、属性命名、VOUT_MODE 识别、PAGE 缓存、锁、读取、解码、sysfs 输出与错误传播。

这些是阅读快照，不是一套可独立构建的内核源码树。实验室通过 HTTP 直接读取文件并提取完整函数，避免手工维护另一份代码副本。

## 器件手册

- Texas Instruments，《TPS40422 Dual-Output PMBus DC/DC Controller》，SLUSAQ4G，2011 年 10 月发布、2022 年 9 月修订，Rev. G。
- 本地长期核验副本：`help-docs/device-datasheets/tps40422.pdf`（位于工作区，不在本代码目录重复存放）。
- 本例核验范围：PDF 第 27 页地址引脚和电阻表；第 29～31 页 PAGE、VOUT_MODE、READ_VOUT；第 34 页线性模式与指数；第 46 页 READ_VOUT 采样点。
- `0x30 = 060₈` 对应 ADDR1 数字 6、ADDR0 数字 0，手册表 8-3 的示例电阻分别为 127 kΩ、11 kΩ。实际板卡仍须依据原理图和贴片确认。
- 手册 READ_VOUT 段落出现 `two's complement binary` 表述，Linux v6.6 输出电压分支使用 `(u16)sensor->data`。正文只推演共同支持的正数样本 `0x0300`，不据此声称负值或异常编码行为已经验证。

## 页面模型

`pmbus-lab.html`、`pmbus-lab.css`、`pmbus-lab.js` 是源码状态模型，不是 TPS40422 硬件仿真。raw、原生／模拟 SMBus、PAGE 交错、解码、正式驱动与失败场景均使用确定性数据推演对象和返回值，不证明控制器波形、真实 ACK、器件遥测或仪器读数已经验证。

浏览器测试只检查 DOM 交互、源码加载、场景切换和布局。MkDocs 严格构建只检查站点文档与资源链接，不等于教学模块、DTS、内核驱动或硬件功能验证。
