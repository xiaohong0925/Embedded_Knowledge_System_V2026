#include "nmea_stream.h"

#include <string.h>

struct field {
    const char *data;
    size_t length;
};

static void emit_event(enum nmea_event_type type,
                       nmea_event_callback callback, void *context)
{
    struct nmea_event event;

    memset(&event, 0, sizeof(event));
    event.type = type;
    callback(&event, context);
}

static int hex_value(char c)
{
    if (c >= '0' && c <= '9')
        return c - '0';
    if (c >= 'A' && c <= 'F')
        return c - 'A' + 10;
    if (c >= 'a' && c <= 'f')
        return c - 'a' + 10;
    return -1;
}

static size_t split_fields(char *body, size_t body_length,
                           struct field *fields, size_t capacity)
{
    size_t count = 0;
    size_t start = 0;
    size_t i;

    for (i = 0; i <= body_length; ++i) {
        if (i != body_length && body[i] != ',')
            continue;
        if (count == capacity)
            return 0;
        fields[count].data = body + start;
        fields[count].length = i - start;
        ++count;
        start = i + 1;
    }
    return count;
}

static int parse_unsigned(const struct field *field, unsigned int *value)
{
    unsigned int result = 0;
    size_t i;

    if (field->length == 0)
        return -1;
    for (i = 0; i < field->length; ++i) {
        unsigned int digit;

        if (field->data[i] < '0' || field->data[i] > '9')
            return -1;
        digit = (unsigned int)(field->data[i] - '0');
        if (result > (1000000u - digit) / 10u)
            return -1;
        result = result * 10u + digit;
    }
    *value = result;
    return 0;
}

static int parse_coordinate(const struct field *number,
                            const struct field *hemisphere,
                            size_t degree_digits, unsigned int max_degrees,
                            char north_or_east, char south_or_west,
                            double *result)
{
    unsigned int degrees = 0;
    double minutes = 0.0;
    double place = 0.1;
    size_t i;
    int sign;

    if (number->length < degree_digits + 2u || hemisphere->length != 1u)
        return -1;
    for (i = 0; i < degree_digits; ++i) {
        if (number->data[i] < '0' || number->data[i] > '9')
            return -1;
        degrees = degrees * 10u + (unsigned int)(number->data[i] - '0');
    }
    for (i = degree_digits; i < degree_digits + 2u; ++i) {
        if (number->data[i] < '0' || number->data[i] > '9')
            return -1;
        minutes = minutes * 10.0 + (double)(number->data[i] - '0');
    }
    i = degree_digits + 2u;
    if (i < number->length) {
        if (number->data[i] != '.' || i + 1u == number->length)
            return -1;
        for (++i; i < number->length; ++i) {
            if (number->data[i] < '0' || number->data[i] > '9')
                return -1;
            minutes += (double)(number->data[i] - '0') * place;
            place *= 0.1;
        }
    }
    if (degrees > max_degrees || minutes >= 60.0 ||
        (degrees == max_degrees && minutes > 0.0))
        return -1;

    if (hemisphere->data[0] == north_or_east)
        sign = 1;
    else if (hemisphere->data[0] == south_or_west)
        sign = -1;
    else
        return -1;

    *result = sign * ((double)degrees + minutes / 60.0);
    return 0;
}

static void parse_gga(char *sentence, size_t star_offset,
                      nmea_event_callback callback, void *context)
{
    struct nmea_event event;
    struct field fields[15];
    size_t body_length = star_offset - 1u;
    size_t count;

    memset(&event, 0, sizeof(event));
    if (body_length < 5u || memcmp(sentence + 1, "GPGGA", 5u) != 0) {
        emit_event(NMEA_EVENT_IGNORED, callback, context);
        return;
    }
    count = split_fields(sentence + 1, body_length, fields, 15);
    if (count < 8u || fields[0].length != 5u) {
        emit_event(NMEA_EVENT_MALFORMED, callback, context);
        return;
    }
    if (parse_unsigned(&fields[6], &event.position.quality) != 0 ||
        parse_unsigned(&fields[7], &event.position.satellites) != 0) {
        emit_event(NMEA_EVENT_MALFORMED, callback, context);
        return;
    }

    event.type = NMEA_EVENT_NO_FIX;
    if (event.position.quality == 0u) {
        callback(&event, context);
        return;
    }
    if (event.position.quality != 1u && event.position.quality != 2u) {
        event.type = NMEA_EVENT_UNSUPPORTED_FIX;
        callback(&event, context);
        return;
    }
    if (parse_coordinate(&fields[2], &fields[3], 2u, 90u, 'N', 'S',
                         &event.position.latitude) != 0 ||
        parse_coordinate(&fields[4], &fields[5], 3u, 180u, 'E', 'W',
                         &event.position.longitude) != 0) {
        emit_event(NMEA_EVENT_MALFORMED, callback, context);
        return;
    }
    event.type = NMEA_EVENT_POSITION;
    callback(&event, context);
}

static void finish_sentence(struct nmea_stream *stream,
                            nmea_event_callback callback, void *context)
{
    char *star;
    size_t star_offset;
    size_t checksum_offset;
    size_t i;
    int high;
    int low;
    unsigned char expected;
    unsigned char actual = 0;

    if (stream->length < 6u ||
        stream->sentence[stream->length - 2u] != '\r') {
        emit_event(NMEA_EVENT_MALFORMED, callback, context);
        return;
    }
    star = memchr(stream->sentence + 1, '*', stream->length - 3u);
    if (star == NULL) {
        emit_event(NMEA_EVENT_MALFORMED, callback, context);
        return;
    }
    star_offset = (size_t)(star - stream->sentence);
    checksum_offset = star_offset + 1u;
    if (star_offset == 1u || stream->length - 2u - checksum_offset != 2u ||
        memchr(star + 1, '*', stream->length - 2u - checksum_offset) != NULL) {
        emit_event(NMEA_EVENT_MALFORMED, callback, context);
        return;
    }
    high = hex_value(stream->sentence[checksum_offset]);
    low = hex_value(stream->sentence[checksum_offset + 1u]);
    if (high < 0 || low < 0) {
        emit_event(NMEA_EVENT_MALFORMED, callback, context);
        return;
    }
    for (i = 1; i < star_offset; ++i) {
        unsigned char c = (unsigned char)stream->sentence[i];

        if (c < 0x20u || c > 0x7eu) {
            emit_event(NMEA_EVENT_MALFORMED, callback, context);
            return;
        }
        actual ^= c;
    }
    expected = (unsigned char)((high << 4) | low);
    if (actual != expected) {
        emit_event(NMEA_EVENT_BAD_CHECKSUM, callback, context);
        return;
    }
    *star = '\0';
    parse_gga(stream->sentence, star_offset, callback, context);
}

void nmea_stream_init(struct nmea_stream *stream)
{
    memset(stream, 0, sizeof(*stream));
}

void nmea_stream_feed(struct nmea_stream *stream, const void *data,
                      size_t length, nmea_event_callback callback,
                      void *context)
{
    const unsigned char *bytes = data;
    size_t i;

    for (i = 0; i < length; ++i) {
        unsigned char c = bytes[i];

        if (c == '$') {
            stream->sentence[0] = '$';
            stream->length = 1u;
            stream->in_sentence = 1;
            stream->discarding = 0;
            continue;
        }
        if (!stream->in_sentence)
            continue;
        if (c == '\n') {
            if (stream->discarding) {
                emit_event(NMEA_EVENT_TOO_LONG, callback, context);
            } else {
                stream->sentence[stream->length++] = '\n';
                stream->sentence[stream->length] = '\0';
                finish_sentence(stream, callback, context);
            }
            stream->length = 0;
            stream->in_sentence = 0;
            stream->discarding = 0;
            continue;
        }
        if (stream->discarding)
            continue;
        if (stream->length >= NMEA_SENTENCE_MAX - 1u) {
            stream->discarding = 1;
            stream->length = 0;
            continue;
        }
        stream->sentence[stream->length++] = (char)c;
    }
}
