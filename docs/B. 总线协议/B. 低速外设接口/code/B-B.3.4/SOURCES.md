# B-B.3.4 源码与图片来源

本目录中的 `i2c-rdwr-read.c`、`trace-i2c-read.sh` 和 `Makefile` 是本篇教学文件，不是 Linux 内核或 i2c-tools 原文件。

`linux-v6.6/` 与 `i2c-tools-v4.4/` 保存正文和交互实验室引用的逐字源码快照：

- Linux v6.6：`drivers/i2c/i2c-dev.c`、`drivers/i2c/i2c-core-base.c`、`include/trace/events/i2c.h`、`include/uapi/linux/i2c.h`、`include/uapi/linux/i2c-dev.h`。来源为 torvalds/linux 的 v6.6 标签；本地长期核验副本位于 `help-docs/kernel-src-v6.6/`。
- i2c-tools v4.4：官方仓库 `https://git.kernel.org/pub/scm/utils/i2c-tools/i2c-tools.git`，标签 `v4.4`，提交 `c20cd0b4be78e7b84104452b7fc9c570f00f92bf`；工作副本位于 `help-docs/i2c-tools-v4.4/`。
- Saleae 解码图：`https://www.saleae.com/support-assets/Screen%20Shot%202021-08-30%20at%205.59.27%20PM.png`，来自 Saleae《I2C Analyzer - User Guide》。图中事务是官方示例，不是本篇 AT24C02 实测。
- Analog Devices 边沿图：`36748.png`，来自《I2C Timing: Definition and Specification Guide (Part 2)》Figure 2。图用于说明 30%/70% 测量口径，不是本篇实测波形。

源码和官方图片分别保留其原有权利与许可说明；这里仅作为带明确出处的教学核验材料。静态文件存在、文本提取或文档构建成功均不证明目标代码已编译、运行或上板。
