/**
 * 工具调用超时时间配置
 * 
 * 这些配置定义了不同类型工具的推荐超时时间
 * 客户端可以根据这些建议设置合适的超时时间
 */
export const TOOL_TIMEOUT_CONFIG = {
  // 快速操作：文件列表、用户信息等
  QUICK_OPERATIONS: {
    recommended: 30 * 1000,    // 30秒
    maximum: 60 * 1000,        // 60秒
    resetOnProgress: false,
    pollInterval: 1000,         // 1秒轮询间隔（通常不需要）
    maxPollAttempts: 3,         // 最多轮询3次
    description: "快速查询操作"
  },
  
  // 普通操作：文件搜索、创建目录等
  NORMAL_OPERATIONS: {
    recommended: 60 * 1000,    // 60秒
    maximum: 120 * 1000,       // 2分钟
    resetOnProgress: false,
    pollInterval: 2000,         // 2秒轮询间隔
    maxPollAttempts: 10,        // 最多轮询10次
    description: "普通文件操作"
  },
  
  // 文件传输：上传、下载等
  FILE_TRANSFER: {
    recommended: 300 * 1000,   // 5分钟
    maximum: 30 * 60 * 1000,   // 30分钟
    resetOnProgress: true,      // 进度更新时重置超时
    pollInterval: 3000,         // 3秒轮询间隔
    maxPollAttempts: 100,       // 最多轮询100次
    description: "文件上传下载操作"
  },
  
  // 视频下载：可能需要很长时间
  VIDEO_DOWNLOAD: {
    recommended: 300 * 1000,   // 5分钟基础时间
    maximum: 60 * 60 * 1000,   // 60分钟最大时间
    resetOnProgress: true,      // 进度更新时重置超时
    pollInterval: 5000,         // 5秒轮询间隔
    maxPollAttempts: 11,     // 最多轮询11次（55秒）
    description: "视频下载到云盘"
  },
  
  // 长时间分析任务
  LONG_ANALYSIS: {
    recommended: 600 * 1000,   // 10分钟
    maximum: 60 * 60 * 1000,   // 60分钟
    resetOnProgress: true,
    pollInterval: 10000,        // 10秒轮询间隔
    maxPollAttempts: 60,        // 最多轮询60次
    description: "长时间分析任务"
  }
} as const;

/**
 * 获取工具的推荐超时配置
 */
export function getToolTimeoutConfig(toolName: string) {
  switch (toolName) {
    case 'user-info':
    case 'file-list':
      return TOOL_TIMEOUT_CONFIG.QUICK_OPERATIONS;
      
    case 'file-search':
    case 'make-dir':
    case 'file-move':
    case 'file-rename':
    case 'file-share':
      return TOOL_TIMEOUT_CONFIG.NORMAL_OPERATIONS;
      
    case 'file-download-stdio':
    case 'file-upload-stdio':
    case 'file-save':
      return TOOL_TIMEOUT_CONFIG.FILE_TRANSFER;
      
    case 'video-download':
      return TOOL_TIMEOUT_CONFIG.VIDEO_DOWNLOAD;
      
    default:
      return TOOL_TIMEOUT_CONFIG.NORMAL_OPERATIONS;
  }
}

/**
 * 生成客户端调用建议
 */
export function generateClientCallExample(toolName: string) {
  const config = getToolTimeoutConfig(toolName);
  
  const example = {
    timeout: config.recommended,
    maxTotalTimeout: config.maximum,
    resetTimeoutOnProgress: config.resetOnProgress || false
  };
  
  return `
// 建议的客户端调用配置 - ${config.description}
const result = await client.request(
  {
    method: 'tools/call',
    params: {
      name: '${toolName}',
      arguments: { /* 工具参数 */ }
    }
  },
  CallToolResultSchema,
  ${JSON.stringify(example, null, 2)}
);`;
} 