import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../../tools/index.js";
import { getAuthInfoFromRequest } from "../../utils/transport.js";

/**
 * SSE会话管理器
 * 每个会话都有独立的McpServer实例和transport，确保完全隔离
 */
interface SSESession {
  sessionId: string;
  mcpServer: McpServer;
  transport: SSEServerTransport;
  createdAt: number;
  lastActivity: number;
  isConnected: boolean;
  authInfo?: any;
}

/**
 * 扩展的鉴权信息提取函数，支持SSE特定的鉴权方式
 */
function getSSEAuthInfoFromRequest(req: any): any {
  // 首先使用通用的鉴权信息提取函数
  const baseAuthInfo = getAuthInfoFromRequest(req);
  
  // 创建扩展的鉴权信息对象
  const authInfo: any = {
    ...baseAuthInfo
  };
  
  // 对于SSE，还需要检查URL查询参数中的额外鉴权信息
  if (req.query) {
    // 支持更多的鉴权参数传递方式
    if (req.query.access_token) {
      authInfo.access_token = req.query.access_token as string;
    }
    if (req.query.qid) {
      authInfo.qid = req.query.qid as string;
    }
    if (req.query.token) {
      authInfo.token = req.query.token as string;
    }
    // 支持在URL中直接传递API_KEY
    if (!authInfo.apiKey && req.query.apiKey) {
      authInfo.apiKey = req.query.apiKey as string;
    }
    if (!authInfo.apiKey && req.query.API_KEY) {
      authInfo.apiKey = req.query.API_KEY as string;
    }
  }
  
  return authInfo;
}

/**
 * SSE会话管理器类
 */
class SSESessionManager {
  private sessions = new Map<string, SSESession>();
  private cleanupInterval: NodeJS.Timeout;
  private readonly CLEANUP_INTERVAL = 30 * 1000; // 30秒清理一次
  private readonly SESSION_TIMEOUT = 5 * 60 * 1000; // 5分钟会话超时

  constructor(private config: { name: string; version: string }) {
    // 启动清理定时器
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * 创建新会话
   */
  async createSession(transport: SSEServerTransport, authInfo?: any): Promise<SSESession> {
    // 创建独立的McpServer实例
    const mcpServer = new McpServer({
      name: this.config.name,
      version: this.config.version,
      responseInterceptor: (response: unknown) => {
        try {
          return typeof response === 'string' ? JSON.parse(response) : response;
        } catch (error) {
          console.warn('响应处理失败:', error);
          return { error: '响应处理失败' };
        }
      }
    });

    // 注册工具到这个独立的服务器实例
    registerAllTools(mcpServer);

    const session: SSESession = {
      sessionId: transport.sessionId,
      mcpServer,
      transport,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isConnected: true,
      authInfo
    };

    // 将认证信息添加到transport的上下文中
    // 这是关键：确保工具可以访问到鉴权信息
    if (authInfo) {
      (transport as any).httpContext = { authInfo };
      console.log(`🔐 会话鉴权信息已设置: ${session.sessionId.substring(0,8)}...`, {
        hasApiKey: !!authInfo.apiKey,
        ecsEnv: authInfo.ecsEnv || 'default'
      });
    } else {
      console.warn(`⚠️ 会话无鉴权信息: ${session.sessionId.substring(0,8)}...`);
    }

    // 连接McpServer到transport
    await mcpServer.connect(transport);

    this.sessions.set(session.sessionId, session);
    
    console.log(`✅ 创建新SSE会话: ${session.sessionId.substring(0,8)}...`);
    console.log(`📊 当前活跃会话数: ${this.sessions.size}`);
    
    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): SSESession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  /**
   * 移除会话
   */
  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.isConnected = false;
        // 关闭McpServer连接
        await session.mcpServer.close();
        console.log(`✅ 关闭SSE会话: ${sessionId.substring(0,8)}...`);
      } catch (error) {
        console.warn(`⚠️ 关闭会话时出错 ${sessionId.substring(0,8)}...:`, error);
      }
      
      this.sessions.delete(sessionId);
      console.log(`📊 当前活跃会话数: ${this.sessions.size}`);
    }
  }

  /**
   * 清理不活跃的会话
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      const inactive = now - session.lastActivity > this.SESSION_TIMEOUT;
      
      // 检查连接的真实状态
      const isReallyConnected = this.checkRealConnection(session);
      
      if (inactive || !session.isConnected || !isReallyConnected) {
        toRemove.push(sessionId);
        const reason = !isReallyConnected ? '连接已断开' : 
                      inactive ? `不活跃${Math.round((now - session.lastActivity) / 1000)}秒` : 
                      '标记为断开';
        console.log(`🧹 清理会话: ${sessionId.substring(0,8)}... (原因: ${reason})`);
      }
    }

    // 批量移除
    toRemove.forEach(sessionId => {
      this.removeSession(sessionId).catch(error => {
        console.warn(`清理会话失败 ${sessionId}:`, error);
      });
    });

    if (toRemove.length > 0) {
      console.log(`🧹 清理完成，移除 ${toRemove.length} 个会话`);
    }
  }

  /**
   * 检查连接的真实状态
   * 通过尝试写入SSE流来检测连接是否还存在
   */
  private checkRealConnection(session: SSESession): boolean {
    try {
      // 获取底层的Response对象
      const response = (session.transport as any).response;
      
      if (!response || response.destroyed || response.closed) {
        console.log(`🔍 检测到断开连接: ${session.sessionId.substring(0,8)}... (response状态异常)`);
        session.isConnected = false;
        return false;
      }

      // 尝试写入一个心跳消息来检测连接状态
      try {
        response.write('event: heartbeat\ndata: {}\n\n');
        return true;
      } catch (writeError: any) {
        console.log(`🔍 检测到断开连接: ${session.sessionId.substring(0,8)}... (写入失败: ${writeError.message})`);
        session.isConnected = false;
        return false;
      }
    } catch (error: any) {
      console.log(`🔍 连接检测异常: ${session.sessionId.substring(0,8)}... (${error.message})`);
      session.isConnected = false;
      return false;
    }
  }

  /**
   * 获取会话统计信息
   */
  getStats() {
    const now = Date.now();
    const active = Array.from(this.sessions.values()).filter(s => s.isConnected);
    const recentlyActive = active.filter(s => now - s.lastActivity < 60000); // 1分钟内活跃

    return {
      total: this.sessions.size,
      active: active.length,
      recentlyActive: recentlyActive.length,
      oldestSession: active.length > 0 ? Math.min(...active.map(s => s.createdAt)) : null,
      sessions: Array.from(this.sessions.entries()).map(([id, session]) => ({
        id: id.substring(0, 8) + '...',
        isConnected: session.isConnected,
        createdAt: new Date(session.createdAt).toISOString(),
        lastActivity: new Date(session.lastActivity).toISOString(),
        ageMinutes: Math.round((now - session.createdAt) / 60000),
        inactiveSeconds: Math.round((now - session.lastActivity) / 1000)
      }))
    };
  }

  /**
   * 销毁会话管理器
   */
  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // 关闭所有会话
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.removeSession(sessionId);
    }
  }
}

/**
 * 创建基于SSE的MCP服务器
 * @param config 服务器配置
 * @returns Express应用和启动函数
 */
export function createSSEServer(config: { 
  name: string; 
  version: string;
  port: number;
}) {
  const app = express();
  app.use(express.json());

  // 创建会话管理器
  const sessionManager = new SSESessionManager(config);

  // 统一中间件，提取鉴权信息
  app.use((req: any, res, next) => {
    req.authInfo = getSSEAuthInfoFromRequest(req);
    next();
  });

  // 添加CORS支持
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });
  
  // SSE事件流端点 - 使用完整URL路径
  app.get('/sse', async (req: any, res) => {
    try {      
      // 创建SSE transport，使用完整URL而不是相对路径
      const messagesUrl = `http://localhost:${config.port}/messages`;
      const transport = new SSEServerTransport(messagesUrl, res);
      
      console.log(`📍 Messages URL: ${messagesUrl}`);
      console.log(`🆔 Session ID: ${transport.sessionId.substring(0,8)}...`);

      // 创建会话，传递鉴权信息
      const session = await sessionManager.createSession(transport, req.authInfo);

      // 🆕 立即发送sessionId给客户端，确保客户端能够获取到sessionId
      try {
        const sessionIdMessage = JSON.stringify({
          type: 'session_info',
          sessionId: session.sessionId,
          messagesUrl: messagesUrl,
          timestamp: new Date().toISOString()
        });
        res.write(`data: ${sessionIdMessage}\n\n`);
        console.log(`📤 已发送sessionId给客户端: ${session.sessionId.substring(0,8)}...`);
      } catch (writeError) {
        console.warn(`⚠️ 发送sessionId失败:`, writeError);
      }

      // 监听连接关闭
      res.on("close", async () => {
        console.log(`🔚 SSE连接关闭: ${session.sessionId.substring(0,8)}...`);
        await sessionManager.removeSession(session.sessionId);
      });

      res.on("error", async (error) => {
        console.error(`❌ SSE连接错误 ${session.sessionId.substring(0,8)}...:`, error);
        await sessionManager.removeSession(session.sessionId);
      });

    } catch (error) {
      console.error('❌ 创建SSE连接失败:', error);
      res.status(500).send('创建SSE连接失败');
    }
  });
  
  // 消息处理端点
  app.post('/messages', async (req: any, res) => {
    // 🆕 改进sessionId获取方式，支持多种传递方式
    let sessionId = req.query.sessionId as string;
    
    // 如果URL参数中没有sessionId，尝试从请求头获取
    if (!sessionId) {
      sessionId = req.headers['x-session-id'] as string || 
                  req.headers['session-id'] as string ||
                  req.headers['mcp-session-id'] as string;
    }
    
    // 如果请求头中也没有，尝试从请求体获取
    if (!sessionId && req.body && req.body.sessionId) {
      sessionId = req.body.sessionId;
    }
    
    if (!sessionId) {
      console.warn(`⚠️ 未提供会话ID，支持的传递方式:`, {
        urlParam: '?sessionId=xxx',
        headers: ['X-Session-Id', 'Session-Id', 'MCP-Session-Id'],
        body: 'body.sessionId',
        activeSessions: Array.from(sessionManager['sessions'].keys()).map(id => id.substring(0,8) + '...')
      });
      res.status(400).json({ 
        error: '缺失会话ID参数',
        details: '请通过URL参数(?sessionId=xxx)、请求头(X-Session-Id)或请求体(body.sessionId)提供会话ID',
        activeSessions: Array.from(sessionManager['sessions'].keys()).map(id => id.substring(0,8) + '...')
      });
      return;
    }

    const session = sessionManager.getSession(sessionId);
    
    if (!session) {
      console.warn(`⚠️ 未找到会话: ${sessionId.substring(0,8)}...`);
      console.warn(`⚠️ 当前活跃会话:`, Array.from(sessionManager['sessions'].keys()).map(id => id.substring(0,8) + '...'));
      res.status(400).json({ 
        error: '未找到指定会话ID的传输实例',
        providedSessionId: sessionId.substring(0,8) + '...',
        activeSessions: Array.from(sessionManager['sessions'].keys()).map(id => id.substring(0,8) + '...')
      });
      return;
    }

    if (!session.isConnected) {
      console.warn(`⚠️ 会话已断开: ${sessionId.substring(0,8)}...`);
      res.status(400).json({ error: '会话已断开连接' });
      return;
    }

    try {
      // 合并请求中的新鉴权信息和会话中存储的鉴权信息
      const requestAuthInfo = getSSEAuthInfoFromRequest(req);
      const mergedAuthInfo = {
        ...session.authInfo,
        ...requestAuthInfo
      };
      
      // 确保使用会话中存储的鉴权信息，如果请求中没有新的鉴权信息
      if (!mergedAuthInfo.apiKey && session.authInfo?.apiKey) {
        mergedAuthInfo.apiKey = session.authInfo.apiKey;
      }
      if (!mergedAuthInfo.ecsEnv && session.authInfo?.ecsEnv) {
        mergedAuthInfo.ecsEnv = session.authInfo.ecsEnv;
      }
      
      // 更新req的authInfo为合并后的信息
      req.authInfo = mergedAuthInfo;
      
      // ✅ 正确的上下文传递方式：设置httpContext为一个动态返回当前请求信息的函数
      (session.transport as any).httpContext = () => ({
        authInfo: mergedAuthInfo,
        requestId: req.requestId || `sse-${session.sessionId.substring(0,8)}-${Date.now()}`
      });

      // 处理消息 (不再需要向body注入信息)
      await session.transport.handlePostMessage(req, res, req.body);
      
      console.log(`📤 消息处理完成 (会话: ${sessionId.substring(0,8)}...)`);
      
    } catch (error) {
      console.error(`❌ 消息处理失败 (会话: ${sessionId.substring(0,8)}...):`, error);
      res.status(500).json({ 
        error: '消息处理失败',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // 添加连接清理端点（用于客户端主动清理连接）
  app.post('/cleanup-connections', async (req, res) => {
    try {
      const stats = sessionManager.getStats();
      console.log('🧹 收到连接清理请求，当前状态:', stats);
      
      // 这里可以添加额外的清理逻辑，但主要的清理工作由定时器处理
      res.json({ 
        message: '连接清理请求已处理',
        stats: {
          total: stats.total,
          active: stats.active,
          recentlyActive: stats.recentlyActive
        }
      });
    } catch (error) {
      console.error('连接清理失败:', error);
      res.status(500).json({ error: '连接清理失败' });
    }
  });

  // 添加状态监控端点
  app.get('/status', (req, res) => {
    const stats = sessionManager.getStats();
    res.json({
      server: {
        name: config.name,
        version: config.version,
        port: config.port,
        transport: 'SSE',
        uptime: process.uptime()
      },
      sessions: stats
    });
  });
  
  // 提供改进的状态页面
  app.get('/', (req, res) => {
    const stats = sessionManager.getStats();
    res.send(`
      <html>
        <head>
          <title>MCP服务器 - ${config.name}</title>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }
            .stats { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .endpoint { background: #e8f4f8; padding: 10px; border-radius: 4px; margin: 10px 0; font-family: monospace; }
            .session { background: #fff; border: 1px solid #ddd; padding: 10px; margin: 5px 0; border-radius: 4px; }
            .active { border-left: 4px solid #4CAF50; }
            .inactive { border-left: 4px solid #ff9800; }
          </style>
        </head>
        <body>
          <h1>🚀 MCP服务器正在运行</h1>
          <div class="stats">
            <h2>📊 服务器状态</h2>
            <p><strong>名称:</strong> ${config.name}</p>
            <p><strong>版本:</strong> ${config.version}</p>
            <p><strong>传输方式:</strong> SSE (Server-Sent Events)</p>
            <p><strong>运行时间:</strong> ${Math.round(process.uptime())}秒</p>
          </div>
          
          <div class="stats">
            <h2>🔗 API端点</h2>
            <div class="endpoint">SSE端点: http://localhost:${config.port}/sse</div>
            <div class="endpoint">消息端点: http://localhost:${config.port}/messages</div>
            <div class="endpoint">状态API: http://localhost:${config.port}/status</div>
            <div class="endpoint">清理连接: http://localhost:${config.port}/cleanup-connections</div>
          </div>

          <div class="stats">
            <h2>🔐 鉴权配置说明</h2>
            <p><strong>支持的API_KEY传递方式：</strong></p>
            <div class="endpoint">URL参数: http://localhost:${config.port}/sse?apiKey=YOUR_API_KEY</div>
            <div class="endpoint">HTTP请求头: X-API-Key: YOUR_API_KEY</div>
            <div class="endpoint">Authorization头: Authorization: Bearer YOUR_API_KEY</div>
            <div class="endpoint">环境变量: API_KEY=YOUR_API_KEY</div>
            <p><strong>可选参数：</strong></p>
            <div class="endpoint">环境配置: ?ecsEnv=prod 或 ?ecsEnv=test (默认为prod)</div>
            <div class="endpoint">已有Token: ?access_token=TOKEN&qid=QID</div>
          </div>

          <div class="stats">
            <h2>📈 会话统计</h2>
            <p><strong>总会话数:</strong> ${stats.total}</p>
            <p><strong>活跃会话:</strong> ${stats.active}</p>
            <p><strong>最近活跃:</strong> ${stats.recentlyActive}</p>
            ${stats.oldestSession ? `<p><strong>最早会话:</strong> ${new Date(stats.oldestSession).toLocaleString()}</p>` : ''}
          </div>

          ${stats.sessions.length > 0 ? `
          <div class="stats">
            <h2>🔍 会话详情</h2>
            ${stats.sessions.map(session => `
              <div class="session ${session.isConnected ? 'active' : 'inactive'}">
                <strong>会话 ${session.id}</strong> 
                ${session.isConnected ? '🟢 连接中' : '🔴 已断开'}<br>
                创建时间: ${new Date(session.createdAt).toLocaleString()}<br>
                最后活动: ${new Date(session.lastActivity).toLocaleString()}<br>
                存活时间: ${session.ageMinutes}分钟，不活跃: ${session.inactiveSeconds}秒
              </div>
            `).join('')}
          </div>
          ` : ''}

          <script>
            // 每30秒刷新页面以更新状态
            setTimeout(() => window.location.reload(), 30000);
          </script>
        </body>
      </html>
    `);
  });

  // 优雅关闭处理
  process.on('SIGTERM', async () => {
    console.log('🛑 收到SIGTERM信号，开始优雅关闭...');
    await sessionManager.destroy();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('🛑 收到SIGINT信号，开始优雅关闭...');
    await sessionManager.destroy();
    process.exit(0);
  });
  
  return {
    app,
    sessionManager,
    start: () => {
      const server = app.listen(config.port, () => {
        console.log(`🚀 MCP服务器已启动(SSE传输)，端口: ${config.port}`);
        console.log(`📍 SSE端点: http://localhost:${config.port}/sse`);
        console.log(`📍 状态页面: http://localhost:${config.port}/`);
        console.log(`📍 状态API: http://localhost:${config.port}/status`);
        console.log(`⚡ 使用完整URL路径，兼容更多MCP客户端`);
      });

      return server;
    }
  };
}
