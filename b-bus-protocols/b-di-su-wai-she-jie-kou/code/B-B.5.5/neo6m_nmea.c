#define _DEFAULT_SOURCE
#define _POSIX_C_SOURCE 200809L

#include "nmea_stream.h"

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

static volatile sig_atomic_t stop_requested;

static void request_stop(int signal_number)
{
    (void)signal_number;
    stop_requested = 1;
}

struct statistics {
    unsigned long positions;
    unsigned long no_fix;
    unsigned long unsupported_fix;
    unsigned long ignored;
    unsigned long bad_checksum;
    unsigned long malformed;
    unsigned long too_long;
};

static void print_event(const struct nmea_event *event, void *context)
{
    struct statistics *stats = context;

    switch (event->type) {
    case NMEA_EVENT_POSITION:
        ++stats->positions;
        printf("position quality=%u satellites=%u latitude=%.6f longitude=%.6f\n",
               event->position.quality, event->position.satellites,
               event->position.latitude, event->position.longitude);
        break;
    case NMEA_EVENT_NO_FIX:
        ++stats->no_fix;
        printf("no_fix satellites=%u\n", event->position.satellites);
        break;
    case NMEA_EVENT_UNSUPPORTED_FIX:
        ++stats->unsupported_fix;
        printf("unsupported_fix quality=%u satellites=%u\n",
               event->position.quality, event->position.satellites);
        break;
    case NMEA_EVENT_IGNORED:
        ++stats->ignored;
        break;
    case NMEA_EVENT_BAD_CHECKSUM:
        ++stats->bad_checksum;
        fprintf(stderr, "discarded: bad checksum\n");
        break;
    case NMEA_EVENT_MALFORMED:
        ++stats->malformed;
        fprintf(stderr, "discarded: malformed sentence\n");
        break;
    case NMEA_EVENT_TOO_LONG:
        ++stats->too_long;
        fprintf(stderr, "discarded: sentence exceeds %u bytes\n",
                NMEA_SENTENCE_MAX);
        break;
    }
}

static int same_termios(const struct termios *left,
                        const struct termios *right)
{
    return left->c_iflag == right->c_iflag &&
           left->c_oflag == right->c_oflag &&
           left->c_cflag == right->c_cflag &&
           left->c_lflag == right->c_lflag &&
           left->c_line == right->c_line &&
           memcmp(left->c_cc, right->c_cc, NCCS) == 0 &&
           cfgetispeed(left) == cfgetispeed(right) &&
           cfgetospeed(left) == cfgetospeed(right);
}

static int configure_port(int fd, struct termios *saved, bool *changed)
{
    struct termios requested;
    struct termios actual;

    if (tcgetattr(fd, saved) != 0) {
        perror("tcgetattr saved configuration");
        return -1;
    }
    requested = *saved;
    cfmakeraw(&requested);
    requested.c_cflag &= ~(CSIZE | PARENB | CSTOPB | CRTSCTS);
    requested.c_cflag |= CS8 | CREAD | CLOCAL;
    requested.c_cc[VMIN] = 0;
    requested.c_cc[VTIME] = 10;
    if (cfsetispeed(&requested, B9600) != 0 ||
        cfsetospeed(&requested, B9600) != 0) {
        perror("cfsetispeed/cfsetospeed");
        return -1;
    }
    if (tcsetattr(fd, TCSANOW, &requested) != 0) {
        perror("tcsetattr configure");
        return -1;
    }
    *changed = true;
    if (tcflush(fd, TCIFLUSH) != 0) {
        perror("tcflush TCIFLUSH");
        return -1;
    }
    if (tcgetattr(fd, &actual) != 0) {
        perror("tcgetattr configuration readback");
        return -1;
    }
    if (!same_termios(&requested, &actual)) {
        fprintf(stderr, "termios readback differs from requested configuration\n");
        return -1;
    }
    return 0;
}

static int restore_port(int fd, const struct termios *saved)
{
    struct termios actual;

    if (tcsetattr(fd, TCSANOW, saved) != 0) {
        perror("tcsetattr restore");
        return -1;
    }
    if (tcgetattr(fd, &actual) != 0) {
        perror("tcgetattr restore readback");
        return -1;
    }
    if (!same_termios(saved, &actual)) {
        fprintf(stderr, "termios readback differs from saved configuration\n");
        return -1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    struct sigaction action;
    struct termios saved;
    struct statistics stats = {0};
    struct nmea_stream stream;
    bool changed = false;
    int fd;
    int exit_code = EXIT_FAILURE;

    if (argc != 2) {
        fprintf(stderr, "usage: %s DEVICE\n", argv[0]);
        return EXIT_FAILURE;
    }
    memset(&action, 0, sizeof(action));
    action.sa_handler = request_stop;
    if (sigemptyset(&action.sa_mask) != 0 ||
        sigaction(SIGINT, &action, NULL) != 0) {
        perror("sigaction SIGINT");
        return EXIT_FAILURE;
    }

    fd = open(argv[1], O_RDONLY | O_NOCTTY | O_CLOEXEC);
    if (fd < 0) {
        perror("open");
        return EXIT_FAILURE;
    }
    if (configure_port(fd, &saved, &changed) != 0)
        goto out;

    nmea_stream_init(&stream);
    printf("reading %s; press Ctrl+C to stop and restore termios\n", argv[1]);
    while (!stop_requested) {
        unsigned char buffer[256];
        ssize_t count = read(fd, buffer, sizeof(buffer));

        if (count > 0) {
            nmea_stream_feed(&stream, buffer, (size_t)count, print_event,
                             &stats);
        } else if (count == 0) {
            continue;
        } else if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
            continue;
        } else {
            perror("read");
            goto out;
        }
    }
    exit_code = EXIT_SUCCESS;

out:
    if (changed && restore_port(fd, &saved) != 0)
        exit_code = EXIT_FAILURE;
    if (close(fd) != 0) {
        perror("close");
        exit_code = EXIT_FAILURE;
    }
    printf("summary positions=%lu no_fix=%lu unsupported=%lu ignored=%lu "
           "bad_checksum=%lu malformed=%lu too_long=%lu\n",
           stats.positions, stats.no_fix, stats.unsupported_fix, stats.ignored,
           stats.bad_checksum, stats.malformed, stats.too_long);
    return exit_code;
}
