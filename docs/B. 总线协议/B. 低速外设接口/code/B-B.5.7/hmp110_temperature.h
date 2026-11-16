#ifndef HMP110_TEMPERATURE_H
#define HMP110_TEMPERATURE_H

#include <stdint.h>

enum hmp110_temperature_status {
    HMP110_TEMPERATURE_OK = 0,
    HMP110_TEMPERATURE_UNAVAILABLE,
    HMP110_TEMPERATURE_SATURATED_HIGH,
    HMP110_TEMPERATURE_SATURATED_LOW,
    HMP110_TEMPERATURE_OUTSIDE_MEASUREMENT_RANGE,
    HMP110_TEMPERATURE_INVALID_ARGUMENT
};

/* Decode register number 258 / PDU address 0x0101 into tenths of a degree C. */
enum hmp110_temperature_status hmp110_decode_temperature(uint16_t raw, int *tenths_c);
const char *hmp110_temperature_status_string(enum hmp110_temperature_status status);

#endif
