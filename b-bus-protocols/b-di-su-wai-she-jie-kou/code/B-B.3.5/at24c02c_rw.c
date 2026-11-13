/*
 * B-B.3.5 original teaching example: AT24C02C on /dev/i2c-1.
 * Run only after the at24 driver is unbound and all other access has stopped.
 * Source-reviewed only: not compiled, run, or tested on hardware here.
 */
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#define I2C_BUS             "/dev/i2c-1"
#define DEV_ADDR            0x50
#define START_ADDR          0x10
#define PAGE_SIZE           8
#define WRITE_TIMEOUT_NS    (25LL * 1000 * 1000)
#define WRITE_CYCLE_NS      (5LL * 1000 * 1000)
#define POLL_INTERVAL_NS    (200LL * 1000)

/* CLOCK_MONOTONIC measures elapsed time even if the wall clock changes. */
static int64_t monotonic_ns(void)
{
    struct timespec ts;

    if (clock_gettime(CLOCK_MONOTONIC, &ts) < 0)
        return -1;
    return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

/* nanosleep may be interrupted; req then contains the remaining time. */
static int sleep_ns(long ns)
{
    struct timespec req = {
        .tv_sec = ns / 1000000000L,
        .tv_nsec = ns % 1000000000L,
    };

    while (nanosleep(&req, &req) < 0) {
        if (errno != EINTR)
            return -1;
    }
    return 0;
}

/*
 * Poll with a zero-length write after each page.
 * Success: 0. Unsupported zero-length messages: wait the fixed 5 ms maximum
 * write cycle instead. Other persistent failures become ETIMEDOUT after 25 ms.
 */
static int at24_wait_ready(int fd)
{
    int64_t start = monotonic_ns();

    if (start < 0)
        return -1;

    for (;;) {
        ssize_t ret = write(fd, NULL, 0);
        int64_t now;

        if (ret >= 0)       /* Do not assume a successful zero-length write returns 0. */
            return 0;
        if (errno == EINVAL || errno == EOPNOTSUPP)
            return sleep_ns(WRITE_CYCLE_NS);

        now = monotonic_ns();
        if (now < 0)
            return -1;
        if (now - start >= WRITE_TIMEOUT_NS) {
            errno = ETIMEDOUT;
            return -1;
        }
        if (sleep_ns(POLL_INTERVAL_NS) < 0)
            return -1;
    }
}

/* Write only inside one 8-byte page; the first byte on the wire is mem_addr. */
static int at24_write_page(int fd, uint8_t mem_addr,
                           const uint8_t *data, size_t len)
{
    uint8_t buf[PAGE_SIZE + 1];
    ssize_t ret;

    if (len == 0 || len > PAGE_SIZE ||
        (mem_addr % PAGE_SIZE) + len > PAGE_SIZE) {
        errno = EINVAL;
        return -1;
    }

    buf[0] = mem_addr;
    memcpy(buf + 1, data, len);

    do {
        ret = write(fd, buf, len + 1);
    } while (ret < 0 && errno == EINTR);

    if (ret < 0)
        return -1;
    if ((size_t)ret != len + 1) {
        errno = EIO;        /* A short write has no useful old errno to print. */
        return -1;
    }
    return at24_wait_ready(fd);
}

/* Random read: write the word address, Repeated START, then read len bytes. */
static int at24_read(int fd, uint8_t mem_addr, uint8_t *buf, uint16_t len)
{
    struct i2c_msg msgs[2] = {
        {
            .addr = DEV_ADDR,
            .flags = 0,
            .len = 1,
            .buf = &mem_addr,
        },
        {
            .addr = DEV_ADDR,
            .flags = I2C_M_RD,
            .len = len,
            .buf = buf,
        },
    };
    struct i2c_rdwr_ioctl_data rdwr = {
        .msgs = msgs,
        .nmsgs = 2,
    };
    int ret;

    do {
        ret = ioctl(fd, I2C_RDWR, &rdwr);
    } while (ret < 0 && errno == EINTR);

    if (ret < 0)
        return -1;
    if (ret != 2) {         /* The success value is completed messages, not bytes. */
        errno = EIO;
        return -1;
    }
    return 0;
}

int main(void)
{
    static const uint8_t data[] = "Hello-EEPROM";
    const size_t total = sizeof(data) - 1;  /* Exclude the string terminator '\0'. */
    uint8_t readback[sizeof(data) - 1];
    size_t done = 0;
    size_t i;
    int fd;
    int status = 1;

    fd = open(I2C_BUS, O_RDWR);
    if (fd < 0) {
        perror("open " I2C_BUS);
        return 1;
    }
    if (ioctl(fd, I2C_SLAVE, DEV_ADDR) < 0) {
        perror("ioctl I2C_SLAVE");  /* EBUSY: check whether at24 is still bound. */
        goto out;
    }

    while (done < total) {
        size_t pos = START_ADDR + done;
        size_t page_left = PAGE_SIZE - (pos % PAGE_SIZE);
        size_t chunk = total - done;

        if (chunk > page_left)
            chunk = page_left;

        if (at24_write_page(fd, (uint8_t)pos, data + done, chunk) < 0) {
            perror("page write");
            goto out;
        }
        printf("page write: addr=0x%02zx, data bytes=%zu\n", pos, chunk);
        done += chunk;
    }

    if (at24_read(fd, START_ADDR, readback, total) < 0) {
        perror("compound read");
        goto out;
    }

    printf("readback:");
    for (i = 0; i < total; i++)
        printf(" %02x", readback[i]);
    putchar('\n');

    if (memcmp(data, readback, total) != 0) {
        fprintf(stderr, "verify failed: readback differs\n");
        goto out;
    }

    printf("verify OK: %.*s\n", (int)total, (const char *)readback);
    status = 0;

out:
    if (close(fd) < 0 && status == 0) {
        perror("close");
        status = 1;
    }
    return status;
}
