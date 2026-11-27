CC ?= cc
PKG_CONFIG ?= pkg-config
CPPFLAGS += $(shell $(PKG_CONFIG) --cflags libmodbus 2>/dev/null)
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Wpedantic
LIBMODBUS_LIBS := $(shell $(PKG_CONFIG) --libs libmodbus 2>/dev/null)
ifeq ($(strip $(LIBMODBUS_LIBS)),)
LIBMODBUS_LIBS := -lmodbus
endif

.PHONY: all test sanitize clean

all: modbus_sensor test_modbus_sensor

modbus_sensor: modbus_sensor.o hmp110_temperature.o
	$(CC) $(LDFLAGS) -o $@ $^ $(LIBMODBUS_LIBS)

test_modbus_sensor: test_modbus_sensor.o hmp110_temperature.o
	$(CC) $(LDFLAGS) -o $@ $^ $(LIBMODBUS_LIBS) -lutil

modbus_sensor.o: modbus_sensor.c hmp110_temperature.h
	$(CC) $(CPPFLAGS) $(CFLAGS) -c -o $@ $<

hmp110_temperature.o: hmp110_temperature.c hmp110_temperature.h
	$(CC) $(CPPFLAGS) $(CFLAGS) -c -o $@ $<

test_modbus_sensor.o: test_modbus_sensor.c hmp110_temperature.h
	$(CC) $(CPPFLAGS) $(CFLAGS) -c -o $@ $<

test: test_modbus_sensor
	./test_modbus_sensor

sanitize:
	$(MAKE) clean
	$(MAKE) CFLAGS="-std=c11 -O1 -g -Wall -Wextra -Wpedantic -fno-omit-frame-pointer -fsanitize=address,undefined" test

clean:
	rm -f modbus_sensor test_modbus_sensor *.o
