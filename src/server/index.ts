import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { registerAllTools } from "../tools/index.js";

export class ECSMcpServer {
  private server: McpServer;

  constructor(config: { name: string; version: string }) {
    this.server = new McpServer({
      ...config,
      responseInterceptor: (response: unknown) => {
        try {
          return typeof response === 'string' ? JSON.parse(response) : response;
        } catch (error) {
          return { error: '响应处理失败' };
        }
      }
    }, {
      // 声明服务器支持的能力
      capabilities: {
        logging: {},    // 支持日志通知，允许工具发送实时进度和状态消息
        tools: {        // 支持工具相关功能
          listChanged: true  // 支持工具列表变更通知
        }
      }
    });
    
    // 注册工具
    this.registerTools();
  }

  private registerTools() {
    // 注册所有工具
    registerAllTools(this.server);
  }

  public getServer(): McpServer {
    return this.server;
  }
}

export { Server }; 