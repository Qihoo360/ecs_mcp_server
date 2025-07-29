/**
 * 这是一个已被移除的函数，因为它导致了竞争条件。
 * 新的方案将不再使用这个函数。
 */
// export const addParamToTransportHttpContext = (transport: any, req: any) => { ... };


/**
 * 统一获取HTTP上下文的函数（重构后版本）
 * 
 * @param mcpReq - 传递给工具的MCP请求对象。
 * @param server - McpServer实例，用于访问当前的transport。
 * @returns 包含authInfo和requestId的上下文对象。
 * 
 * 工作原理:
 * 1.  它首先检查 transport 实例上是否存在 `httpContext` 属性。
 * 2.  SDK的设计允许 `httpContext` 是一个返回对象的函数。我们的实现将利用这一点。
 * 3.  在 streamableHttp.ts 和 sse.ts 中，我们会将 `httpContext` 设置为一个函数，
 *     该函数会捕获当前请求的 `req` 对象，从而能够动态地返回包含最新 `authInfo` 和 `requestId` 的对象。
 * 4.  当此函数被调用时，它执行 `httpContext` 函数，获取与当前请求关联的、最新的上下文。
 * 5.  这种方式避免了直接修改共享的 transport 对象，同时又利用了 SDK 提供的上下文传递机制，是安全且符合预期的。
 */
export const gethttpContext = (mcpReq: any, server: any) => {
  // 获取当前活跃的 transport 实例
  const transport = (server as any).server?.transport || (server as any).transport;
  
  if (transport?.httpContext) {
    const contextSource = transport.httpContext;
    
    // 如果 httpContext 是一个函数，则执行它以获取动态生成的上下文
    if (typeof contextSource === 'function') {
      // 传递 mcpReq，以备 httpContext 函数需要它来构造上下文
      return contextSource(mcpReq) || {};
    }
    // 如果它只是一个普通对象，则直接返回
    return contextSource || {};
  }
  
  // 如果没有 httpContext，则返回一个空对象作为后备
  return {};
};


export const getAuthInfoFromRequest = (req: any) => {
  const apiKey = (req.headers['x-api-key'] ||
    req.headers['authorization'] ||
    '').toString().replace('Bearer ', '') ||
    (req.query.api_key as string) ||
    (req.body && req.body.api_key);
  const ecsEnv = (req.headers['x-ecs-env'] ||
    req.headers['ecs-env'] ||
    '').toString() ||
    (req.query.ecs_env as string) ||
    (req.body && req.body.ecs_env);
  return { apiKey, ecsEnv };
}
