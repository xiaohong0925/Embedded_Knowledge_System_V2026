import os

path = r'D:\MyCodeSpace\Linux_Knowledge\Embedded_Knowledge_System_V2026\docs\07-应用层开发\机器人专题\27-机器人专题.md'
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Check if already has history
if '历史演进' not in content and '演进' not in content:
    # Add history after first H1 or before summary
    idx = content.find('## 小结')
    if idx == -1:
        idx = len(content)
    
    history = '\n\n## 历史演进\n\n<span class="red">嵌入式机器人技术</span>的演进，映射了控制理论、计算平台与传感器技术的协同发展。\n\n上世纪 60 年代，Unimate 开启了工业机器人的先河，控制器基于专用硬件与固定逻辑。\n\n80 年代，随着微处理器性能提升，机器人开始引入可编程控制器（PLC），运动控制从硬编码转向软件化。\n\n2000 年代，嵌入式 Linux 进入机器人领域，ROS（Robot Operating System）于 2007 年发布，提供了标准化的进程间通信框架。\n\n2010 年后，深度学习革命推动了感知层智能化，NVIDIA Jetson 系列将 GPU 算力带入嵌入式平台。\n\n当前趋势是"云-边-端"协同：端侧负责实时控制，边缘侧负责 SLAM 与路径规划，云端负责大规模模型训练与地图更新。\n\n'
    content = content[:idx] + history + content[idx:]
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed 机器人专题 history')
else:
    print('Already has history')
