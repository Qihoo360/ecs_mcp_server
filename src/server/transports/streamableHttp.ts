import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ECSMcpServer } from "../index.js";
import { getAuthInfoFromRequest } from "../../utils/transport.js";

interface ServerConfig {
  name: string;
  version: string;
  port: number;
  sessionMode?: 'stateful' | 'stateless'; // 添加会话模式配置：stateful(有状态)或stateless(无状态)
  cors?: {
    origin?: string | string[];
    credentials?: boolean;
  };
}

/**
 * 创建基于Streamable HTTP的MCP服务器
 * @param config 服务器配置
 * @returns Express应用和启动函数
 */
export function createStreamableHttpServer(config: ServerConfig) {
  const app = express();
  
  // 使用JSON解析中间件
  app.use(express.json());

  // 提取API_KEY并存储在req对象中
  app.use((req: any, res, next) => {
    // 提取API_KEY并存储在req对象中
    req.authInfo = getAuthInfoFromRequest(req);
    
    // ✅ 增强调试：添加请求ID以便跟踪并发请求
    req.requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    // console.log(`[${req.requestId}] req.authInfo`, req.authInfo);
    next();
  });

  // 存储会话传输实例
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  // 确定当前使用的会话模式，默认为有状态模式
  const sessionMode = config.sessionMode || 'stateful';
  // console.log(`MCP服务器运行模式: ${sessionMode}`);

  // 处理客户端到服务器的POST请求
  app.post('/mcp', async (req: any, res) => {
    try {
      if (sessionMode === 'stateless') {
        // 无状态模式：为每个请求创建新的服务器和传输实例
        const ecsMcpServer = new ECSMcpServer({ name: config.name, version: config.version });
        const server = ecsMcpServer.getServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        res.on('close', () => {
          transport.close();
          server.close();
        });

        await server.connect(transport);
        
        // ✅ 正确的上下文传递方式：将会话上下文设置为一个动态返回当前请求信息的函数
        (transport as any).httpContext = () => ({
          authInfo: req.authInfo,
          requestId: req.requestId,
        });
        
        await transport.handleRequest(req, res, req.body);
      } else {
        // 有状态模式：复用或创建传输实例
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        const isInitRequest = isInitializeRequest(req.body);

        if (sessionId && transports[sessionId]) {
          // 复用已存在的传输实例
          transport = transports[sessionId];
          
          // 之前的错误修改已被移除
          
        } else if (!sessionId && isInitRequest) {
          // 为新会话创建独立的服务器和传输实例
          const ecsMcpServer = new ECSMcpServer({ name: config.name, version: config.version });
          const server = ecsMcpServer.getServer();

          // 处理新的初始化请求
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              transports[newSessionId] = transport;
              // console.log(`新会话已创建: ${newSessionId}`);
            }
          });

          // 清理关闭的传输实例
          transport.onclose = () => {
            if (transport.sessionId) {
              delete transports[transport.sessionId];
              // console.log(`会话已关闭: ${transport.sessionId}`);
            }
          };

          // 连接到MCP服务器
          await server.connect(transport);
        } else {
          // 有状态模式下的无效请求
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: '错误的请求：未提供有效的会话ID',
            },
            id: req.body?.id ?? null,
          });
          return;
        }
        
        // ✅ 正确的上下文传递方式：将会话上下文设置为一个动态返回当前请求信息的函数
        (transport as any).httpContext = () => ({
          authInfo: req.authInfo,
          requestId: req.requestId,
        });

        // 处理请求
        await transport.handleRequest(req, res, req.body);
      }
    } catch (err: any) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: '服务器内部错误',
          data: err.message
        },
        id: req.body?.id ?? null
      });
    }
  });

  // 通用的会话请求处理函数
  const handleSessionRequest = async (req: express.Request, res: express.Response) => {
    // 无状态模式下，会话相关的请求不适用
    if (sessionMode === 'stateless') {
      res.status(400).send('无状态模式下不支持会话操作');
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('无效或缺失的会话ID');
      return;
    }
    
    try {
      const transport = transports[sessionId];
      // ✅ 为GET和DELETE请求也设置动态上下文
      (transport as any).httpContext = () => ({
        authInfo: (req as any).authInfo,
        requestId: (req as any).requestId,
      });
      await transport.handleRequest(req, res);
    } catch (err: any) {
      res.status(500).send('服务器内部错误');
    }
  };

  // 处理服务器到客户端的SSE通知
  app.get('/mcp', handleSessionRequest);

  // 处理会话终止请求
  app.delete('/mcp', handleSessionRequest);

  // 健康检查端点
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: config.version,
      sessionMode: sessionMode,
      activeSessions: Object.keys(transports).length,
      sessionDetails: sessionMode === 'stateless' 
        ? '临时会话将在1分钟内自动清理' 
        : '有状态模式下会话将持续到客户端断开连接'
    });
  });

  // 状态页面
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCP服务器 - ${config.name}</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 2rem; }
            code { background: #f0f0f0; padding: 0.2rem 0.4rem; border-radius: 3px; }
            .endpoint { margin: 1rem 0; }
            .mode-info { background: #f9f9f9; padding: 1rem; border-radius: 5px; margin: 1rem 0; }
            .stateless-info { color: #0066cc; }
            .stateful-info { color: #009900; }
          </style>
        </head>
        <body>
          <h1>MCP服务器正在运行</h1>
          <p>版本: ${config.version}</p>
          <p>传输方式: Streamable HTTP</p>
          <p>会话模式: <strong class="${sessionMode === 'stateless' ? 'stateless-info' : 'stateful-info'}">${sessionMode}</strong></p>
          
          <div class="mode-info">
            ${sessionMode === 'stateless' ? `
            <h3>无状态模式 (Stateless) 信息</h3>
            <p>在无状态模式下:</p>
            <ul>
              <li>初始化请求会创建临时会话，有效期1分钟</li>
              <li>客户端应保存服务器返回的会话ID并在后续请求中使用</li>
              <li>临时会话将自动清理，不保持长期状态</li>
            </ul>
            ` : `
            <h3>有状态模式 (Stateful) 信息</h3>
            <p>在有状态模式下:</p>
            <ul>
              <li>会话将持续存在直到客户端断开连接</li>
              <li>服务器保持完整的会话状态</li>
              <li>支持复杂的多轮交互场景</li>
            </ul>
            `}
          </div>
        </body>
      </html>
    `);
  });

  return {
    app,
    start: () => {
      const server = app.listen(config.port, () => {
        console.log(`MCP服务器已启动(Streamable HTTP传输)，端口: ${config.port}，模式: ${sessionMode}`);
      });

      // 优雅关闭
      process.on('SIGTERM', () => {
        console.log('收到SIGTERM信号，正在关闭服务器...');
        server.close(() => {
          console.log('服务器已关闭');
          process.exit(0);
        });
      });
    }
  };
}
