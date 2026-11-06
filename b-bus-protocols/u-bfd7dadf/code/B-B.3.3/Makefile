# Kbuild 使用这一行把 demo_i2c.c 构建为 demo_i2c.ko。
obj-m += demo_i2c.o

# 以下目标只在当前目录直接执行 make 时使用，不属于 Kbuild 规则。
# 本机验证：make user
# 交叉构建：make user CC=aarch64-linux-gnu-gcc
.PHONY: user clean-user
user:
	$(CC) -Wall -Wextra -Werror -O2 -o i2c-read i2c-read.c

clean-user:
	$(RM) i2c-read
