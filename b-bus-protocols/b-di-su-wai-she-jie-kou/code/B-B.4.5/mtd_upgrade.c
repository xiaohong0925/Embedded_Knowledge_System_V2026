#define _FILE_OFFSET_BITS 64

#include <errno.h>
#include <fcntl.h>
#include <mtd/mtd-user.h>  /* mtd_info_user、erase_info_user 和 MTD ioctl 定义 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <unistd.h>

/*
 * 按请求长度完整读取，不能把一次短读当作“读取成功”。
 *
 * 返回值约定：全部读完返回 0；发生错误或提前 EOF 返回 -1。
 * 对 MTD 设备来说，read() 返回的是实际交付的用户字节数，可能小于本次请求。
 * 对普通输入文件来说，ret == 0 表示 EOF；如果还没读够，它同样是失败。
 */
static int read_full(int fd, uint8_t *buf, size_t len)
{
    size_t done = 0;  /* 已经读入 buf 的字节数 */

    while (done < len) {
        /* buf + done 是下一段写入位置，len - done 是仍缺少的长度。 */
        ssize_t ret = read(fd, buf + done, len - done);

        if (ret < 0) {
            /* 被信号打断不代表数据错误，可以在尚未读够时重试。 */
            if (errno == EINTR)
                continue;
            return -1;  /* errno 保留实际错误，交给 perror() 打印 */
        }
        if (ret == 0) {
            /* 尚未读够就遇到 EOF，不能把已有前缀当成完整文件。 */
            errno = EIO;
            return -1;
        }
        done += (size_t)ret;
    }
    return 0;
}

/*
 * 按请求长度完整写入。
 *
 * mtdchar_write() 可以返回小于请求值的正数。这里继续写剩余部分，
 * 而不是看到 write() 正常返回就宣称整个输入已经写入。
 * 返回 0 表示全部写完，返回 -1 表示失败；ret == 0 会使循环无法前进，
 * 因此也必须作为错误处理。
 */
static int write_full(int fd, const uint8_t *buf, size_t len)
{
    size_t done = 0;

    while (done < len) {
        ssize_t ret = write(fd, buf + done, len - done);

        if (ret < 0) {
            if (errno == EINTR)
                continue;
            return -1;
        }
        if (ret == 0) {
            errno = EIO;
            return -1;
        }
        done += (size_t)ret;
    }
    return 0;
}

int main(int argc, char **argv)
{
    const char *input_path;
    const char *device_path;
    struct stat st;                         /* 输入文件的元数据 */
    struct mtd_info_user mtd = { 0 };       /* MTD 容量、擦除块等几何信息 */
    struct erase_info_user erase = { 0 };   /* 本次 MEMERASE 的范围 */
    uint8_t *input_buf = NULL;              /* 准备写入的完整输入 */
    uint8_t *verify_buf = NULL;             /* 从 MTD 独立回读的内容 */
    size_t input_size;
    size_t erase_size;
    int input_fd = -1;
    int device_fd = -1;
    int saved_errno;
    int status = 1;                         /* 默认失败，只有验证通过才改成 0 */

    if (argc != 3) {
        fprintf(stderr, "usage: %s <input.bin> </dev/mtdN>\n", argv[0]);
        return 2;
    }
    input_path = argv[1];
    device_path = argv[2];  /* 不在程序里写死 /dev/mtd3，由调用者明确选择分区 */

    /*
     * 第 1 步：在任何擦除发生前，先完整读入并检查输入文件。
     * 这样，输入不存在、读不全或内存不足时，Flash 中的原数据尚未改变。
     */
    input_fd = open(input_path, O_RDONLY);
    if (input_fd < 0) {
        perror("open input");
        goto cleanup;
    }
    if (fstat(input_fd, &st) < 0) {
        perror("fstat input");
        goto cleanup;
    }
    if (st.st_size <= 0 || (uintmax_t)st.st_size > SIZE_MAX) {
        errno = EINVAL;
        perror("input size");
        goto cleanup;
    }
    input_size = (size_t)st.st_size;

    /* 同时准备输入缓冲区和回读缓冲区，后续比较使用相同长度。 */
    input_buf = malloc(input_size);
    verify_buf = malloc(input_size);
    if (!input_buf || !verify_buf) {
        perror("malloc");
        goto cleanup;
    }
    if (read_full(input_fd, input_buf, input_size) < 0) {
        perror("read input");
        goto cleanup;
    }

    /* 第 2 步：打开调用者指定的 MTD 字符设备，读取它的真实几何信息。 */
    device_fd = open(device_path, O_RDWR);
    if (device_fd < 0) {
        perror("open MTD device");
        goto cleanup;
    }
    if (ioctl(device_fd, MEMGETINFO, &mtd) < 0) {
        perror("MEMGETINFO");
        goto cleanup;
    }
    if (mtd.erasesize == 0 || input_size > mtd.size) {
        /* 擦除块大小为 0 无法计算；输入大于分区则越界，两种情况都停止。 */
        errno = EINVAL;
        perror("MTD geometry or input too large");
        goto cleanup;
    }

    /*
     * 第 3 步：从分区偏移 0 开始，只擦除容纳输入所需的完整擦除块。
     * 输入不足一个块时向上取整为一个块；输入跨块时覆盖所有相关块。
     * 这不是整片擦除，也不会主动越过 open() 时选择的 MTD 分区。
     */
    erase_size = ((input_size + mtd.erasesize - 1) / mtd.erasesize) * mtd.erasesize;
    if (erase_size > mtd.size || erase_size > UINT32_MAX) {
        errno = EINVAL;
        perror("erase range");
        goto cleanup;
    }
    erase.start = 0;
    erase.length = (uint32_t)erase_size;
    if (ioctl(device_fd, MEMERASE, &erase) < 0) {
        /* 只读分区、保护状态或底层错误都会在这里返回失败，不能继续写。 */
        perror("MEMERASE");
        goto cleanup;
    }

    /*
     * 第 4 步：从分区偏移 0 写入完整输入。
     * write_full() 会继续处理短写；底层 spi-nor 仍负责页切分和 BUSY 等待。
     */
    if (lseek(device_fd, 0, SEEK_SET) < 0) {
        perror("lseek before write");
        goto cleanup;
    }
    if (write_full(device_fd, input_buf, input_size) < 0) {
        perror("write MTD device");
        goto cleanup;
    }

    /*
     * 第 5 步：重新定位并独立回读相同长度，再逐字节比较。
     * 写入返回成功只说明写路径执行过；memcmp() 一致才形成内容证据。
     */
    if (lseek(device_fd, 0, SEEK_SET) < 0) {
        perror("lseek before verify");
        goto cleanup;
    }
    if (read_full(device_fd, verify_buf, input_size) < 0) {
        perror("read back MTD device");
        goto cleanup;
    }
    if (memcmp(input_buf, verify_buf, input_size) != 0) {
        errno = EILSEQ;
        perror("verify mismatch");
        goto cleanup;
    }

    /* 只有擦除、完整写入、独立回读和比较全部成功，才打印 verify=OK。 */
    printf("input_bytes=%zu\n", input_size);
    printf("erase_bytes=%u\n", erase.length);
    printf("write_bytes=%zu\n", input_size);
    printf("verify=OK\n");
    status = 0;

cleanup:
    /* 无论在哪一步失败，都释放已经获得的资源，并保留原来的 errno。 */
    saved_errno = errno;
    free(verify_buf);
    free(input_buf);
    if (device_fd >= 0)
        close(device_fd);
    if (input_fd >= 0)
        close(input_fd);
    errno = saved_errno;
    return status;
}
