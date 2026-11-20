// SPDX-License-Identifier: GPL-2.0
/*
 * Read one byte from an AT24C02 through /dev/i2c-N and I2C_RDWR.
 * Original teaching example; not a measured board-log generator.
 */
#include <errno.h>
#include <fcntl.h>
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/ioctl.h>
#include <unistd.h>

static int parse_number(const char *text, unsigned long max, unsigned long *value)
{
	char *end;

	errno = 0;
	*value = strtoul(text, &end, 0); /* 同时接受 0x50 和十进制写法 */
	if (errno || end == text || *end != '\0' || *value > max)
		return -1;
	return 0;
}

int main(int argc, char **argv)
{
	unsigned long addr, offset;
	struct i2c_msg msgs[2];
	struct i2c_rdwr_ioctl_data transaction;
	__u8 reg, value = 0;
	int fd, ret;

	if (argc != 4) {
		fprintf(stderr, "usage: %s /dev/i2c-N CHIP_ADDR REG_OFFSET\n", argv[0]);
		fprintf(stderr, "example: %s /dev/i2c-1 0x50 0x10\n", argv[0]);
		return EXIT_FAILURE;
	}
	if (parse_number(argv[2], 0x7f, &addr) ||
	    parse_number(argv[3], 0xff, &offset)) {
		fprintf(stderr, "invalid 7-bit chip address or 8-bit register offset\n");
		return EXIT_FAILURE;
	}

	reg = (__u8)offset;
	msgs[0].addr = (__u16)addr;   /* 第一条消息写内部偏移 */
	msgs[0].flags = 0;
	msgs[0].len = 1;
	msgs[0].buf = &reg;

	msgs[1].addr = (__u16)addr;   /* 第二条消息经重复 START 读取 */
	msgs[1].flags = I2C_M_RD;
	msgs[1].len = 1;
	msgs[1].buf = &value;

	transaction.msgs = msgs;
	transaction.nmsgs = 2;

	fd = open(argv[1], O_RDWR);
	if (fd < 0) {
		perror("open");
		return EXIT_FAILURE;
	}

	/*
	 * msg.addr 已指定器件地址，因此不需要先执行 I2C_SLAVE。
	 * v6.6 的 i2cdev_ioctl_rdwr() 直接返回 i2c_transfer() 的结果：
	 * 本例完整成功为 2，负值经系统调用表现为 -1 并设置 errno。
	 */
	ret = ioctl(fd, I2C_RDWR, &transaction);
	if (ret < 0) {
		perror("ioctl(I2C_RDWR)");
		close(fd);
		return EXIT_FAILURE;
	}
	if (ret != 2) {
		fprintf(stderr, "short transaction: %d/2 messages completed\n", ret);
		close(fd);
		return EXIT_FAILURE;
	}

	if (close(fd) < 0) {
		perror("close");
		return EXIT_FAILURE;
	}

	printf("bus=%s chip=0x%02lx reg=0x%02lx value=0x%02x\n",
	       argv[1], addr, offset, value);
	return EXIT_SUCCESS;
}
