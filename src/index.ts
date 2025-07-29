#!/usr/bin/env node
import { loadConfig } from './utils/config.js';
import { startStdioServer } from './server/transports/stdio.js';
import { createStreamableHttpServer } from './server/transports/streamableHttp.js';
import { createSSEServer } from './server/transports/sse.js';

/**
 * 主函数：启动MCP服务器
 */
async function main() {
  const config = loadConfig();

  const args = process.argv.slice(2); // 获取命令行参数，忽略 'node' 和脚本路径

  let startStdio = false;
  let startHttp = false;
  let startSse = false;

  if (args.length === 0 || args.includes('--all')) {
    // 如果没有参数或包含 --all，则启动所有服务
    startStdio = true;
    startHttp = true;
    startSse = true;
  } else {
    if (args.includes('--stdio')) {
      startStdio = true;
    }
    if (args.includes('--http')) {
      startHttp = true;
    }
    if (args.includes('--sse')) {
      startSse = true;
    }
  }

  if (startStdio) {
    try {
      await startStdioServer({
        name: config.name,
        version: config.version
      });
    } catch (error) {
      console.error('启动 stdio 服务器失败:', error);
    }
  }

  if (startHttp) {
    try {
      const httpServer = createStreamableHttpServer({
        name: config.name,
        version: config.version,
        port: 5000
      });
      httpServer.start();
    } catch (error) {
      console.error('启动Streamable HTTP服务器失败:', error);
    }
  }

  if (startSse) {
    try {
      const sseServer = createSSEServer({
        name: config.name,
        version: config.version,
        port: 5001
      });
      sseServer.start();
      console.log(`SSE服务器已启动，端口: 5001`);
    } catch (error) {
      console.error('启动SSE服务器失败:', error);
    }
  }

  if (!startStdio && !startHttp && !startSse && args.length > 0 && !args.includes('--all')) {
    console.warn('没有指定有效的服务类型启动，请使用 --stdio, --http, --sse, 或 --all。');
  }
}

// 启动服务器
main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
