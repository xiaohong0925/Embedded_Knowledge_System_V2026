// SPDX-License-Identifier: GPL-2.0-or-later
/*
 * B-B.3.4 教学示例：用 I2C_RDWR 读取 AT24C02 的 4 字节。
 * 运行上下文：Linux 用户态，内核已启用 CONFIG_I2C_CHARDEV。
 * 验证状态：仅做源码核验；目标板编译、运行和硬件结果见正文说明。
 */
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

#define READ_LENGTH 4

static int parse_number(const char *text, unsigned long maximum,
			unsigned long *value)
{
	char *end;
	unsigned long parsed;

	errno = 0;
	parsed = strtoul(text, &end, 0);
	if (errno || end == text || *end != '\0' || parsed > maximum)
		return -1;
	*value = parsed;
	return 0;
}

int main(int argc, char **argv)
{
	unsigned long bus, address, offset;
	unsigned long funcs;
	unsigned char write_buf[1];
	unsigned char read_buf[READ_LENGTH] = { 0 };
	struct i2c_msg msgs[2];
	struct i2c_rdwr_ioctl_data rdwr;
	char device_path[32];
	int fd = -1;
	int ret;
	int status = EXIT_FAILURE;
	int i;

	if (argc != 4) {
		fprintf(stderr, "用法：%s <总线号> <7位地址> <单字节偏移>\n", argv[0]);
		fprintf(stderr, "示例：%s 1 0x50 0x10\n", argv[0]);
		return EXIT_FAILURE;
	}
	if (parse_number(argv[1], INT_MAX, &bus) ||
	    parse_number(argv[2], 0x77, &address) || address < 0x08 ||
	    parse_number(argv[3], 0xff, &offset)) {
		fprintf(stderr, "参数无效：总线须非负，地址须在 0x08..0x77，偏移须在 0x00..0xff\n");
		return EXIT_FAILURE;
	}

	ret = snprintf(device_path, sizeof(device_path), "/dev/i2c-%lu", bus);
	if (ret < 0 || (size_t)ret >= sizeof(device_path)) {
		fprintf(stderr, "设备路径过长\n");
		return EXIT_FAILURE;
	}

	fd = open(device_path, O_RDWR);
	if (fd < 0) {
		fprintf(stderr, "打开 %s 失败：%s\n", device_path, strerror(errno));
		goto out;
	}

	if (ioctl(fd, I2C_FUNCS, &funcs) < 0) {
		fprintf(stderr, "读取适配器能力失败：%s\n", strerror(errno));
		goto out;
	}
	if (!(funcs & I2C_FUNC_I2C)) {
		fprintf(stderr, "%s 不支持普通 I2C 消息传输\n", device_path);
		goto out;
	}

	/* 与 i2ctransfer 默认行为一致：先拒绝已由内核驱动占用的地址。 */
	if (ioctl(fd, I2C_SLAVE, address) < 0) {
		fprintf(stderr, "选择地址 0x%02lx 失败：%s\n", address,
			strerror(errno));
		goto out;
	}

	write_buf[0] = (unsigned char)offset;
	memset(msgs, 0, sizeof(msgs));
	msgs[0].addr = (__u16)address;
	msgs[0].flags = 0;                 /* 写方向：先送出存储偏移。 */
	msgs[0].len = sizeof(write_buf);
	msgs[0].buf = write_buf;
	msgs[1].addr = (__u16)address;
	msgs[1].flags = I2C_M_RD;          /* 读方向：重复 START 后读 4 字节。 */
	msgs[1].len = sizeof(read_buf);
	msgs[1].buf = read_buf;

	rdwr.msgs = msgs;
	rdwr.nmsgs = 2;
	ret = ioctl(fd, I2C_RDWR, &rdwr);
	if (ret < 0) {
		fprintf(stderr, "I2C_RDWR 失败：%s\n", strerror(errno));
		goto out;
	}
	if (ret != 2) {
		fprintf(stderr, "事务不完整：只完成 %d/2 条消息，丢弃读缓冲区\n", ret);
		goto out;
	}

	printf("offset 0x%02lx:", offset);
	for (i = 0; i < READ_LENGTH; i++)
		printf(" 0x%02x", read_buf[i]);
	putchar('\n');
	printf("ASCII: %c%c%c%c\n", read_buf[0], read_buf[1],
	       read_buf[2], read_buf[3]);
	status = EXIT_SUCCESS;

out:
	if (fd >= 0 && close(fd) < 0) {
		fprintf(stderr, "关闭 %s 失败：%s\n", device_path, strerror(errno));
		status = EXIT_FAILURE;
	}
	return status;
}
