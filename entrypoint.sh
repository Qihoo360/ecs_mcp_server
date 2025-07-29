#!/bin/bash

# 启动Node API服务 - 同时启动HTTP和SSE服务
echo "启动Node API服务..."
cd /workspace
node build/index.js --http --sse &
NODE_PID=$!

# 等待Node.js服务启动
echo "等待Node.js服务启动..."
sleep 5

# 检查Node.js服务是否正常启动
if ! kill -0 $NODE_PID 2>/dev/null; then
    echo "错误: Node.js服务启动失败"
    exit 1
fi

echo "Node.js服务已启动 (PID: $NODE_PID)"
echo "HTTP服务: http://localhost:5000"
echo "SSE服务: http://localhost:5001"

# 启动Nginx
echo "启动Nginx服务..."

# 检查挂载的nginx配置文件
if [ -f /tmp/ecs-mcp/nginx/nginx.conf ]; then
    echo "发现挂载的nginx配置文件: /tmp/ecs-mcp/nginx/nginx.conf"
    # 将配置文件链接到nginx配置目录
    ln -sf /tmp/ecs-mcp/nginx/nginx.conf /etc/nginx/conf.d/ecsmcp.conf
    echo "nginx配置已加载"
else
    echo "警告: 未找到挂载的nginx配置文件 /tmp/ecs-mcp/nginx/nginx.conf"
    echo "请确保在运行容器时正确挂载nginx配置文件"
    echo "示例: docker run -v /path/to/nginx.conf:/tmp/ecs-mcp/nginx/nginx.conf ..."
fi

# 检查挂载的SSL证书文件
if [ ! -f /etc/ssl/nginx/tls.crt ] || [ ! -f /etc/ssl/nginx/tls.key ]; then
    echo "警告: SSL证书文件不存在"
    echo "请确保在运行容器时正确挂载SSL证书文件："
    echo "  -v /path/to/tls.crt:/etc/ssl/nginx/tls.crt"
    echo "  -v /path/to/tls.key:/etc/ssl/nginx/tls.key"
    echo "注意: 缺少SSL证书可能导致HTTPS访问失败，但不影响容器启动"
else
    echo "SSL证书文件检查通过"
fi

# 测试nginx配置
echo "测试nginx配置..."
nginx -t

if [ $? -ne 0 ]; then
    echo "错误: nginx配置测试失败"
    echo "请检查挂载的nginx配置文件是否正确"
    kill $NODE_PID 2>/dev/null
    exit 1
fi

# 启动nginx（前台运行）
echo "nginx配置测试通过，启动nginx服务..."
nginx -g "daemon off;"
