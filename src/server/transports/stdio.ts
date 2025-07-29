import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ECSMcpServer } from "../index.js";

/**
 * 启动基于STDIO的MCP服务器
 * @param config 服务器配置
 * @returns 服务器和传输实例
 */
export async function startStdioServer(config: { name: string; version: string }) {
  const ecsMcpServer = new ECSMcpServer(config);
  const server = ecsMcpServer.getServer();
  
  // 创建transport实例
  const transport = new StdioServerTransport();
  
  // 添加错误处理
  process.stdin.on('error', (error) => {
    console.error('STDIO输入错误:', error);
  });
  
  process.stdout.on('error', (error) => {
    console.error('STDIO输出错误:', error);
  });
  
  await server.connect(transport);
  
  console.log("MCP服务器已启动(STDIO传输)");
  
  return { server, transport };
} 