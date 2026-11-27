CC ?= cc
CPPFLAGS ?=
CFLAGS ?= -O2
WARNINGS = -Wall -Wextra -Werror -pedantic
STANDARD = -std=c11
APP = neo6m_nmea
TEST = test_nmea_stream
SOURCES = nmea_stream.c
HEADERS = nmea_stream.h

.PHONY: all test clean sanitize

all: $(APP) $(TEST)

$(APP): neo6m_nmea.c $(SOURCES) $(HEADERS)
	$(CC) $(CPPFLAGS) $(CFLAGS) $(WARNINGS) $(STANDARD) -o $@ neo6m_nmea.c $(SOURCES)

$(TEST): test_nmea_stream.c $(SOURCES) $(HEADERS)
	$(CC) $(CPPFLAGS) $(CFLAGS) $(WARNINGS) $(STANDARD) -o $@ test_nmea_stream.c $(SOURCES) -lm

test: $(TEST)
	./$(TEST)

sanitize: CPPFLAGS += -fsanitize=address,undefined -fno-omit-frame-pointer
sanitize: CFLAGS = -O1 -g
sanitize: clean
	$(MAKE) test

clean:
	rm -f $(APP) $(TEST)
