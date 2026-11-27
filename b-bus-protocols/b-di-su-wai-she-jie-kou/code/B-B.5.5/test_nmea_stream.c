#include "nmea_stream.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

static const char valid[] =
    "$GPGGA,092725.00,4717.11399,N,00833.91590,E,1,8,1.01,"
    "499.6,M,48.0,M,,0*5B\r\n";
static const char valid_south_west[] =
    "$GPGGA,092725.00,4717.11399,S,00833.91590,W,1,8,1.01,"
    "499.6,M,48.0,M,,0*54\r\n";
static const char ignored[] = "$GPXXX,1*52\r\n";
static const char no_fix_empty[] =
    "$GPGGA,092725.00,,,,,0,0,1.01,,M,,M,,*6D\r\n";
static const char no_fix_with_coordinates[] =
    "$GPGGA,092725.00,4717.11399,N,00833.91590,E,0,0,1.01,"
    "499.6,M,48.0,M,0*7E\r\n";
static const char fix_with_empty_coordinates[] =
    "$GPGGA,092725.00,,,,,1,8,1.01,,M,,M,,*64\r\n";
static const char bad_checksum[] =
    "$GPGGA,092725.00,4717.11399,N,00833.91590,E,1,8,1.01,"
    "499.6,M,48.0,M,,0*00\r\n";

struct capture {
    struct nmea_event events[64];
    size_t count;
};

static void capture_event(const struct nmea_event *event, void *context)
{
    struct capture *capture = context;

    if (capture->count < 64u)
        capture->events[capture->count] = *event;
    ++capture->count;
}

static void capture_init(struct capture *capture)
{
    memset(capture, 0, sizeof(*capture));
}

static void feed(struct nmea_stream *stream, struct capture *capture,
                 const void *data, size_t length)
{
    nmea_stream_feed(stream, data, length, capture_event, capture);
}

static void feed_pattern(struct nmea_stream *stream, struct capture *capture,
                         const char *data, size_t length)
{
    static const size_t pattern[] = {1, 7, 2, 31, 3, 5};
    size_t offset = 0;
    size_t step = 0;

    while (offset < length) {
        size_t count = pattern[step % (sizeof(pattern) / sizeof(pattern[0]))];

        if (count > length - offset)
            count = length - offset;
        feed(stream, capture, data + offset, count);
        offset += count;
        ++step;
    }
}

#define CHECK(condition)                                                        \
    do {                                                                        \
        if (!(condition)) {                                                     \
            fprintf(stderr, "FAIL %s:%d: %s\n", __func__, __LINE__,           \
                    #condition);                                                \
            return 1;                                                           \
        }                                                                       \
    } while (0)

static int check_position(const struct nmea_event *event, double latitude,
                          double longitude)
{
    CHECK(event->type == NMEA_EVENT_POSITION);
    CHECK(event->position.quality == 1u);
    CHECK(event->position.satellites == 8u);
    CHECK(fabs(event->position.latitude - latitude) < 0.000000001);
    CHECK(fabs(event->position.longitude - longitude) < 0.000000001);
    return 0;
}

static int test_valid_sentence(void)
{
    struct nmea_stream stream;
    struct capture capture;

    nmea_stream_init(&stream);
    capture_init(&capture);
    feed(&stream, &capture, valid, sizeof(valid) - 1u);
    CHECK(capture.count == 1u);
    CHECK(check_position(&capture.events[0], 47.285233166666667,
                         8.565265) == 0);
    return 0;
}

static int test_half_sentence(void)
{
    struct nmea_stream stream;
    struct capture capture;
    size_t split = 20u;

    nmea_stream_init(&stream);
    capture_init(&capture);
    feed(&stream, &capture, valid, split);
    CHECK(capture.count == 0u);
    CHECK(stream.in_sentence == 1);
    CHECK(stream.length == split);
    feed(&stream, &capture, valid + split, sizeof(valid) - 1u - split);
    CHECK(capture.count == 1u);
    CHECK(check_position(&capture.events[0], 47.285233166666667,
                         8.565265) == 0);
    CHECK(stream.in_sentence == 0);
    CHECK(stream.length == 0u);
    return 0;
}

static int test_every_split_point(void)
{
    size_t split;

    for (split = 0; split <= sizeof(valid) - 1u; ++split) {
        struct nmea_stream stream;
        struct capture capture;

        nmea_stream_init(&stream);
        capture_init(&capture);
        feed(&stream, &capture, valid, split);
        feed(&stream, &capture, valid + split, sizeof(valid) - 1u - split);
        CHECK(capture.count == 1u);
        CHECK(check_position(&capture.events[0], 47.285233166666667,
                             8.565265) == 0);
    }
    return 0;
}

static int test_byte_and_irregular_chunks(void)
{
    struct nmea_stream stream;
    struct capture capture;
    size_t i;

    nmea_stream_init(&stream);
    capture_init(&capture);
    for (i = 0; i < sizeof(valid) - 1u; ++i)
        feed(&stream, &capture, valid + i, 1u);
    CHECK(capture.count == 1u);
    CHECK(check_position(&capture.events[0], 47.285233166666667,
                         8.565265) == 0);

    nmea_stream_init(&stream);
    capture_init(&capture);
    feed_pattern(&stream, &capture, valid, sizeof(valid) - 1u);
    CHECK(capture.count == 1u);
    CHECK(check_position(&capture.events[0], 47.285233166666667,
                         8.565265) == 0);
    return 0;
}

static int test_multiple_sentences(void)
{
    struct nmea_stream stream;
    struct capture capture;
    char input[sizeof(valid) + sizeof(no_fix_empty) + sizeof(ignored) +
               sizeof(valid) - 4u];
    size_t length = 0;

    memcpy(input + length, valid, sizeof(valid) - 1u);
    length += sizeof(valid) - 1u;
    memcpy(input + length, no_fix_empty, sizeof(no_fix_empty) - 1u);
    length += sizeof(no_fix_empty) - 1u;
    memcpy(input + length, ignored, sizeof(ignored) - 1u);
    length += sizeof(ignored) - 1u;
    memcpy(input + length, valid, sizeof(valid) - 1u);
    length += sizeof(valid) - 1u;

    nmea_stream_init(&stream);
    capture_init(&capture);
    feed(&stream, &capture, input, length);
    CHECK(capture.count == 4u);
    CHECK(capture.events[0].type == NMEA_EVENT_POSITION);
    CHECK(capture.events[1].type == NMEA_EVENT_NO_FIX);
    CHECK(capture.events[1].position.satellites == 0u);
    CHECK(capture.events[2].type == NMEA_EVENT_IGNORED);
    CHECK(capture.events[3].type == NMEA_EVENT_POSITION);
    return 0;
}

static int test_bad_checksum(void)
{
    struct nmea_stream stream;
    struct capture capture;

    nmea_stream_init(&stream);
    capture_init(&capture);
    feed(&stream, &capture, bad_checksum, sizeof(bad_checksum) - 1u);
    CHECK(capture.count == 1u);
    CHECK(capture.events[0].type == NMEA_EVENT_BAD_CHECKSUM);
    return 0;
}

static int test_empty_fields_and_no_fix(void)
{
    struct nmea_stream stream;
    struct capture capture;

    nmea_stream_init(&stream);
    capture_init(&capture);
    feed(&stream, &capture, no_fix_empty, sizeof(no_fix_empty) - 1u);
    feed(&stream, &capture, no_fix_with_coordinates,
         sizeof(no_fix_with_coordinates) - 1u);
    CHECK(capture.count == 2u);
    CHECK(capture.events[0].type == NMEA_EVENT_NO_FIX);
    CHECK(capture.events[1].type == NMEA_EVENT_NO_FIX);
    CHECK(capture.events[0].position.latitude == 0.0);
    CHECK(capture.events[1].position.longitude == 0.0);

    capture_init(&capture);
    nmea_stream_init(&stream);
    feed(&stream, &capture, fix_with_empty_coordinates,
         sizeof(fix_with_empty_coordinates) - 1u);
    CHECK(capture.count == 1u);
    CHECK(capture.events[0].type == NMEA_EVENT_MALFORMED);
    return 0;
}

static int test_overlong_and_recovery(void)
{
    struct nmea_stream stream;
    struct capture capture;
    char oversized[84];

    memset(oversized, 'A', sizeof(oversized));
    oversized[0] = '$';
    oversized[82] = '\r';
    oversized[83] = '\n';

    nmea_stream_init(&stream);
    capture_init(&capture);
    feed_pattern(&stream, &capture, oversized, sizeof(oversized));
    CHECK(capture.count == 1u);
    CHECK(capture.events[0].type == NMEA_EVENT_TOO_LONG);
    feed(&stream, &capture, valid, sizeof(valid) - 1u);
    CHECK(capture.count == 2u);
    CHECK(capture.events[1].type == NMEA_EVENT_POSITION);
    return 0;
}

static int test_malformed_and_resync(void)
{
    struct nmea_stream stream;
    struct capture capture;
    static const char lf_only[] =
        "$GPGGA,092725.00,4717.11399,N,00833.91590,E,1,8,1.01,"
        "499.6,M,48.0,M,,0*5B\n";
    static const char broken[] = "noise$GPGGA,broken";

    nmea_stream_init(&stream);
    capture_init(&capture);
    feed(&stream, &capture, lf_only, sizeof(lf_only) - 1u);
    CHECK(capture.count == 1u);
    CHECK(capture.events[0].type == NMEA_EVENT_MALFORMED);
    feed(&stream, &capture, broken, sizeof(broken) - 1u);
    feed(&stream, &capture, valid, sizeof(valid) - 1u);
    CHECK(capture.count == 2u);
    CHECK(capture.events[1].type == NMEA_EVENT_POSITION);
    return 0;
}

static int test_incomplete_and_hemispheres(void)
{
    struct nmea_stream stream;
    struct capture capture;

    nmea_stream_init(&stream);
    capture_init(&capture);
    feed(&stream, &capture, valid, sizeof(valid) - 2u);
    CHECK(capture.count == 0u);
    CHECK(stream.in_sentence == 1);

    nmea_stream_init(&stream);
    feed(&stream, &capture, valid_south_west, sizeof(valid_south_west) - 1u);
    CHECK(capture.count == 1u);
    CHECK(check_position(&capture.events[0], -47.285233166666667,
                         -8.565265) == 0);
    return 0;
}

int main(void)
{
    static int (*const tests[])(void) = {
        test_valid_sentence,
        test_half_sentence,
        test_every_split_point,
        test_byte_and_irregular_chunks,
        test_multiple_sentences,
        test_bad_checksum,
        test_empty_fields_and_no_fix,
        test_overlong_and_recovery,
        test_malformed_and_resync,
        test_incomplete_and_hemispheres
    };
    size_t i;

    for (i = 0; i < sizeof(tests) / sizeof(tests[0]); ++i) {
        if (tests[i]() != 0)
            return 1;
    }
    printf("PASS: %zu deterministic test groups\n",
           sizeof(tests) / sizeof(tests[0]));
    return 0;
}
