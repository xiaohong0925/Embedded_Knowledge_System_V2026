#!/bin/sh
# B-B.3.4：记录同一笔读取的 I2C tracepoint，并恢复原记录开关。
# 需要 root 和已挂载的 tracefs；脚本本身不会访问生产 EEPROM 的写操作。
set -u

if [ "$(id -u)" -ne 0 ]; then
    echo "请以 root 运行：需要写 tracefs 控制文件" >&2
    exit 1
fi
if ! command -v i2ctransfer >/dev/null 2>&1; then
    echo "找不到 i2ctransfer，请先安装 i2c-tools" >&2
    exit 1
fi

for candidate in /sys/kernel/tracing /sys/kernel/debug/tracing; do
    if [ -w "$candidate/events/i2c/enable" ]; then
        trace_dir=$candidate
        break
    fi
done
if [ -z "${trace_dir:-}" ]; then
    echo "找不到可写的 events/i2c/enable；请检查 tracefs、内核配置与挂载状态" >&2
    exit 1
fi

cd "$trace_dir" || exit 1
saved_tracing_on=$(cat tracing_on) || exit 1
saved_i2c_enable=$(cat events/i2c/enable) || exit 1

cleanup()
{
    # 先停止新增记录，再恢复进入脚本前的两个开关。
    printf '0\n' > tracing_on
    printf '%s\n' "$saved_i2c_enable" > events/i2c/enable
    printf '%s\n' "$saved_tracing_on" > tracing_on
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf '0\n' > tracing_on
: > trace
printf '1\n' > events/i2c/enable
printf '1\n' > tracing_on

i2ctransfer -y 1 w1@0x50 0x10 r4
command_status=$?

printf '0\n' > tracing_on
printf '%s\n' '--- I2C trace（当前缓冲区）---'
cat trace

# 退出时 trap 0 恢复开关；把主命令的成功或失败状态原样交给调用者。
exit "$command_status"
