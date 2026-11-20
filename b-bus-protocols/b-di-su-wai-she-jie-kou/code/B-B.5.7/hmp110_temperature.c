#include "hmp110_temperature.h"

enum hmp110_temperature_status hmp110_decode_temperature(uint16_t raw, int *tenths_c)
{
    int32_t signed_value;

    if (tenths_c == 0)
        return HMP110_TEMPERATURE_INVALID_ARGUMENT;

    /* Do not leave a previous measurement visible after a rejected value. */
    *tenths_c = 0;

    /* M211060EN-N, Table 55: these encodings are not ordinary temperatures. */
    if (raw == 0x8000u)
        return HMP110_TEMPERATURE_UNAVAILABLE;
    if (raw == 0x7FFFu)
        return HMP110_TEMPERATURE_SATURATED_HIGH;
    if (raw == 0x8001u)
        return HMP110_TEMPERATURE_SATURATED_LOW;

    /* Explicit two's-complement conversion avoids implementation-defined casts. */
    signed_value = (raw & 0x8000u) ? (int32_t)raw - 65536 : (int32_t)raw;
    if (signed_value < -400 || signed_value > 800)
        return HMP110_TEMPERATURE_OUTSIDE_MEASUREMENT_RANGE;

    *tenths_c = (int)signed_value;
    return HMP110_TEMPERATURE_OK;
}

const char *hmp110_temperature_status_string(enum hmp110_temperature_status status)
{
    switch (status) {
    case HMP110_TEMPERATURE_OK:
        return "ok";
    case HMP110_TEMPERATURE_UNAVAILABLE:
        return "value_unavailable";
    case HMP110_TEMPERATURE_SATURATED_HIGH:
        return "value_at_or_above_32767";
    case HMP110_TEMPERATURE_SATURATED_LOW:
        return "value_at_or_below_minus_32767";
    case HMP110_TEMPERATURE_OUTSIDE_MEASUREMENT_RANGE:
        return "outside_minus_40_to_80_c";
    case HMP110_TEMPERATURE_INVALID_ARGUMENT:
        return "invalid_argument";
    default:
        return "unknown_status";
    }
}
