// SPDX-License-Identifier: GPL-2.0
/*
 * B-B.3.6 教学模块：同一笔 TPS40422 READ_VOUT 的两种总线写法。
 * Linux v6.6 外部模块上下文；只读监测命令，不改变输出电压设定。
 * 每次加载只运行 mode 选择的一条路径，避免比较两个时刻的实时采样。
 */
#include <linux/device.h>
#include <linux/err.h>
#include <linux/i2c.h>
#include <linux/module.h>
#include <linux/moduleparam.h>
#include <linux/types.h>

#define DEMO_PAGE_CMD          0x00
#define DEMO_VOUT_MODE_CMD     0x20
#define DEMO_READ_VOUT_CMD     0x8b
#define DEMO_TARGET_PAGE       1
#define DEMO_EXPECTED_MODE     0x17

#define DEMO_MODE_SMBUS        0
#define DEMO_MODE_RAW          1

static int demo_mode = DEMO_MODE_SMBUS;
module_param_named(mode, demo_mode, int, 0444);
MODULE_PARM_DESC(mode, "0=SMBus helpers (default), 1=raw i2c_transfer");

struct demo_reading {
	u8 mode;	/* VOUT_MODE 返回的一个字节。 */
	u16 raw;	/* READ_VOUT 低、高字节组合后的原始字。 */
};

/* i2c_transfer() 返回完成的消息数，不是通常意义上的 0/1 布尔值。 */
static int demo_xfer_result(int ret, int expected)
{
	if (ret < 0)
		return ret;

	return ret == expected ? 0 : -EIO;
}

/* ---------- 路径 B：SMBus 辅助函数 ---------- */

static int demo_select_page_smbus(struct i2c_client *client, u8 page)
{
	s32 check;
	int ret;

	ret = i2c_smbus_write_byte_data(client, DEMO_PAGE_CMD, page);
	if (ret < 0)
		return ret;

	check = i2c_smbus_read_byte_data(client, DEMO_PAGE_CMD);
	if (check < 0)
		return check;

	/* 写返回 0 不代表芯片接受了页号，必须读回核对。 */
	return check == page ? 0 : -EIO;
}

static int demo_read_vout_smbus(struct i2c_client *client,
				struct demo_reading *reading)
{
	s32 old_page;
	s32 value;
	int ret;
	int restore_ret;

	/* old_page 是本次调用的独立副本；芯片 PAGE 仍是共享状态。 */
	old_page = i2c_smbus_read_byte_data(client, DEMO_PAGE_CMD);
	if (old_page < 0)
		return old_page;

	ret = demo_select_page_smbus(client, DEMO_TARGET_PAGE);
	if (ret < 0)
		goto restore_page;

	value = i2c_smbus_read_byte_data(client, DEMO_VOUT_MODE_CMD);
	if (value < 0) {
		ret = value;
		goto restore_page;
	}
	if (value != DEMO_EXPECTED_MODE) {
		ret = -EOPNOTSUPP;
		goto restore_page;
	}
	reading->mode = (u8)value;

	value = i2c_smbus_read_word_data(client, DEMO_READ_VOUT_CMD);
	if (value < 0) {
		ret = value;
		goto restore_page;
	}

	/* 非负返回值才是数据，此时才能安全缩窄为 u16。 */
	reading->raw = (u16)value;
	ret = 0;

restore_page:
	/* 恢复也读回核对；写成功但页未恢复同样算失败。 */
	restore_ret = demo_select_page_smbus(client, (u8)old_page);
	if (restore_ret < 0) {
		dev_err(&client->dev, "restore PAGE=%lld failed: %d\n",
			(long long)old_page, restore_ret);
		if (ret == 0)
			ret = restore_ret;
	}

	return ret;
}

/* ---------- 路径 A：手工构造等价 i2c_msg ---------- */

static int demo_raw_write_byte_data(struct i2c_client *client,
				    u8 command, u8 value)
{
	u8 buf[2] = { command, value };
	struct i2c_msg msg = {
		.addr = client->addr,
		.flags = client->flags,
		.len = 2,
		.buf = buf,
	};
	int ret;

	/* 一条写消息包含命令码和数据；成功时完成消息数为 1。 */
	ret = i2c_transfer(client->adapter, &msg, 1);
	return demo_xfer_result(ret, 1);
}

static int demo_raw_read_byte_data(struct i2c_client *client,
				   u8 command, u8 *value)
{
	u8 command_buf[1] = { command };
	u8 data_buf[1];
	struct i2c_msg msgs[2] = {
		{
			.addr = client->addr,
			.flags = client->flags,
			.len = 1,
			.buf = command_buf,
		}, {
			.addr = client->addr,
			.flags = client->flags | I2C_M_RD,
			.len = 1,
			.buf = data_buf,
		},
	};
	int ret;

	/* 一次调用中的两条消息由重复 START 连接，而不是先发 STOP。 */
	ret = i2c_transfer(client->adapter, msgs, 2);
	ret = demo_xfer_result(ret, 2);
	if (ret < 0)
		return ret;

	*value = data_buf[0];
	return 0;
}

static int demo_raw_read_word_data(struct i2c_client *client,
				   u8 command, u16 *value)
{
	u8 command_buf[1] = { command };
	u8 data_buf[2];
	struct i2c_msg msgs[2] = {
		{
			.addr = client->addr,
			.flags = client->flags,
			.len = 1,
			.buf = command_buf,
		}, {
			.addr = client->addr,
			.flags = client->flags | I2C_M_RD,
			.len = 2,
			.buf = data_buf,
		},
	};
	int ret;

	ret = i2c_transfer(client->adapter, msgs, 2);
	ret = demo_xfer_result(ret, 2);
	if (ret < 0)
		return ret;

	/* Word Data 低字节先上线：00 03 在这里组成 0x0300。 */
	*value = (u16)data_buf[0] | ((u16)data_buf[1] << 8);
	return 0;
}

static int demo_select_page_raw(struct i2c_client *client, u8 page)
{
	u8 check;
	int ret;

	ret = demo_raw_write_byte_data(client, DEMO_PAGE_CMD, page);
	if (ret < 0)
		return ret;

	ret = demo_raw_read_byte_data(client, DEMO_PAGE_CMD, &check);
	if (ret < 0)
		return ret;

	return check == page ? 0 : -EIO;
}

static int demo_read_vout_raw(struct i2c_client *client,
			      struct demo_reading *reading)
{
	u8 old_page;
	u8 mode;
	int ret;
	int restore_ret;

	ret = demo_raw_read_byte_data(client, DEMO_PAGE_CMD, &old_page);
	if (ret < 0)
		return ret;

	ret = demo_select_page_raw(client, DEMO_TARGET_PAGE);
	if (ret < 0)
		goto restore_page;

	ret = demo_raw_read_byte_data(client, DEMO_VOUT_MODE_CMD, &mode);
	if (ret < 0)
		goto restore_page;
	if (mode != DEMO_EXPECTED_MODE) {
		ret = -EOPNOTSUPP;
		goto restore_page;
	}
	reading->mode = mode;

	ret = demo_raw_read_word_data(client, DEMO_READ_VOUT_CMD,
				      &reading->raw);

restore_page:
	restore_ret = demo_select_page_raw(client, old_page);
	if (restore_ret < 0) {
		dev_err(&client->dev, "restore PAGE=%u failed: %d\n",
			old_page, restore_ret);
		if (ret == 0)
			ret = restore_ret;
	}

	return ret;
}

/* ---------- 两条路径共用：PMBus 输出电压解码 ---------- */

static int demo_decode_mv(const struct demo_reading *reading, s64 *millivolts)
{
	int exponent;
	s64 value;

	/* 高三位为 000 才是本例的线性输出电压格式。 */
	if ((reading->mode >> 5) != 0)
		return -EOPNOTSUPP;

	/* 低五位是五位补码指数：10111 表示 23 - 32 = -9。 */
	exponent = reading->mode & 0x1f;
	if (exponent & 0x10)
		exponent -= 0x20;

	/* 五位指数范围为 -16..15，这里的 s64 移位不会越界。 */
	value = (s64)reading->raw * 1000;
	if (exponent >= 0)
		value <<= exponent;
	else
		value >>= -exponent;

	*millivolts = value;
	return 0;
}

static int pmbus_vout_demo_probe(struct i2c_client *client)
{
	struct demo_reading reading = { 0 };
	unsigned short saved_flags;
	s64 millivolts;
	int ret;

	if (demo_mode != DEMO_MODE_RAW && demo_mode != DEMO_MODE_SMBUS)
		return -EINVAL;

	/*
	 * 本实验比较不带 PEC 的事务。正式驱动解绑后可能留下 PEC 标志，
	 * 因此在受控 probe 内暂时关闭，并在所有读取出口恢复原标志。
	 */
	saved_flags = client->flags;
	client->flags &= ~I2C_CLIENT_PEC;

	if (demo_mode == DEMO_MODE_RAW) {
		if (!i2c_check_functionality(client->adapter, I2C_FUNC_I2C))
			ret = -EOPNOTSUPP;
		else
			ret = demo_read_vout_raw(client, &reading);
	} else {
		if (!i2c_check_functionality(client->adapter,
					     I2C_FUNC_SMBUS_BYTE_DATA |
					     I2C_FUNC_SMBUS_WORD_DATA))
			ret = -EOPNOTSUPP;
		else
			ret = demo_read_vout_smbus(client, &reading);
	}

	client->flags = saved_flags;
	if (ret < 0) {
		dev_err(&client->dev, "mode=%d read failed: %d\n",
			demo_mode, ret);
		return ret;
	}

	ret = demo_decode_mv(&reading, &millivolts);
	if (ret < 0)
		return ret;

	dev_info(&client->dev,
		 "path=%s page=%d mode=0x%02x wire=%02x %02x raw=0x%04x vout=%lld mV\n",
		 demo_mode == DEMO_MODE_RAW ? "raw" : "smbus",
		 DEMO_TARGET_PAGE, reading.mode,
		 reading.raw & 0xff, reading.raw >> 8,
		 reading.raw, millivolts);
	return 0;
}

/* DTS 产生的 client 名称 "tps40422" 与此 ID 匹配。 */
static const struct i2c_device_id pmbus_vout_demo_id[] = {
	{ "tps40422", 0 },
	{ }
};
MODULE_DEVICE_TABLE(i2c, pmbus_vout_demo_id);

static struct i2c_driver pmbus_vout_demo_driver = {
	.driver = {
		.name = "pmbus_vout_demo",
	},
	.probe = pmbus_vout_demo_probe,
	.id_table = pmbus_vout_demo_id,
};

module_i2c_driver(pmbus_vout_demo_driver);

MODULE_DESCRIPTION("TPS40422 PMBus read: SMBus helpers versus raw I2C");
MODULE_LICENSE("GPL");
