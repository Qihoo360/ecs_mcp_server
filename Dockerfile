# 使用Node.js镜像作为构建和运行环境

# 安装nginx
RUN apt-get update && \
    apt-get install -y nginx && \
    rm -rf /var/lib/apt/lists/*

# 创建nginx日志目录和SSL证书目录
RUN mkdir -p /data/nginx/logs /etc/ssl/nginx

# 禁用默认nginx配置，避免与挂载配置冲突
RUN rm -f /etc/nginx/sites-enabled/default

# 修改nginx默认配置，禁用IPv6监听
RUN sed -i 's/listen \[::\]:80 default_server;//g' /etc/nginx/sites-available/default && \
    sed -i 's/listen \[::\]:443 ssl default_server;//g' /etc/nginx/sites-available/default

# 添加自定义日志格式到nginx主配置
RUN sed -i '/http {/a\\n\t# 自定义日志格式\n\tlog_format combinedio '\''$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" $request_time $upstream_response_time'\'';' /etc/nginx/nginx.conf

COPY . /workspace

# 设置工作目录
WORKDIR /workspace

# 构建应用
RUN npm install && \
    npm run build

# 复制启动脚本并设置权限
COPY entrypoint.sh /etc/nginx/entrypoint.sh
RUN chmod +x /etc/nginx/entrypoint.sh

# 暴露端口
EXPOSE 80 443

# 启动服务
ENTRYPOINT ["/etc/nginx/entrypoint.sh"]
