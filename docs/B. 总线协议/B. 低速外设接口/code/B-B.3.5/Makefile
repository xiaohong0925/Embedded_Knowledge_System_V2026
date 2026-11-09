# Build on an AArch64 cross-development host with matching Linux UAPI headers.
# Override CROSS_COMPILE and CC for your toolchain; this Makefile was not run here.
CROSS_COMPILE ?= aarch64-linux-gnu-
CC            = $(CROSS_COMPILE)gcc
CFLAGS        ?= -std=c11 -O2 -Wall -Wextra -Werror
TARGET        := at24c02c_rw

.PHONY: all clean
all: $(TARGET)

$(TARGET): at24c02c_rw.c
	$(CC) $(CFLAGS) -o $@ $<

clean:
	$(RM) $(TARGET)
