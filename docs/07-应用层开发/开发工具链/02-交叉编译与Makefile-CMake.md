# 交叉编译与Makefile/CMake

> 📊 **本章难度等级：** <span class="badge-i">**I级 (Intermediate)**</span>

---

## 交叉编译器配置

---

### <strong>环境变量与编译标志</strong>

<span class="badge-i">I</span><br>
<span class="red">交叉编译环境的配置</span>需要设置正确的环境变量，确保编译器、链接器和调试器均指向目标架构工具。
<br>
核心变量包括CC（C编译器）、CXX（C++编译器）、AR（归档工具）、LD（链接器）和CFLAGS/LDFLAGS。
<br>

```bash
# 交叉编译环境变量配置脚本
# 文件路径：env/setup_cross_env.sh
export CROSS_COMPILE=arm-linux-gnueabihf-
export CC=${CROSS_COMPILE}gcc
export CXX=${CROSS_COMPILE}g++
export AR=${CROSS_COMPILE}ar
export LD=${CROSS_COMPILE}ld
export STRIP=${CROSS_COMPILE}strip

# 目标架构优化标志
export CFLAGS="-march=armv7-a -mtune=cortex-a9 \
               -mfpu=vfpv3-d16 -mfloat-abi=hard \
               -O2 -pipe"
export LDFLAGS="-Wl,--hash-style=gnu"

# 指定sysroot（若使用自定义SDK）
export SYSROOT=/opt/my-sdk/sysroot
export CFLAGS="${CFLAGS} --sysroot=${SYSROOT}"
export LDFLAGS="${LDFLAGS} --sysroot=${SYSROOT}"
```

<span class="orange"><strong>1. CROSS_COMPILE前缀：</strong></span>统一前缀变量便于切换工具链版本或架构。
<br>
<span class="orange"><strong>2. -march与-mtune：</strong></span>-march指定指令集架构，-mtune指定微架构优化目标，两者可组合使用。
<br>
<span class="orange"><strong>3. --sysroot：</strong></span>确保头文件和库文件来自目标机SDK，而非宿主机系统。
<br>

<span class="blue">配置原则：环境变量脚本应在CI/CD和开发环境中复用，避免"每个工程师手动配置"带来的不一致风险。</span><br>

---

## Makefile变量与规则

---

### <strong>嵌入式项目的Makefile设计</strong>

<span class="badge-i">I</span><br>
<span class="red">Makefile</span>是嵌入式项目最常见的构建系统，掌握变量、规则、模式规则和自动推导是高效开发的基础。
<br>

```makefile
# 嵌入式项目Makefile示例
# 文件路径：Makefile
# 行号：1-50
CROSS_COMPILE ?= arm-linux-gnueabihf-
CC      := $(CROSS_COMPILE)gcc
CXX     := $(CROSS_COMPILE)g++
LD      := $(CROSS_COMPILE)gcc  # 使用gcc驱动链接
STRIP   := $(CROSS_COMPILE)strip

# 编译标志
CFLAGS  := -march=armv7-a -mtune=cortex-a9 \
           -mfpu=vfpv3-d16 -mfloat-abi=hard \
           -O2 -g -Wall -Wextra -ffunction-sections -fdata-sections
LDFLAGS := -Wl,--gc-sections -Wl,--hash-style=gnu

# 目录结构
SRC_DIR := src
OBJ_DIR := build
BIN     := $(OBJ_DIR)/app

# 源文件与目标文件
SRCS    := $(wildcard $(SRC_DIR)/*.c)
OBJS    := $(patsubst $(SRC_DIR)/%.c,$(OBJ_DIR)/%.o,$(SRCS))

# 默认目标
all: $(BIN)

# 链接规则
$(BIN): $(OBJS)
	@mkdir -p $(OBJ_DIR)
	$(LD) $(LDFLAGS) $^ -o $@

# 编译规则（模式规则）
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.c
	@mkdir -p $(OBJ_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

# 烧录目标（假设使用OpenOCD）
flash: $(BIN)
	$(STRIP) $(BIN)
	openocd -f interface/stlink.cfg \
	        -f target/stm32f4x.cfg \
	        -c "program $(BIN) verify reset exit"

# 清理
clean:
	rm -rf $(OBJ_DIR)

.PHONY: all clean flash
```

<span class="orange"><strong>1. 交叉编译变量：</strong></span>CROSS_COMPILE前缀统一控制所有工具链程序。
<br>
<span class="orange"><strong>2. --gc-sections：</strong></span>配合-ffunction-sections和-fdata-sections，链接器自动删除未使用的函数和数据段，减小二进制体积。
<br>
<span class="orange"><strong>3. 模式规则：</strong></span>$(OBJ_DIR)/%.o: $(SRC_DIR)/%.c 实现源文件到目标文件的批量编译。
<br>

<span class="blue">Makefile进阶：对于大型项目，应将Makefile拆分为顶层Makefile和子目录Makefile，使用include引入公共变量定义。</span><br>

---

## CMake交叉编译链文件

---

### <strong>CMake的嵌入式项目配置</strong>

<span class="badge-i">I</span><br>
<span class="red">CMake</span>通过<span class="green">工具链文件（Toolchain File）</span>抽象交叉编译配置，实现"一次编写，多平台构建"。
<br>
工具链文件定义目标系统的处理器、操作系统、编译器和查找路径，CMake据此自动配置整个构建系统。
<br>

```cmake
# CMake工具链文件示例
# 文件路径：cmake/arm-linux-gnueabihf.cmake
# 行号：1-35
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER arm-linux-gnueabihf-gcc)
set(CMAKE_CXX_COMPILER arm-linux-gnueabihf-g++)
set(CMAKE_AR arm-linux-gnueabihf-ar)
set(CMAKE_STRIP arm-linux-gnueabihf-strip)

# 指定sysroot
set(CMAKE_SYSROOT /opt/my-sdk/sysroot)
set(CMAKE_FIND_ROOT_PATH ${CMAKE_SYSROOT})

# 查找规则：仅在sysroot中查找库和头文件
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# 默认编译标志
set(CMAKE_C_FLAGS_INIT "-march=armv7-a -mtune=cortex-a9 \
                        -mfpu=vfpv3-d16 -mfloat-abi=hard \
                        -O2 -pipe")
set(CMAKE_EXE_LINKER_FLAGS_INIT "-Wl,--gc-sections")
```

```bash
# 使用工具链文件构建
$ cmake -B build \
    -DCMAKE_TOOLCHAIN_FILE=cmake/arm-linux-gnueabihf.cmake \
    -DCMAKE_BUILD_TYPE=Release \
    -S .
$ cmake --build build
```

<span class="blue">CMake优势：工具链文件将交叉编译配置集中管理，团队成员只需一条命令即可复现构建环境，避免了Makefile中分散的变量配置。</span><br>

---

## 编译优化选项

---

### <strong>嵌入式优化的常用GCC标志</strong>

<span class="badge-i">I</span><br>
<span class="red">编译优化</span>在嵌入式中需要在执行速度、代码体积和调试便利性之间权衡。
<br>

| 优化级别 | 标志 | 速度 | 体积 | 调试友好性 | 适用场景 |
|---------|------|------|------|-----------|---------|
| 无优化 | -O0 | 慢 | 大 | 最佳 | 开发调试 |
| 基本优化 | -O1 | 中等 | 减小 | 较好 | 快速测试 |
| 标准优化 | -O2 | 快 | 中等 | 一般 | 发布版本 |
| 激进优化 | -O3 | 最快 | 可能增大 | 差 | 计算密集型 |
| 体积优化 | -Os | 中等 | 最小 | 一般 | 存储受限 |
| 快速调试 | -Og | 中等 | 中等 | 好 | 优化调试平衡 |

```bash
# 嵌入式推荐优化组合
# 速度优先：
$ arm-linux-gnueabihf-gcc -O2 -march=armv7-a -mtune=cortex-a9 \
    -DNDEBUG -ffunction-sections -fdata-sections \
    -Wl,--gc-sections -o app_speed app.c

# 体积优先：
$ arm-linux-gnueabihf-gcc -Os -march=armv7-a \
    -ffunction-sections -fdata-sections \
    -Wl,--gc-sections -flto \
    -o app_size app.c
```

<span class="orange"><strong>1. -ffunction-sections：</strong></span>为每个函数生成独立的section，便于链接器精确裁剪未使用函数。
<br>
<span class="orange"><strong>2. -DNDEBUG：</strong></span>禁用assert宏，减少运行时代码体积和分支开销。
<br>
<span class="orange"><strong>3. -flto：</strong></span>链接时优化，跨编译单元进行函数内联和死代码删除，显著提升体积和速度。
<br>

<span class="blue">优化原则：调试阶段使用-Og或-O0保证调试符号准确；发布阶段使用-O2或-Os配合LTO；永远不要在-O3下发布未经充分测试的代码。</span><br>

---

## 静态vs动态链接

---

### <strong>链接方式的选择与影响</strong>

<span class="badge-i">I</span><br>
<span class="red">静态链接</span>将库代码嵌入可执行文件，<span class="red">动态链接</span>在运行时从共享库加载，两者在嵌入式中有截然不同的适用场景。
<;br>

| 维度 | 静态链接 | 动态链接 |
|------|---------|---------|
| 可执行文件体积 | 大（包含库代码） | 小（仅引用） |
| 运行时内存 | 代码段不可共享 | 共享库代码段可被多进程共享 |
| 启动速度 | 快（无动态解析） | 慢（符号解析+重定位） |
| 依赖管理 | 无运行时依赖 | 需确保目标机存在对应版本.so |
| 更新维护 | 需重新编译整个程序 | 单独替换.so即可 |
| 适用场景 | 单进程固件、救援程序 | 多进程系统、频繁更新组件 |

```bash
# 静态链接构建
$ arm-linux-gnueabihf-gcc -static -o app_static app.c -lpthread
# 生成的ELF包含所有依赖代码，不依赖任何.so

# 动态链接构建
$ arm-linux-gnueabihf-gcc -o app_dynamic app.c -lpthread
# 运行时依赖/lib/libpthread.so.0等共享库

# 查看动态依赖
$ arm-linux-gnueabihf-readelf -d app_dynamic | grep NEEDED
  NEEDED      libpthread.so.0
  NEEDED      libc.so.6
```

<span class="blue">嵌入式建议：固件烧录型设备（路由器、传感器）倾向静态链接；运行Linux的多进程系统（网关、工业控制器）倾向动态链接以节省内存。</span><;br>

---

## 历史演进与小结

---

### <strong>构建系统演进</strong>

<span class="badge-i">I</span><;br>

| 年代 | 事件 | 意义 |
|------|------|------|
| 1977 | make工具诞生 | 构建自动化起点 |
| 1988 | GNU make | 模式规则、自动推导 |
| 2000 | CMake 1.0 | 跨平台构建抽象 |
| 2006 | SCons/Autotools | Python-based/Unix标准 |
| 2015 | CMake 3.x | 现代目标模型、导入目标 |
| 2019 | Meson崛起 | 更快的配置和构建速度 |

---

## 本章小结

| 要点 | 核心结论 |
|------|---------|
| 交叉编译配置 | 环境变量+sysroot+架构标志 |
| Makefile | 变量+模式规则+--gc-sections体积优化 |
| CMake | 工具链文件实现一次配置多平台复用 |
| 优化选项 | -O2速度/-Os体积，-flto跨单元优化 |
| 链接方式 | 静态无依赖体积大，动态共享省内存 |

---

## 课后练习

1. **Makefile编写**：为一个包含5个.c文件和2个头文件目录的嵌入式项目编写Makefile，要求支持交叉编译、增量编译和体积优化。<;br>
2. **CMake迁移**：将上述Makefile项目迁移为CMake构建，编写工具链文件和CMakeLists.txt。<;br>
3. **优化实验**：同一程序分别用-O0、-O2、-Os、-O2 -flto编译，对比生成的ARM ELF文件大小和反汇编代码复杂度。<;br>
