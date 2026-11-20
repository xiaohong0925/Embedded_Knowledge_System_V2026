CC ?= cc
CFLAGS ?= -O2
WARNINGS := -Wall -Wextra -Wpedantic -Werror

.PHONY: all clean

all: rs485_xfer

rs485_xfer: rs485_xfer.c
	$(CC) $(CPPFLAGS) $(CFLAGS) $(WARNINGS) -std=c11 -o $@ $< $(LDFLAGS)

clean:
	rm -f rs485_xfer
