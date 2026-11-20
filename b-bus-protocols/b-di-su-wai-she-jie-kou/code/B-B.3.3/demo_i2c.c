// SPDX-License-Identifier: GPL-2.0
/*
 * Linux v6.6 I2C framework teaching module.
 *
 * This file is an original teaching example, not a Linux kernel source excerpt.
 * It has been source-reviewed against Linux v6.6, but not cross-compiled or
 * executed on an RK3568 board in the documentation environment.
 */
#include <linux/errno.h>        /* EOPNOTSUPP、EIO 等负错误码 */
#include <linux/i2c.h>          /* i2c_client、i2c_msg、i2c_driver 与传输 API */
#include <linux/module.h>       /* 模块声明、加载与卸载 */
#include <linux/of.h>           /* of_device_id 与设备树匹配表 */

#define DEMO_REG_ADDR 0x10       /* AT24C02 内部存储偏移，不是 I2C 器件地址 */

/*
 * 同步复合读取：先写内部偏移，再经重复 START 读一个字节。
 *
 * client：Core 在 probe 前创建的持久外设对象，本函数不分配它。
 * reg：AT24C02 内部偏移。
 * value：输出参数；成功时保存读回的数据。
 *
 * 返回 0 表示两条消息全部完成；负值表示失败。数据通过 value 返回。
 */
static int demo_read_reg(struct i2c_client *client, u8 reg, u8 *value)
{
	struct i2c_msg msgs[2] = {
		{
			.addr = client->addr, /* 两条消息都访问 0x50 */
			.flags = 0,           /* 未设置 I2C_M_RD：写方向 */
			.len = 1,             /* 只发送一个内部偏移字节 */
			.buf = &reg,          /* 待发送内容为 0x10 */
		},
		{
			.addr = client->addr,
			.flags = I2C_M_RD,    /* 第二条消息切换为读方向 */
			.len = 1,
			.buf = value,         /* 控制器驱动把数据写到这里 */
		},
	};
	int ret;

	/*
	 * msgs 和 reg 位于当前内核栈。i2c_transfer() 是同步调用，
	 * 返回时硬件已经不再使用这些缓冲区。
	 * 两条消息属于同一笔事务，消息之间使用重复 START，最后才 STOP。
	 */
	ret = i2c_transfer(client->adapter, msgs, 2);
	if (ret < 0)
		return ret;               /* 保留 Core 或控制器返回的负错误码 */
	if (ret != 2)
		return -EIO;              /* 短事务：没有完成两条消息 */

	return 0;
}

/*
 * 匹配成功后，Core 把已经创建的 client 交给本驱动。
 * 返回 0 允许绑定；返回负值使本次 probe 失败并执行通用回滚。
 */
static int demo_probe(struct i2c_client *client)
{
	u8 value;
	int ret;

	/* 确认适配器支持普通 I2C 消息，而不是只支持某类 SMBus 事务。 */
	if (!i2c_check_functionality(client->adapter, I2C_FUNC_I2C))
		return -EOPNOTSUPP;

	ret = demo_read_reg(client, DEMO_REG_ADDR, &value);
	if (ret) {
		dev_err(&client->dev, "read reg 0x%02x failed: %d\n",
			DEMO_REG_ADDR, ret);
		return ret;
	}

	/* dev_info() 无返回值；client->dev 提供 1-0050 这样的日志前缀。 */
	dev_info(&client->dev, "reg 0x%02x = 0x%02x, addr = 0x%02x\n",
		 DEMO_REG_ADDR, value, client->addr);
	return 0;
}

static void demo_remove(struct i2c_client *client)
{
	/* 本例没有申请私有资源；Core 负责解除绑定和管理 client 生命周期。 */
	dev_info(&client->dev, "remove demo device\n");
}

/* 本教学驱动只匹配专用测试节点，不与内核 at24 驱动争用正式设备。 */
static const struct of_device_id demo_of_match[] = {
	{ .compatible = "demo,at24c02-reader" },
	{ }                            /* 空元素表示匹配表结束 */
};
MODULE_DEVICE_TABLE(of, demo_of_match); /* 导出自动加载别名，不代替运行时匹配 */

static struct i2c_driver demo_driver = {
	.driver = {
		.name = "demo_i2c",
		.of_match_table = demo_of_match,
	},
	.probe = demo_probe,          /* Linux v6.6：probe 只接收 client 一个参数 */
	.remove = demo_remove,
};

/*
 * 展开后通过 module_driver() 注册模块入口：
 * 加载调用 i2c_add_driver()，卸载调用 i2c_del_driver()。
 */
module_i2c_driver(demo_driver);

MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("I2C combined-read teaching example");
