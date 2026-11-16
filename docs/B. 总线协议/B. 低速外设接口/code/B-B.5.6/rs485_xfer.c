#define _DEFAULT_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/serial.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

#define RS485_DELAY_MAX_MS 100u
#define READ_IDLE_LIMIT 5u

static const unsigned char request[] = {0x55, 0x00, 0xff, 0x3c};
static const unsigned char expected_response[] = {0xc3, 0x7e};
static volatile sig_atomic_t stop_requested;

struct options {
    const char *device;
    speed_t speed;
    unsigned long baud;
    bool rts_active_low;
    bool rx_during_tx;
    unsigned int before_ms;
    unsigned int after_ms;
};

static void usage(const char *program)
{
    fprintf(stderr,
            "usage: %s <device> <baud> [--rts-active-low] "
            "[--rx-during-tx] [--before-ms N] [--after-ms N]\n",
            program);
    fprintf(stderr, "supported teaching baud rates: "
                    "9600 19200 38400 57600 115200\n");
}

static bool parse_speed(const char *text, speed_t *speed, unsigned long *baud)
{
    if (strcmp(text, "9600") == 0) {
        *speed = B9600;
    } else if (strcmp(text, "19200") == 0) {
        *speed = B19200;
    } else if (strcmp(text, "38400") == 0) {
        *speed = B38400;
    } else if (strcmp(text, "57600") == 0) {
        *speed = B57600;
    } else if (strcmp(text, "115200") == 0) {
        *speed = B115200;
    } else {
        return false;
    }
    *baud = strtoul(text, NULL, 10);
    return true;
}

static bool parse_delay(const char *text, unsigned int *delay)
{
    char *end;
    unsigned long value;

    if (text[0] == '\0')
        return false;
    errno = 0;
    value = strtoul(text, &end, 10);
    if (errno == ERANGE || *end != '\0' || value > RS485_DELAY_MAX_MS)
        return false;
    *delay = (unsigned int)value;
    return true;
}

static bool parse_options(int argc, char **argv, struct options *options)
{
    int i;

    memset(options, 0, sizeof(*options));
    if (argc < 3)
        return false;
    options->device = argv[1];
    if (!parse_speed(argv[2], &options->speed, &options->baud))
        return false;

    for (i = 3; i < argc; ++i) {
        if (strcmp(argv[i], "--rts-active-low") == 0) {
            options->rts_active_low = true;
        } else if (strcmp(argv[i], "--rx-during-tx") == 0) {
            options->rx_during_tx = true;
        } else if (i + 1 < argc &&
                   strcmp(argv[i], "--before-ms") == 0) {
            if (!parse_delay(argv[++i], &options->before_ms))
                return false;
        } else if (i + 1 < argc && strcmp(argv[i], "--after-ms") == 0) {
            if (!parse_delay(argv[++i], &options->after_ms))
                return false;
        } else {
            return false;
        }
    }
    return true;
}

static void request_stop(int signal_number)
{
    (void)signal_number;
    stop_requested = 1;
}

static bool install_signal_handlers(void)
{
    struct sigaction action;

    memset(&action, 0, sizeof(action));
    action.sa_handler = request_stop;
    if (sigemptyset(&action.sa_mask) != 0)
        return false;
    /* No SA_RESTART: a blocking read must be able to observe the stop flag. */
    if (sigaction(SIGINT, &action, NULL) != 0)
        return false;
    return sigaction(SIGTERM, &action, NULL) == 0;
}

static bool termios_equal(const struct termios *left,
                          const struct termios *right)
{
    if (left->c_iflag != right->c_iflag ||
        left->c_oflag != right->c_oflag ||
        left->c_cflag != right->c_cflag ||
        left->c_lflag != right->c_lflag)
        return false;
    if (memcmp(left->c_cc, right->c_cc, sizeof(left->c_cc)) != 0)
        return false;
    return cfgetispeed(left) == cfgetispeed(right) &&
           cfgetospeed(left) == cfgetospeed(right);
}

static void make_rs485_request(const struct options *options,
                               struct serial_rs485 *request_config)
{
    memset(request_config, 0, sizeof(*request_config));
    request_config->flags = SER_RS485_ENABLED;
    if (options->rts_active_low)
        request_config->flags |= SER_RS485_RTS_AFTER_SEND;
    else
        request_config->flags |= SER_RS485_RTS_ON_SEND;
    if (options->rx_during_tx)
        request_config->flags |= SER_RS485_RX_DURING_TX;
    request_config->delay_rts_before_send = options->before_ms;
    request_config->delay_rts_after_send = options->after_ms;
}

static bool rs485_matches_request(const struct serial_rs485 *actual,
                                  const struct serial_rs485 *requested)
{
    const unsigned int mask = SER_RS485_ENABLED | SER_RS485_RTS_ON_SEND |
                              SER_RS485_RTS_AFTER_SEND |
                              SER_RS485_RX_DURING_TX;

    return (actual->flags & mask) == (requested->flags & mask) &&
           actual->delay_rts_before_send == requested->delay_rts_before_send &&
           actual->delay_rts_after_send == requested->delay_rts_after_send;
}

static bool rs485_same_configuration(const struct serial_rs485 *left,
                                     const struct serial_rs485 *right)
{
    /* Disabled mode has no active RTS, delay or address semantics. */
    if (!(left->flags & SER_RS485_ENABLED) &&
        !(right->flags & SER_RS485_ENABLED))
        return true;
    if (left->flags != right->flags ||
        left->delay_rts_before_send != right->delay_rts_before_send ||
        left->delay_rts_after_send != right->delay_rts_after_send)
        return false;
    if ((left->flags & SER_RS485_ADDR_RECV) &&
        left->addr_recv != right->addr_recv)
        return false;
    if ((left->flags & SER_RS485_ADDR_DEST) &&
        left->addr_dest != right->addr_dest)
        return false;
    return true;
}

static void print_rs485(const char *label, const struct serial_rs485 *config)
{
    printf("%s flags=0x%08x rts_on_send=%u rts_after_send=%u "
           "rx_during_tx=%u before_ms=%u after_ms=%u\n",
           label, config->flags,
           !!(config->flags & SER_RS485_RTS_ON_SEND),
           !!(config->flags & SER_RS485_RTS_AFTER_SEND),
           !!(config->flags & SER_RS485_RX_DURING_TX),
           config->delay_rts_before_send, config->delay_rts_after_send);
}

static void print_hex(const char *label, const unsigned char *data, size_t size)
{
    size_t i;

    printf("%s", label);
    for (i = 0; i < size; ++i)
        printf(" %02x", data[i]);
    putchar('\n');
}

static int write_all(int fd, const unsigned char *data, size_t size)
{
    size_t written = 0;

    while (written < size && !stop_requested) {
        ssize_t result = write(fd, data + written, size - written);

        if (result > 0) {
            written += (size_t)result;
        } else if (result == 0) {
            errno = EIO;
            return -1;
        } else if (errno != EINTR) {
            return -1;
        }
    }
    if (stop_requested) {
        errno = EINTR;
        return -1;
    }
    return 0;
}

static int read_response(int fd, unsigned char *response, size_t size)
{
    size_t received = 0;
    unsigned int idle_reads = 0;

    while (received < size && idle_reads < READ_IDLE_LIMIT &&
           !stop_requested) {
        ssize_t result = read(fd, response + received, size - received);

        if (result > 0) {
            received += (size_t)result;
            idle_reads = 0;
        } else if (result == 0) {
            ++idle_reads;
        } else if (errno == EINTR) {
            continue;
        } else if (errno == EAGAIN || errno == EWOULDBLOCK) {
            ++idle_reads;
        } else {
            return -1;
        }
    }
    if (received == size)
        return 0;
    errno = stop_requested ? EINTR : ETIMEDOUT;
    return -1;
}

int main(int argc, char **argv)
{
    struct options options;
    struct termios saved_termios;
    struct termios requested_termios;
    struct termios actual_termios;
    struct serial_rs485 saved_rs485;
    struct serial_rs485 wanted_rs485;
    struct serial_rs485 requested_rs485;
    struct serial_rs485 actual_rs485;
    struct serial_rs485 restore_rs485;
    unsigned char response[sizeof(expected_response)];
    int fd = -1;
    int exit_code = EXIT_FAILURE;
    bool termios_changed = false;
    bool rs485_changed = false;

    if (!parse_options(argc, argv, &options)) {
        usage(argv[0]);
        return EXIT_FAILURE;
    }
    if (!install_signal_handlers()) {
        perror("sigaction");
        return EXIT_FAILURE;
    }

    fd = open(options.device, O_RDWR | O_NOCTTY | O_CLOEXEC);
    if (fd < 0) {
        perror("open");
        return EXIT_FAILURE;
    }
    if (tcgetattr(fd, &saved_termios) != 0) {
        perror("tcgetattr saved configuration");
        goto out;
    }
    if (ioctl(fd, TIOCGRS485, &saved_rs485) < 0) {
        perror("TIOCGRS485 saved configuration");
        goto out;
    }

    requested_termios = saved_termios;
    cfmakeraw(&requested_termios);
    requested_termios.c_cflag &= ~(CSIZE | PARENB | CSTOPB | CRTSCTS);
    requested_termios.c_cflag |= CS8 | CREAD | CLOCAL;
    requested_termios.c_cc[VMIN] = 0;
    requested_termios.c_cc[VTIME] = 10;
    if (cfsetispeed(&requested_termios, options.speed) != 0 ||
        cfsetospeed(&requested_termios, options.speed) != 0) {
        perror("cfsetispeed/cfsetospeed");
        goto out;
    }
    if (tcsetattr(fd, TCSANOW, &requested_termios) != 0) {
        perror("tcsetattr configure");
        goto out;
    }
    termios_changed = true;
    if (tcgetattr(fd, &actual_termios) != 0) {
        perror("tcgetattr readback");
        goto out;
    }
    if (!termios_equal(&actual_termios, &requested_termios)) {
        fprintf(stderr, "termios readback differs from requested settings\n");
        goto out;
    }

    make_rs485_request(&options, &wanted_rs485);
    requested_rs485 = wanted_rs485;
    /* TIOCSRS485 writes the accepted configuration back to this object. */
    if (ioctl(fd, TIOCSRS485, &requested_rs485) < 0) {
        perror("TIOCSRS485 configure");
        goto out;
    }
    rs485_changed = true;
    memset(&actual_rs485, 0, sizeof(actual_rs485));
    if (ioctl(fd, TIOCGRS485, &actual_rs485) < 0) {
        perror("TIOCGRS485 readback");
        goto out;
    }
    print_rs485("rs485_readback", &actual_rs485);
    if (!rs485_matches_request(&actual_rs485, &wanted_rs485)) {
        print_rs485("rs485_requested", &wanted_rs485);
        fprintf(stderr, "driver did not accept the requested RS-485 settings\n");
        goto out;
    }

    printf("device=%s baud=%lu\n", options.device, options.baud);
    if (tcflush(fd, TCIOFLUSH) != 0) {
        perror("tcflush");
        goto out;
    }
    print_hex("request", request, sizeof(request));
    if (write_all(fd, request, sizeof(request)) != 0) {
        perror("write");
        goto out;
    }
    printf("write_accepted=%zu\n", sizeof(request));
    if (tcdrain(fd) != 0) {
        perror("tcdrain");
        goto out;
    }
    printf("tcdrain=complete; this is not a bus-response proof\n");
    if (read_response(fd, response, sizeof(response)) != 0) {
        perror("read response");
        goto out;
    }
    print_hex("response", response, sizeof(response));
    if (memcmp(response, expected_response, sizeof(response)) != 0) {
        fprintf(stderr, "response differs from the controlled peer fixture\n");
        goto out;
    }
    printf("PASS: controlled response verified\n");
    exit_code = EXIT_SUCCESS;

out:
    if (fd >= 0) {
        if (rs485_changed) {
            restore_rs485 = saved_rs485;
            if (ioctl(fd, TIOCSRS485, &restore_rs485) < 0) {
                perror("TIOCSRS485 restore");
                exit_code = EXIT_FAILURE;
            } else {
                memset(&actual_rs485, 0, sizeof(actual_rs485));
                if (ioctl(fd, TIOCGRS485, &actual_rs485) < 0) {
                    perror("TIOCGRS485 restore readback");
                    exit_code = EXIT_FAILURE;
                } else if (!rs485_same_configuration(&actual_rs485,
                                                     &saved_rs485)) {
                    fprintf(stderr, "RS-485 restore readback mismatch\n");
                    exit_code = EXIT_FAILURE;
                }
            }
        }
        if (termios_changed) {
            if (tcsetattr(fd, TCSANOW, &saved_termios) != 0) {
                perror("tcsetattr restore");
                exit_code = EXIT_FAILURE;
            } else if (tcgetattr(fd, &actual_termios) != 0) {
                perror("tcgetattr restore readback");
                exit_code = EXIT_FAILURE;
            } else if (!termios_equal(&actual_termios, &saved_termios)) {
                fprintf(stderr, "termios restore readback mismatch\n");
                exit_code = EXIT_FAILURE;
            }
        }
        if (close(fd) != 0) {
            perror("close");
            exit_code = EXIT_FAILURE;
        }
    }
    return exit_code;
}
