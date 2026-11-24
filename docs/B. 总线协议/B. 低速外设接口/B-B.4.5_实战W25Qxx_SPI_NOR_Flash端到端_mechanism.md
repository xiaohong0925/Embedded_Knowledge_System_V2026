<div class="reader-b2" markdown="1">

# 一次 MTD 写入怎样到达 Flash

> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.5 实战 W25Qxx SPI NOR Flash 端到端
>
> 本组阅读：第 4 页，共 5 页

上一页用 `flashcp` 完成了正常烧写。这里换用一个本篇提供的最小程序 `mtd_upgrade.c`，把同类升级操作拆成可以逐行追踪的代码：**用户态程序怎样擦除和写入 MTD，请求又怎样经 MTD 核心到达 spi-nor。**

---

## <span class="blue"> 先看一笔写入的完整路径

正常升级先擦除，再写入。擦除与写入使用不同的内核入口，不需要用一张函数名总览图把它们混在一个视图里：

```text
MEMERASE ioctl：先擦除容纳输入所需的 MTD 块
write()：mtd_upgrade → mtdchar_write() → mtd_write() → spi_nor_write() → W25Q128JV
```

下面先读完整的用户态程序，再沿 `write()` 追进内核。下一页的异常实验会故意跳过擦除，只保留写入路径。

## <span class="blue"> 用一个最小升级程序展开用户态动作

完整源码为 [`mtd_upgrade.c`](code/B-B.4.5/mtd_upgrade.c){: data-code-viewer="true" data-code-title="mtd_upgrade.c" data-code-path="本篇教学配套 · code/B-B.4.5/mtd_upgrade.c"}。它是本篇原创的最小教学实现，不替代成熟升级工具，但具备正常替换所需的基本步骤和错误路径：

1. 在擦除前完整读入输入文件，避免输入无效时先破坏原数据；
2. 用 `MEMGETINFO` 取得分区容量和擦除块大小；
3. 按输入长度计算擦除范围并调用 `MEMERASE`；
4. 用 [`read_full()`／`write_full()`](code/B-B.4.5/mtd_upgrade.c){: data-code-viewer="true" data-code-title="mtd_upgrade.c" data-code-path="本篇教学配套 · code/B-B.4.5/mtd_upgrade.c"} 显式处理短读写，写完后独立回读并执行 `memcmp()`。

下面直接给出完整实现。代码中的中文注释说明每一步为什么需要、短读写怎样处理，以及哪些错误必须在继续擦写前停止。

**`code/B-B.4.5/mtd_upgrade.c`（完整文件）：**

```c
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
```

本机编译：

```bash
gcc -Wall -Wextra -O2 -o mtd_upgrade mtd_upgrade.c

# AArch64 交叉编译：
aarch64-linux-gnu-gcc -Wall -Wextra -O2 -o mtd_upgrade mtd_upgrade.c
```

在已确认 `/dev/mtd3` 为 `scratch` 的目标板上运行：

```bash
./mtd_upgrade /tmp/aa.bin /dev/mtd3

# 与 4 KiB 输入一致的预期输出：
input_bytes=4096
erase_bytes=4096
write_bytes=4096
verify=OK
```


## <span class="blue"> 沿代码追到 spi-nor

### 用户态程序先擦除，再调用 write()

[`main()`](code/B-B.4.5/mtd_upgrade.c){: data-code-viewer="true" data-code-title="mtd_upgrade.c" data-code-path="本篇教学配套 · code/B-B.4.5/mtd_upgrade.c"} 先完整读取输入，再通过 `MEMGETINFO` 取得几何信息，通过 `MEMERASE` 擦除所需块。随后 `main()` 调用 `write_full()`，后者循环执行 `write(fd, buf + done, len - done)`，把数据交给 `/dev/mtd3`。这些动作都能在上面的完整程序中直接对照，不需要凭行号猜测流程。

### MTD 字符接口把请求交给 MTD 核心

[`mtdchar_write():217-302`](code/B-B.4.5/kernel-v6.6/drivers/mtd/mtdchar.c){: data-code-viewer="true" data-code-title="mtdchar.c" data-code-path="Linux v6.6 · drivers/mtd/mtdchar.c" data-code-lines="217-302"} 把用户缓冲区复制到内核，在第 277 行调用 `mtd_write()`，并累计实际写入长度。自有工具的 `write_full()` 会检查这个返回长度并继续未完成的部分，而不是把一次短写当成完整成功。

### MTD 核心再调用设备写回调

[`mtd_write():1512-1526`](code/B-B.4.5/kernel-v6.6/drivers/mtd/mtdcore.c){: data-code-viewer="true" data-code-title="mtdcore.c" data-code-path="Linux v6.6 · drivers/mtd/mtdcore.c" data-code-lines="1512-1526"} 构造 `mtd_oob_ops` 并进入 `mtd_write_oob()`；[`mtd_write_oob_std():1606-1620`](code/B-B.4.5/kernel-v6.6/drivers/mtd/mtdcore.c){: data-code-viewer="true" data-code-title="mtdcore.c" data-code-path="Linux v6.6 · drivers/mtd/mtdcore.c" data-code-lines="1606-1620"} 在没有专用 `_write_oob` 回调时调用主设备的 `master->_write`。

[`spi_nor_set_mtd_info():3411-3442`](code/B-B.4.5/kernel-v6.6/drivers/mtd/spi-nor/core.c){: data-code-viewer="true" data-code-title="core.c" data-code-path="Linux v6.6 · drivers/mtd/spi-nor/core.c" data-code-lines="3411-3442"} 第 3437 行把这个回调设置为 `spi_nor_write`。至此，一笔来自自有升级程序的数据才到达 spi-nor 的页切分逻辑。

读取路径采用同样的分层：用户态 `read()` → `mtdchar_read()` → `mtd_read()` → spi-nor 的读回调。自有程序在写入后重新 `lseek()` 到分区开头，再按相同长度回读比较。

## <span class="blue"> 到最底层后，spi-nor 怎样保证页编程安全

本例的 4 KiB 写入从偏移 0 开始，是 **16 个完整 256 字节页**：它是页切分逻辑的普通情形，不触发跨页回卷。为了看清框架在非对齐写入时怎样处理边界，下面改用“准备与识别”页的 `0x00F0＋32` 作为放大镜；它与本例不是同一笔请求。

### 先计算当前段最多能写多少

[`spi_nor_write():2132-2193`](code/B-B.4.5/kernel-v6.6/drivers/mtd/spi-nor/core.c){: data-code-viewer="true" data-code-title="core.c" data-code-path="Linux v6.6 · drivers/mtd/spi-nor/core.c" data-code-lines="2132-2193"} 在循环中取得当前地址的 `page_offset`，再把本段长度限制为“当前页剩余量”和“调用者剩余长度”中的较小值：

```text
page_remain = min(page_size - page_offset, len - i)
```

其中，`i` 是本次调用中已经处理的字节数。这个计算保证每一条 Page Program 都留在单独一页内，不会把跨页数据原样交给器件。

### 每段都要重新取得写使能，并独立等待完成

同一段源码在第 2171 行调用 [`spi_nor_write_enable():362-380`](code/B-B.4.5/kernel-v6.6/drivers/mtd/spi-nor/core.c){: data-code-viewer="true" data-code-title="core.c" data-code-path="Linux v6.6 · drivers/mtd/spi-nor/core.c" data-code-lines="362-380"}，将 WEL（Write Enable Latch，写使能锁存位）置为允许编程或擦除的状态。WEL 只是许可，不表示数据已经写完。

写入当前段后，第 2183 行调用 [`spi_nor_wait_till_ready():748-752`](code/B-B.4.5/kernel-v6.6/drivers/mtd/spi-nor/core.c){: data-code-viewer="true" data-code-title="core.c" data-code-path="Linux v6.6 · drivers/mtd/spi-nor/core.c" data-code-lines="748-752"}。只有等待成功，第 2186～2187 行才累计本段实际写入长度并进入下一段。发送或等待任一步失败都会进入 `write_err`，不能把尚未完成的部分算作成功。

下面的逐步视图把这段顺序展开。上方看 spi-nor 当前动作，中间看两段数据落在哪一页，下方同时核对 `i` 与 BUSY。它是依据 v6.6 源码制作的**顺序模型，不是实测波形**。

<div class="interactive-demo">
  <iframe
    src="../html/spi-nor-page-write-busy.html"
    title="spi-nor 两段页编程与两次 BUSY 等待"
    loading="lazy"
    style="width:100%;height:650px;border:0;"
  ></iframe>
</div>

不用交互也能推完：第一段取 `min(0x100 - 0xF0, 32) = 16` 字节，写到当前页 `0xF0～0xFF`，等待就绪后 `i` 才变为 16；第二段再取 16 字节，写到下一页 `0x00～0x0F`，重新执行 Write Enable 并再次等待。两段之间隔着一次完整的内部忙等待，因此不会发生器件页内回卷。

框架能保证每条 Page Program 不跨页，并等待器件就绪，**但它不会替调用者决定何时应该擦除**。正常替换由升级程序先擦除；下一页故意去掉这个前提，观察最终结果。

MTD 的完整概念与读写擦除接口见 [12.4.1 MTD子系统](../../02-核心机制深度解析/第12章%20文件系统/12.4.1_MTD子系统.md)。本页只沿 W25Q 实例追调用链，不重复展开 NAND、OOB、UBI 等内容；后续驱动写法专题已列入 [D 篇后续规划](../../D.%20驱动开发实战/README.md#后续规划)。需要直接观察原始 SPI 命令时，使用 B-B.4.4 的受控 spidev 方法，不在已绑定的产品节点上随意换驱动。

---

[上一页：备份与正常烧写](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_write.md) · [下一页：不擦除写入与恢复](B-B.4.5_实战W25Qxx_SPI_NOR_Flash端到端_experiment.md)

</div>
