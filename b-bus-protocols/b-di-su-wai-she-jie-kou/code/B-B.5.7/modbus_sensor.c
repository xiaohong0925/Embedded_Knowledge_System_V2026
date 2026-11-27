#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <modbus/modbus.h>

#include "hmp110_temperature.h"

#define HMP110_DEFAULT_SLAVE 240
#define HMP110_DEFAULT_BAUD 19200
#define HMP110_TEMPERATURE_ADDRESS 0x0101
#define HMP110_TEMPERATURE_COUNT 1

static void usage(const char *program)
{
    fprintf(stderr,
            "usage: %s [-d] DEVICE [SLAVE [BAUD [PARITY [DATA_BITS [STOP_BITS]]]]]\n"
            "defaults: SLAVE=240 BAUD=19200 PARITY=N DATA_BITS=8 STOP_BITS=2\n"
            "-d enables libmodbus protocol debug output\n",
            program);
}

static int parse_int(const char *text, int minimum, int maximum, int *value)
{
    char *end;
    long parsed;

    if (text == NULL || *text == '\0' || value == NULL)
        return -1;

    errno = 0;
    parsed = strtol(text, &end, 0);
    if (errno != 0 || *end != '\0' || parsed < minimum || parsed > maximum)
        return -1;

    *value = (int)parsed;
    return 0;
}

static const char *read_error_class(int error)
{
    switch (error) {
    case ETIMEDOUT:
        return "response_or_byte_timeout";
    case ECONNRESET:
        return "connection_reset";
    case EMBXILFUN:
        return "modbus_exception_illegal_function";
    case EMBXILADD:
        return "modbus_exception_illegal_data_address";
    case EMBXILVAL:
        return "modbus_exception_illegal_data_value";
    case EMBXSFAIL:
        return "modbus_exception_device_failure";
    case EMBXSBUSY:
        return "modbus_exception_device_busy";
    case EMBBADCRC:
        return "crc_mismatch";
    case EMBBADDATA:
        return "response_does_not_match_request";
    case EMBBADEXC:
        return "invalid_exception_response";
    case EMBUNKEXC:
        return "unknown_exception_response";
    case EMBMDATA:
        return "too_much_response_data";
    case EMBBADSLAVE:
        return "response_from_unrequested_slave";
    default:
        return "system_or_other_error";
    }
}

int main(int argc, char **argv)
{
    const char *device;
    int slave = HMP110_DEFAULT_SLAVE;
    int baud = HMP110_DEFAULT_BAUD;
    char parity = 'N';
    int data_bits = 8;
    int stop_bits = 2;
    int debug = 0;
    int option;
    modbus_t *ctx = NULL;
    int connected = 0;
    int exit_code = EXIT_FAILURE;
    uint16_t raw = 0;
    int tenths_c = 0;
    int rc;

    while ((option = getopt(argc, argv, "dh")) != -1) {
        if (option == 'd')
            debug = 1;
        else if (option == 'h') {
            usage(argv[0]);
            return EXIT_SUCCESS;
        } else {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
    }

    if (argc - optind < 1 || argc - optind > 6) {
        usage(argv[0]);
        return EXIT_FAILURE;
    }

    device = argv[optind];
    if (argc - optind >= 2 &&
        parse_int(argv[optind + 1], 1, 247, &slave) != 0) {
        fprintf(stderr, "slave must be in the unicast range 1..247\n");
        return EXIT_FAILURE;
    }
    if (argc - optind >= 3 &&
        parse_int(argv[optind + 2], 1, INT_MAX, &baud) != 0) {
        fprintf(stderr, "invalid baud rate\n");
        return EXIT_FAILURE;
    }
    if (argc - optind >= 4) {
        if (strlen(argv[optind + 3]) != 1 ||
            (argv[optind + 3][0] != 'N' && argv[optind + 3][0] != 'E' &&
             argv[optind + 3][0] != 'O')) {
            fprintf(stderr, "parity must be N, E or O\n");
            return EXIT_FAILURE;
        }
        parity = argv[optind + 3][0];
    }
    if (argc - optind >= 5 &&
        parse_int(argv[optind + 4], 5, 8, &data_bits) != 0) {
        fprintf(stderr, "data bits must be in the range 5..8\n");
        return EXIT_FAILURE;
    }
    if (argc - optind >= 6 &&
        parse_int(argv[optind + 5], 1, 2, &stop_bits) != 0) {
        fprintf(stderr, "stop bits must be 1 or 2\n");
        return EXIT_FAILURE;
    }

    if (libmodbus_version_major != 3 || libmodbus_version_minor != 2 ||
        libmodbus_version_micro != 0) {
        fprintf(stderr,
                "this verified example requires libmodbus 3.2.0, linked version is %u.%u.%u\n",
                libmodbus_version_major, libmodbus_version_minor, libmodbus_version_micro);
        return EXIT_FAILURE;
    }

    ctx = modbus_new_rtu(device, baud, parity, data_bits, stop_bits);
    if (ctx == NULL) {
        fprintf(stderr, "modbus_new_rtu: %s\n", modbus_strerror(errno));
        goto out;
    }
    if (modbus_set_slave(ctx, slave) != 0) {
        fprintf(stderr, "modbus_set_slave: %s\n", modbus_strerror(errno));
        goto out;
    }
    /* Teaching limits, not HMP110 response-time guarantees. */
    if (modbus_set_response_timeout(ctx, 1, 0) != 0) {
        fprintf(stderr, "modbus_set_response_timeout: %s\n", modbus_strerror(errno));
        goto out;
    }
    if (modbus_set_byte_timeout(ctx, 0, 100000) != 0) {
        fprintf(stderr, "modbus_set_byte_timeout: %s\n", modbus_strerror(errno));
        goto out;
    }
    if (debug && modbus_set_debug(ctx, 1) != 0) {
        fprintf(stderr, "modbus_set_debug: %s\n", modbus_strerror(errno));
        goto out;
    }
    if (modbus_connect(ctx) != 0) {
        fprintf(stderr, "modbus_connect %s: %s\n", device, modbus_strerror(errno));
        goto out;
    }
    connected = 1;

    printf("libmodbus=3.2.0 device=%s baud=%d format=%d%c%d slave=%d\n",
           device, baud, data_bits, parity, stop_bits, slave);
    printf("request function=0x03 address=0x%04X count=%d\n",
           HMP110_TEMPERATURE_ADDRESS, HMP110_TEMPERATURE_COUNT);

    errno = 0;
    rc = modbus_read_registers(ctx, HMP110_TEMPERATURE_ADDRESS,
                               HMP110_TEMPERATURE_COUNT, &raw);
    if (rc < 0) {
        int error = errno;

        fprintf(stderr, "read_failed class=%s error=%d message=%s\n",
                read_error_class(error), error, modbus_strerror(error));
        goto out;
    }
    if (rc != HMP110_TEMPERATURE_COUNT) {
        fprintf(stderr, "read_failed expected=%d registers actual=%d\n",
                HMP110_TEMPERATURE_COUNT, rc);
        goto out;
    }

    {
        enum hmp110_temperature_status status = hmp110_decode_temperature(raw, &tenths_c);

        if (status != HMP110_TEMPERATURE_OK) {
            fprintf(stderr, "measurement_rejected reason=%s raw=0x%04X\n",
                    hmp110_temperature_status_string(status), (unsigned int)raw);
            goto out;
        }
    }

    {
        int magnitude = tenths_c < 0 ? -tenths_c : tenths_c;

        printf("measurement temperature=%s%d.%d C raw=0x%04X registers_read=%d\n",
               tenths_c < 0 ? "-" : "", magnitude / 10, magnitude % 10,
               (unsigned int)raw, rc);
    }
    exit_code = EXIT_SUCCESS;

out:
    if (connected)
        modbus_close(ctx);
    modbus_free(ctx);
    return exit_code;
}
