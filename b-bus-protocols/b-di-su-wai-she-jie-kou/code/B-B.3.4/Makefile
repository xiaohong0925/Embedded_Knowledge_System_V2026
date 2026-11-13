CC ?= cc
CFLAGS ?= -O2 -g
WARNINGS := -Wall -Wextra -Wpedantic
TARGET := i2c-rdwr-read

.PHONY: all check clean

all: $(TARGET)

$(TARGET): i2c-rdwr-read.c
	$(CC) $(CFLAGS) $(WARNINGS) -std=c11 $< -o $@

check:
	$(CC) $(WARNINGS) -std=c11 -fsyntax-only i2c-rdwr-read.c

clean:
	$(RM) $(TARGET)
