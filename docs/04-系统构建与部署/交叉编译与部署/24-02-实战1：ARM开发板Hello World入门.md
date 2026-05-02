# 实战1：ARM开发板Hello World入门

> 📊 **本节难度等级：** <span class="badge-b">**B级**</span>

---

### <strong>目标：编译可在ARM Cortex-A系列开发板运行的基础程序</strong>

本实战的核心目标是“打通交叉编译→部署→运行”的完整链路，生成能在ARM Cortex-A系列开发板（如树莓派2/3、NanoPi NEO、友善之臂Tiny4412等）运行的程序。

程序功能不仅是简单的“Hello World”，还会打印开发板的系统信息（如内核版本），让入门者直观感受到“宿主编译、目标机运行”的交叉编译特性，建立基础认知。<br>

### <strong>环境：Linaro工具链（arm-linux-gnueabihf）+ 开发板SSH连接</strong>

入门阶段优先选择成熟工具链和简单连接方式，降低环境搭建门槛，具体环境要求如下：
1.  宿主机器：Ubuntu 18.04/20.04（推荐，兼容性最好），Windows需安装WSL2（避免工具链兼容性问题）；
2.  交叉编译器：Linaro的`arm-linux-gnueabihf-gcc`（针对32位ARM Cortex-A系列，支持硬浮点HF，适配绝大多数入门开发板）；
3.  开发板：ARM Cortex-A7/A9/A53架构（如树莓派2/3、NanoPi NEO），已烧录Linux系统（如Ubuntu Core、Debian）；
4.  连接方式：SSH（开发板与宿主在同一局域网，无需接线，方便文件传输和命令执行）。<br>

### <strong>环境准备实操（新手必看）</strong>

- 1. 安装Linaro工具链（宿主端执行）：
  ```bash
  # 1. 下载工具链（ARMv7版本，适配Cortex-A系列）
  wget https://releases.linaro.org/components/toolchain/binaries/latest-7/arm-linux-gnueabihf/gcc-linaro-7.5.0-2019.12-x86_64_arm-linux-gnueabihf.tar.xz
  # 2. 解压到/opt目录（系统级工具目录，避免权限问题）
  sudo tar -xvf gcc-linaro-7.5.0-2019.12-x86_64_arm-linux-gnueabihf.tar.xz -C /opt/
  # 3. 配置环境变量（让系统识别工具链命令）
  echo 'export PATH=/opt/gcc-linaro-7.5.0-2019.12-x86_64_arm-linux-gnueabihf/bin:$PATH' >> ~/.bashrc
  source ~/.bashrc
  # 4. 验证工具链是否安装成功（输出版本信息即正常）
  arm-linux-gnueabihf-gcc -v
  ```
  关键说明：`arm-linux-gnueabihf`中，“arm”表示目标架构，“linux”表示目标系统，“gnueabihf”表示EABI硬浮点ABI（HF），适配带FPU的Cortex-A开发板。

- 2. 开发板SSH连接准备：
  1.  开发板上电，连接网线（与宿主同一局域网）；
  2.  查看开发板IP（两种方式）：
      - 方式1：开发板接显示器，执行`ifconfig`或`ip addr`查看（如`eth0`的`inet`字段，例：192.168.1.105）；
      - 方式2：路由器管理后台查看“已连接设备”（开发板名称通常含“raspberry”“nanopi”等）；
  3.  宿主端测试SSH连接（输入开发板密码，默认多为“root”“pi”）：
      ```bash
      ssh pi@192.168.1.105  # 树莓派默认用户名pi
      # 或
      ssh root@192.168.1.105  # 多数开发板默认用户名root
      ```
      连接成功会显示开发板的命令行提示符（如`pi@raspberrypi:~$`）。

### <strong>步骤：源码编写→交叉编译→scp部署→开发板运行验证</strong>

本步骤按“源码→编译→部署→运行”顺序拆解，每个环节都给出“命令+预期结果”，新手可直接复制执行。

1. 源码编写（宿主端）
创建简单的C语言源码，不仅打印“Hello World”，还通过`uname`函数获取开发板内核版本，让输出更具实战意义。
```bash
# 1. 创建工作目录（避免文件混乱）
mkdir -p ~/embedded_demo/hello_world && cd ~/embedded_demo/hello_world
# 2. 编写源码（用vim或echo创建，新手推荐echo）
echo '#include <stdio.h>
#include <sys/utsname.h>  // 用于获取系统信息

int main(void) {
    struct utsname sys_info;
    // 打印Hello World
    printf("=================================\n");
    printf("Hello Embedded Linux!\n");
    printf("Target Board: ARM Cortex-A\n");
    // 获取并打印内核版本
    if (uname(&sys_info) == 0) {
        printf("Kernel Version: %s\n", sys_info.release);
    }
    printf("=================================\n");
    return 0;
}' > hello_arm.c
```
  关键说明：`struct utsname`是Linux系统调用接口，用于获取内核版本、主机名等信息，编译时无需额外链接库（依赖libc，工具链默认包含）。

2. 交叉编译（宿主端）
使用`arm-linux-gnueabihf-gcc`编译源码，生成ARM架构的可执行文件。为避免后续“libc版本不匹配”问题，直接使用静态链接（`-static`参数）。
```bash
# 交叉编译命令：指定架构+静态链接+输出文件名
arm-linux-gnueabihf-gcc hello_arm.c -o hello_arm \
  -march=armv7-a  # 适配ARMv7-A架构（Cortex-A7/A9/A53均兼容）
  -static         # 静态链接（嵌入libc库，避免目标机缺库）
  -Wall           # 开启警告（新手养成好习惯）
```
  关键参数说明：
  - `-march=armv7-a`：指定目标架构版本为ARMv7-A，覆盖绝大多数入门级Cortex-A开发板（若开发板是ARMv8-A，此参数仍兼容，向下兼容特性）；
  - `-static`：静态链接核心作用是“将程序依赖的libc库直接嵌入可执行文件”，后续部署时无需担心开发板libc版本过低。

  编译成功验证：执行`ls`命令，会看到生成`hello_arm`文件，用`file`命令确认架构：
  ```bash
  file hello_arm
  # 预期输出（确认是ARM架构静态链接程序）：
  hello_arm: ELF 32-bit LSB executable, ARM, EABI5 version 1 (SYSV), statically linked, for GNU/Linux 3.2.0, BuildID[sha1]=xxx, not stripped
  ```

3. scp部署（宿主端→开发板）
使用`scp`命令（SSH文件传输工具）将宿主端的`hello_arm`文件传输到开发板，无需U盘，高效快捷。
```bash
# scp 本地文件 用户名@开发板IP:开发板目标路径
scp hello_arm pi@192.168.1.105:/home/pi/
# 或（root用户）
scp hello_arm root@192.168.1.105:/root/
```
  预期结果：传输成功会显示进度条（如`100%  1.2MB  10.5MB/s  00:00`），无报错即正常。

4. 开发板运行验证（开发板端）
SSH连接开发板，找到部署的程序，添加执行权限（新手常漏），然后运行，查看输出结果。
```bash
# 1. 若已断开SSH，重新连接开发板（宿主端执行）
ssh pi@192.168.1.105
# 2. 进入程序所在目录（根据部署路径调整）
cd /home/pi/
# 3. 添加执行权限（刚传输的文件默认无执行权限）
chmod +x hello_arm
# 4. 运行程序
./hello_arm
```
  预期输出（成功运行）：
  ```
  =================================
  Hello Embedded Linux!
  Target Board: ARM Cortex-A
  Kernel Version: 5.15.32-v7+
  =================================
  ```
  关键说明：`Kernel Version`是开发板的实际内核版本，不同开发板可能不同，能正常显示即说明程序在ARM架构上运行成功。<br>

### <strong>避坑点：开发板libc版本低于工具链导致的运行失败（静态链接解决）</strong>

入门者最常遇到的问题：编译成功但开发板运行报错“version `GLIBC_2.27' not found”，核心原因是“工具链的libc版本高于开发板的libc版本”（动态链接时程序依赖开发板的libc，版本不匹配则报错）。

1. 报错现象（动态链接时）
若编译时未加`-static`（动态链接）：
```bash
# 动态链接编译（故意不加-static，复现报错）
arm-linux-gnueabihf-gcc hello_arm.c -o hello_arm_dynamic -march=armv7-a
# 部署到开发板运行
ssh pi@192.168.1.105 "./hello_arm_dynamic"
```
  典型报错：
  ```
  ./hello_arm_dynamic: /lib/arm-linux-gnueabihf/libc.so.6: version `GLIBC_2.27' not found (required by ./hello_arm_dynamic)
  ```
  根因：宿主工具链的libc版本是2.27，而开发板的libc版本是2.24（如老旧系统），动态链接时程序依赖开发板的libc，版本不兼容导致失败。

2. 解决方法：静态链接（`-static`参数）
静态链接会将工具链中的libc库直接嵌入程序，程序运行时不依赖开发板的libc，彻底解决版本不匹配问题。
```bash
# 重新静态编译（加-static参数）
arm-linux-gnueabihf-gcc hello_arm.c -o hello_arm_static -march=armv7-a -static
# 部署运行（正常执行，无报错）
scp hello_arm_static pi@192.168.1.105:/home/pi/
ssh pi@192.168.1.105 "chmod +x hello_arm_static && ./hello_arm_static"
```
  验证静态链接效果（宿主端）：查看程序依赖，静态链接无动态依赖项：
  ```bash
  arm-linux-gnueabihf-readelf -d hello_arm_static | grep NEEDED
  # 预期输出：无任何内容（动态链接会显示"libc.so.6"）
  ```

3. 其他入门避坑补充
- 避坑1：工具链命令拼写错误（如`arm-linux-gcc`少写“gnueabihf”），导致编译的程序ABI不匹配，运行报错“Illegal instruction”——解决方案：严格使用`arm-linux-gnueabihf-gcc`（根据开发板ABI选择，无FPU的老旧板用`arm-linux-gnueabi-gcc`）；
- 避坑2：开发板运行时提示“Permission denied”——解决方案：执行`chmod +x 程序名`添加执行权限；
- 避坑3：scp部署时提示“no such file or directory”——解决方案：检查开发板目标路径是否存在（如`/home/pi/`是默认存在的，避免写`/home/pi/test/`（test目录可能不存在））。<br>

### <strong>实战总结</strong>

本实战通过“环境搭建→源码→编译→部署→运行”的完整流程，实现了ARM开发板的Hello World程序运行。
核心要点是：
1.  入门选择成熟工具链（Linaro）和静态链接，避免依赖兼容问题；
2.  SSH和scp是嵌入式开发中“部署+调试”的核心工具，必须掌握；
3.  遇到报错先看“关键词”（如“GLIBC”→libc版本问题，“Permission denied”→权限问题），针对性排查。

通过本实战，可建立交叉编译的基础认知，为后续内核模块、开源库交叉编译打下基础。<br>

---
