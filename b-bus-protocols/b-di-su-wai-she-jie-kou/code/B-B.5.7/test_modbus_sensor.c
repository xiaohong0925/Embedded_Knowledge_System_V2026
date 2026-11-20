#define _GNU_SOURCE

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <poll.h>
#include <pty.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include <modbus/modbus.h>

#include "hmp110_temperature.h"

static const uint8_t expected_request[] = {
    0xF0, 0x03, 0x01, 0x01, 0x00, 0x01, 0xC1, 0x17
};

struct fixture_spec {
    const char *name;
    const uint8_t *response;
    size_t response_length;
    size_t split;
    int no_response;
    int expected_rc;
    int expected_errno;
    int check_semantics;
    uint16_t expected_raw;
    int expected_tenths;
};

static int sleep_milliseconds(long milliseconds)
{
    struct timespec request;
    struct timespec remaining;

    request.tv_sec = milliseconds / 1000;
    request.tv_nsec = (milliseconds % 1000) * 1000000L;
    while (nanosleep(&request, &remaining) != 0) {
        if (errno != EINTR)
            return -1;
        request = remaining;
    }
    return 0;
}

static int read_request(int fd)
{
    uint8_t buffer[sizeof(expected_request)];
    size_t used = 0;

    while (used < sizeof(buffer)) {
        struct pollfd pfd;
        int ready;
        ssize_t count;

        pfd.fd = fd;
        pfd.events = POLLIN;
        pfd.revents = 0;
        do {
            ready = poll(&pfd, 1, 2000);
        } while (ready < 0 && errno == EINTR);
        if (ready <= 0)
            return -1;

        count = read(fd, buffer + used, sizeof(buffer) - used);
        if (count < 0 && errno == EINTR)
            continue;
        if (count <= 0)
            return -1;
        used += (size_t)count;
    }

    if (memcmp(buffer, expected_request, sizeof(buffer)) != 0) {
        size_t i;

        fprintf(stderr, "fixture received unexpected request:");
        for (i = 0; i < sizeof(buffer); ++i)
            fprintf(stderr, " %02X", buffer[i]);
        fprintf(stderr, "\n");
        return -1;
    }
    return 0;
}

static int write_all(int fd, const uint8_t *data, size_t length)
{
    size_t written = 0;

    while (written < length) {
        ssize_t count = write(fd, data + written, length - written);

        if (count < 0 && errno == EINTR)
            continue;
        if (count <= 0)
            return -1;
        written += (size_t)count;
    }
    return 0;
}

static int fake_sensor(int fd, const struct fixture_spec *spec)
{
    if (read_request(fd) != 0)
        return 90;

    if (spec->no_response)
        return sleep_milliseconds(600) == 0 ? 0 : 91;

    if (spec->split == 0 || spec->split >= spec->response_length)
        return write_all(fd, spec->response, spec->response_length) == 0 ? 0 : 92;

    if (write_all(fd, spec->response, spec->split) != 0)
        return 93;
    if (sleep_milliseconds(20) != 0)
        return 94;
    if (write_all(fd, spec->response + spec->split,
                  spec->response_length - spec->split) != 0)
        return 95;
    return 0;
}

static int wait_for_child(pid_t pid)
{
    int status;
    pid_t result;

    do {
        result = waitpid(pid, &status, 0);
    } while (result < 0 && errno == EINTR);

    if (result != pid)
        return -1;
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        if (WIFEXITED(status))
            fprintf(stderr, "fixture child exit=%d\n", WEXITSTATUS(status));
        return -1;
    }
    return 0;
}

static int run_fixture(const struct fixture_spec *spec)
{
    int master_fd = -1;
    int slave_fd = -1;
    char device[128];
    const char *slave_name;
    pid_t pid = -1;
    modbus_t *ctx = NULL;
    int connected = 0;
    uint16_t raw = 0;
    int rc = -2;
    int read_errno = 0;
    int result = -1;

    if (openpty(&master_fd, &slave_fd, NULL, NULL, NULL) != 0) {
        perror("openpty");
        goto out;
    }
    slave_name = ttyname(slave_fd);
    if (slave_name == NULL) {
        perror("ttyname");
        goto out;
    }
    {
        int path_length = snprintf(device, sizeof(device), "%s", slave_name);

        if (path_length < 0 || path_length >= (int)sizeof(device)) {
            fprintf(stderr, "PTY path is unavailable or too long\n");
            goto out;
        }
    }

    pid = fork();
    if (pid < 0) {
        perror("fork");
        goto out;
    }
    if (pid == 0) {
        int child_result;

        close(slave_fd);
        child_result = fake_sensor(master_fd, spec);
        close(master_fd);
        _exit(child_result);
    }

    close(slave_fd);
    slave_fd = -1;
    close(master_fd);
    master_fd = -1;

    ctx = modbus_new_rtu(device, 19200, 'N', 8, 2);
    if (ctx == NULL) {
        perror("modbus_new_rtu");
        goto out;
    }
    if (modbus_set_slave(ctx, 240) != 0 ||
        modbus_set_response_timeout(ctx, 0, 500000) != 0 ||
        modbus_set_byte_timeout(ctx, 0, 200000) != 0) {
        perror("modbus fixture configuration");
        goto out;
    }
    if (modbus_connect(ctx) != 0) {
        perror("modbus_connect PTY");
        goto out;
    }
    connected = 1;

    errno = 0;
    rc = modbus_read_registers(ctx, 0x0101, 1, &raw);
    read_errno = errno;

    if (rc != spec->expected_rc) {
        fprintf(stderr, "%s: expected rc=%d, actual=%d, errno=%d (%s)\n",
                spec->name, spec->expected_rc, rc, read_errno, strerror(read_errno));
        goto out;
    }
    if (rc < 0 && read_errno != spec->expected_errno) {
        fprintf(stderr, "%s: expected errno=%d (%s), actual=%d (%s)\n",
                spec->name, spec->expected_errno, modbus_strerror(spec->expected_errno),
                read_errno, modbus_strerror(read_errno));
        goto out;
    }

    if (spec->check_semantics) {
        int tenths_c = 0;
        enum hmp110_temperature_status status;

        if (raw != spec->expected_raw) {
            fprintf(stderr, "%s: expected raw=0x%04X, actual=0x%04X\n",
                    spec->name, spec->expected_raw, raw);
            goto out;
        }
        status = hmp110_decode_temperature(raw, &tenths_c);
        if (status != HMP110_TEMPERATURE_OK || tenths_c != spec->expected_tenths) {
            fprintf(stderr, "%s: semantic status=%d tenths=%d\n",
                    spec->name, status, tenths_c);
            goto out;
        }
    }

    result = 0;

out:
    if (connected)
        modbus_close(ctx);
    modbus_free(ctx);
    if (slave_fd >= 0)
        close(slave_fd);
    if (master_fd >= 0)
        close(master_fd);
    if (pid > 0 && wait_for_child(pid) != 0)
        result = -1;

    if (result == 0)
        printf("PASS: %s\n", spec->name);
    return result;
}

static int test_semantics(void)
{
    struct semantic_case {
        const char *name;
        uint16_t raw;
        enum hmp110_temperature_status expected_status;
        int expected_tenths;
    };
    static const struct semantic_case cases[] = {
        {"23.5 C", 0x00EB, HMP110_TEMPERATURE_OK, 235},
        {"minus 5.5 C", 0xFFC9, HMP110_TEMPERATURE_OK, -55},
        {"zero C", 0x0000, HMP110_TEMPERATURE_OK, 0},
        {"unavailable", 0x8000, HMP110_TEMPERATURE_UNAVAILABLE, 0},
        {"high saturation", 0x7FFF, HMP110_TEMPERATURE_SATURATED_HIGH, 0},
        {"low saturation", 0x8001, HMP110_TEMPERATURE_SATURATED_LOW, 0},
        {"below measurement range", 0xFC18, HMP110_TEMPERATURE_OUTSIDE_MEASUREMENT_RANGE, 0},
        {"above measurement range", 0x0321, HMP110_TEMPERATURE_OUTSIDE_MEASUREMENT_RANGE, 0},
    };
    size_t i;

    for (i = 0; i < sizeof(cases) / sizeof(cases[0]); ++i) {
        int tenths_c = 12345;
        enum hmp110_temperature_status status =
            hmp110_decode_temperature(cases[i].raw, &tenths_c);

        if (status != cases[i].expected_status) {
            fprintf(stderr, "%s: expected status=%d, actual=%d\n",
                    cases[i].name, cases[i].expected_status, status);
            return -1;
        }
        if (status == HMP110_TEMPERATURE_OK) {
            if (tenths_c != cases[i].expected_tenths) {
                fprintf(stderr, "%s: expected tenths=%d, actual=%d\n",
                        cases[i].name, cases[i].expected_tenths, tenths_c);
                return -1;
            }
        } else if (tenths_c != 0) {
            fprintf(stderr, "%s: rejected value left stale output=%d\n",
                    cases[i].name, tenths_c);
            return -1;
        }
    }

    if (hmp110_decode_temperature(0x00EB, NULL) != HMP110_TEMPERATURE_INVALID_ARGUMENT) {
        fprintf(stderr, "NULL output argument was not rejected\n");
        return -1;
    }
    return 0;
}

int main(void)
{
    static const uint8_t normal[] = {0xF0, 0x03, 0x02, 0x00, 0xEB, 0x85, 0xDE};
    static const uint8_t bad_crc[] = {0xF0, 0x03, 0x02, 0x00, 0xEB, 0x85, 0xDF};
    static const uint8_t exception[] = {0xF0, 0x83, 0x02, 0x91, 0x02};
    static const uint8_t wrong_slave[] = {0xF1, 0x03, 0x02, 0x00, 0xEB, 0xB8, 0x1E};
    static const uint8_t wrong_function[] = {0xF0, 0x04, 0x02, 0x00, 0xEB, 0x84, 0xAA};
    static const uint8_t wrong_byte_count[] = {
        0xF0, 0x03, 0x04, 0x00, 0xEB, 0x00, 0x00, 0x6A, 0xC8
    };
    static const uint8_t valid_other_value[] = {0xF0, 0x03, 0x02, 0x00, 0x00, 0xC5, 0x91};
    static const uint8_t negative[] = {0xF0, 0x03, 0x02, 0xFF, 0xC9, 0x44, 0x37};
    struct fixture_spec spec;
    size_t split;
    int integration_groups = 0;

    if (libmodbus_version_major != 3 || libmodbus_version_minor != 2 ||
        libmodbus_version_micro != 0) {
        fprintf(stderr, "tests require libmodbus 3.2.0, linked version is %u.%u.%u\n",
                libmodbus_version_major, libmodbus_version_minor, libmodbus_version_micro);
        return EXIT_FAILURE;
    }

    if (test_semantics() != 0)
        return EXIT_FAILURE;
    printf("PASS: 9 semantic groups\n");

    for (split = 1; split < sizeof(normal); ++split) {
        memset(&spec, 0, sizeof(spec));
        spec.name = "normal response with segmented PTY writes";
        spec.response = normal;
        spec.response_length = sizeof(normal);
        spec.split = split;
        spec.expected_rc = 1;
        spec.check_semantics = 1;
        spec.expected_raw = 0x00EB;
        spec.expected_tenths = 235;
        if (run_fixture(&spec) != 0)
            return EXIT_FAILURE;
        ++integration_groups;
    }

#define RUN_ERROR_CASE(case_name, frame, expected_error)                         \
    do {                                                                         \
        memset(&spec, 0, sizeof(spec));                                            \
        spec.name = case_name;                                                     \
        spec.response = frame;                                                     \
        spec.response_length = sizeof(frame);                                      \
        spec.expected_rc = -1;                                                     \
        spec.expected_errno = expected_error;                                      \
        if (run_fixture(&spec) != 0)                                               \
            return EXIT_FAILURE;                                                   \
        ++integration_groups;                                                      \
    } while (0)

    RUN_ERROR_CASE("bad CRC", bad_crc, EMBBADCRC);
    RUN_ERROR_CASE("illegal data address exception", exception, EMBXILADD);
    RUN_ERROR_CASE("response from another slave", wrong_slave, EMBBADSLAVE);
    RUN_ERROR_CASE("function does not match request", wrong_function, EMBBADDATA);
    RUN_ERROR_CASE("byte count does not match request", wrong_byte_count, EMBBADDATA);

#undef RUN_ERROR_CASE

    memset(&spec, 0, sizeof(spec));
    spec.name = "CRC-valid response from another valid-looking value";
    spec.response = valid_other_value;
    spec.response_length = sizeof(valid_other_value);
    spec.expected_rc = 1;
    spec.check_semantics = 1;
    spec.expected_raw = 0x0000;
    spec.expected_tenths = 0;
    if (run_fixture(&spec) != 0)
        return EXIT_FAILURE;
    ++integration_groups;

    memset(&spec, 0, sizeof(spec));
    spec.name = "negative temperature";
    spec.response = negative;
    spec.response_length = sizeof(negative);
    spec.expected_rc = 1;
    spec.check_semantics = 1;
    spec.expected_raw = 0xFFC9;
    spec.expected_tenths = -55;
    if (run_fixture(&spec) != 0)
        return EXIT_FAILURE;
    ++integration_groups;

    memset(&spec, 0, sizeof(spec));
    spec.name = "response timeout";
    spec.no_response = 1;
    spec.expected_rc = -1;
    spec.expected_errno = ETIMEDOUT;
    if (run_fixture(&spec) != 0)
        return EXIT_FAILURE;
    ++integration_groups;

    printf("PASS: %d PTY integration groups\n", integration_groups);
    printf("PASS: 23 deterministic groups; no UART, RS-485 or sensor hardware was used\n");
    return EXIT_SUCCESS;
}
