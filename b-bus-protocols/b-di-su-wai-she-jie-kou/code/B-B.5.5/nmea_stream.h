#ifndef NMEA_STREAM_H
#define NMEA_STREAM_H

#include <stddef.h>

#define NMEA_SENTENCE_MAX 82u
#define NMEA_STORAGE_SIZE (NMEA_SENTENCE_MAX + 1u)

enum nmea_event_type {
    NMEA_EVENT_POSITION,
    NMEA_EVENT_NO_FIX,
    NMEA_EVENT_UNSUPPORTED_FIX,
    NMEA_EVENT_IGNORED,
    NMEA_EVENT_BAD_CHECKSUM,
    NMEA_EVENT_MALFORMED,
    NMEA_EVENT_TOO_LONG
};

struct nmea_position {
    double latitude;
    double longitude;
    unsigned int quality;
    unsigned int satellites;
};

struct nmea_event {
    enum nmea_event_type type;
    struct nmea_position position;
};

struct nmea_stream {
    char sentence[NMEA_STORAGE_SIZE];
    size_t length;
    int in_sentence;
    int discarding;
};

typedef void (*nmea_event_callback)(const struct nmea_event *event,
                                    void *context);

void nmea_stream_init(struct nmea_stream *stream);
void nmea_stream_feed(struct nmea_stream *stream, const void *data,
                      size_t length, nmea_event_callback callback,
                      void *context);

#endif
