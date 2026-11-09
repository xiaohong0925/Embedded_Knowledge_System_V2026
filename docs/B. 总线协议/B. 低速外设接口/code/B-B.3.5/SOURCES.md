# B-B.3.5 源码与验证边界

本目录只服务 B-B.3.5《实战：AT24C02 EEPROM 端到端读写》。代码快照用于让读者从步骤片段跳回完整定义，不表示这些源码已在本环境编译、运行或部署。

## 原创教学文件

- `at24c02c_rw.c`：固定 `/dev/i2c-1`、7 位地址 `0x50`、内部偏移 `0x10`、8 字节页和 `Hello-EEPROM` 的完整用户态示例。仅静态审阅，未编译、未运行、未上板。
- `rk3568-at24c02c.dts`：板级 DTS 片段，不是完整板级 DTS，不能单独编译成可用 DTB。未编译、未部署。
- `Makefile`：交叉编译入口示例，未执行。当前环境没有 `make`、`aarch64-linux-gnu-gcc`、`gcc`、`clang` 或 `dtc`，因此也无法进行 `make -n` 展开检查。

## Linux v6.6 快照

快照来自 Linux 官方仓库 `https://github.com/torvalds/linux` 的 `v6.6` 标签，按原始相对路径保存：

- `drivers/misc/eeprom/at24.c`：at24 对象、probe、页切分、读写与写失败重试。
- `drivers/nvmem/core.c`：NVMEM 二进制文件回调、兼容 `eeprom` 文件创建和设备管理注销。
- `drivers/base/regmap/regmap.c`：bulk write 与 raw write 的线性化回退。
- `drivers/base/regmap/regmap-i2c.c`：I2C 总线的线性写、gather write 和复合读。
- `drivers/i2c/busses/i2c-rk3x.c`：RK3x 控制器能力回调，用于核对本例不具备 `I2C_FUNC_NOSTART`。
- `drivers/misc/eeprom/Kconfig`：`EEPROM_AT24` 的依赖与选择项。
- `Documentation/devicetree/bindings/eeprom/at24.yaml`：`atmel,24c02`、`pagesize` 等属性的绑定约束。

这些是阅读快照，不是一套可独立构建的内核源码树。行号与完整函数由 `extract_fullcode.py` 从上述文件直接提取，避免手工维护页面副本。

## 器件手册

- Microchip，《AT24C01C/AT24C02C Data Sheet》，DS20006111B，© 2018–2026。
- 官方文件：`https://ww1.microchip.com/downloads/aemDocuments/documents/MPD/ProductDocuments/DataSheets/AT24C01C-AT24C02C-Data-Sheet-DS20006111.pdf`
- 本地长期核验副本：`help-docs/AT24C01C-AT24C02C-Data-Sheet-DS20006111.pdf`（位于工作区，不在本代码目录重复存放）。
- 本例使用第 15～20 页的容量与封装地址、8 字节页写、页内回卷、ACK Polling、WP 行为、随机读与顺序读规则；最大写周期 5 ms 来自特性说明。

## 页面模型

`at24-lab.html` 和 `at24-fullcode.js` 是源码状态模型，不是 EEPROM 硬件仿真。正常、失败、锁和重绑场景用于推演对象与返回值，不证明控制器波形、真实 ACK 轮询、文件写入或存储内容已经验证。浏览器测试只检查 DOM 交互、资源加载与布局。
