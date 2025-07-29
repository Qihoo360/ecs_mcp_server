import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";

// 辅助函数：将字节转换为可读的文件大小格式
function formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return '0 Bytes';
    if (!bytes || bytes < 0) return '未知大小';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 调用云盘API保存文件
async function saveFile(authInfo: AuthInfo, params: { url?: string, content?: string, upload_path?: string }): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 构建请求参数
    const baseParams: Record<string, string> = {
      'method': 'MCP.saveFile',
      'access_token': authInfo.access_token || '',
      'qid': authInfo.qid || '',
      'sign': authInfo.sign || ''
    };

    // 添加所有参数到URL
    Object.entries(baseParams).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });

    // 构建表单数据
    const body = new URLSearchParams();
    body.append('upload_path', params.upload_path || '');
    if (params.url) {
      body.append('url', params.url);
    } else if (params.content) {
      body.append('content', params.content);
    }
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: headers,
      body
    });
    
    if (!response.ok) {
      throw new Error(`API 请求失败，状态码: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('保存文件失败:', error);
    throw error;
  }
}

// 查询任务状态
async function queryTaskStatus(authInfo: AuthInfo, taskId: string): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || ''
    };

    // 构建GET参数
    url.searchParams.append('method', 'MCP.query');
    url.searchParams.append('qid', authInfo.qid || '');
    url.searchParams.append('access_token', authInfo.access_token || '');
    url.searchParams.append('sign', authInfo.sign || '');

    // 构建POST参数
    const body = new URLSearchParams();
    body.append('task_id', taskId);
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: headers,
      body: body
    });
    
    if (!response.ok) {
      throw new Error(`API 请求失败，状态码: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('查询任务状态失败:', error);
    throw error;
  }
}

// 轮询任务状态
async function pollTaskStatus(authInfo: AuthInfo, taskId: string, interval = 1000, maxAttempts = 120): Promise<any> {
  let attempts = 0;
  let result;
  while (attempts < maxAttempts) {
    attempts++;
    result = await queryTaskStatus(authInfo, taskId);
    
    if (result.errno !== 0) {
      throw new Error(result.errmsg || '查询任务状态失败');
    }
    
    const status = result.data?.status;
    if (status === 2) { // 处理完成
      return result;
    } else if (status === 3) { // 处理失败
      throw new Error(result.data?.error || '文件保存失败');
    }
    
    // 等待下一次轮询
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  // throw new Error('轮询超时，文件保存未完成');
  return {
    content: [
      {
        type: "text",
        text: `🚀 正在保存文件到云盘中，请稍后在"${result.data?.file_path}"目录查看\n` +
              `📦 文件大小：${result.data?.file_size}`
      }
    ]
  };
}

export function registerFileSaveTool(server: McpServer) {
  server.tool(
    "file-save",
    "通过URL或文本内容保存文件到云盘",
    {
      url: z.string().optional().describe("文件下载地址，url或content必传1个"),
      content: z.string().optional().describe("文件内容(md格式)，url或content必传1个，需要传用户指定的完整内容，不能省略任何部分"),
      // upload_path: z.string()
      //   .default('/来自mcp_server/')
      //   .describe("云盘存储路径，必须以/开头和结尾。如不指定，默认为'/来自mcp_server/'。\n- 支持自动创建不存在的一级目录\n- 不支持不存在的多级目录")
      //   .refine((path) => path.endsWith('/'), {
      //     message: "路径必须以/结尾"
      //   })
      //   .refine((path) => path.startsWith('/'), {
      //     message: "路径必须以/开头"
      //   })
    },
    async ({ url, content }, mcpReq: any) => {
      // 参数验证
      if (!url && !content) {
        return {
          content: [{
            type: "text",
            text: "❌ 参数错误: 必须提供url或content参数"
          }]
        };
      }
      
      const httpContext = gethttpContext(mcpReq, server);
      const transportAuthInfo = httpContext.authInfo;
      
      try {
        let authInfo: AuthInfo;
        try {
          // 获取鉴权信息
          authInfo = await getAuthInfo({
            method: 'MCP.saveFile'
          }, transportAuthInfo);
          
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url;
        } catch (authError) {
          console.error("获取鉴权信息失败:", authError);
          throw new Error("获取鉴权信息失败");
        }
        
        // 调用保存文件API
        const saveResult = await saveFile(authInfo, { url, content });
        
        if (saveResult && saveResult.errno === 0) {
          const taskId = saveResult.data?.task_id;
          
          if (!taskId) {
            return {
              content: [{
                type: "text",
                text: "❌ 保存文件失败: 未获取到任务ID"
              }]
            };
          }
          
          // 轮询任务状态
          try {
            const finalResult = await pollTaskStatus(authInfo, taskId);
            
            const resultData = finalResult.data;
            let resultText = `✅ 文件保存成功！\n\n`;
            
            resultText += `🆔 任务ID: ${taskId}\n`;
            
            const fileInfo: any = { taskId };

            if (resultData) {
              const qid = resultData.qid || authInfo.qid;
              const path = resultData.file_path;
              const nid = resultData.nid;
              const size = resultData.file_size;

              fileInfo.path = path;
              fileInfo.nid = nid;
              fileInfo.size = size;
              fileInfo.qid = qid;

              if (path) {
                resultText += `📂 云盘路径: ${path}\n`;
              }
              if (size) {
                 resultText += `📦 文件大小: ${formatBytes(size)}\n`;
              }
              
              if (path && nid && qid) {
                const dirPath = path.substring(0, path.lastIndexOf('/') + 1);
                const href = `https://www.yunpan.com/file/index#/fileManage/my/file/${encodeURIComponent(dirPath)}?focus_nid=${nid}&owner_qid=${qid}`;
                resultText += `🔗 [点击查看云盘文件](${href})\n`;
                fileInfo.href = href;
              }
            }

            return {
              content: [
                {
                  type: "text",
                  name: "x-save-result-json",
                  text: JSON.stringify({
                    status: 'success',
                    file: fileInfo
                  })
                },
                {
                  type: "text",
                  name: "x-save-result-display",
                  text: resultText
                }
              ]
            };
          } catch (pollError: any) {
            const isTimeout = pollError.message.includes('轮询超时');
            const status = isTimeout ? 'timeout' : 'failed';
            const resultText = isTimeout
              ? `⏳ 文件保存轮询超时\n\n- 任务ID: ${taskId}\n- 请稍后检查云盘或使用任务ID查询状态。`
              : `❌ 文件保存失败\n\n- 任务ID: ${taskId}\n- 错误信息: ${pollError.message}`;
            
            return {
              content: [
                {
                  type: "text",
                  name: "x-save-result-json",
                  text: JSON.stringify({
                    status: status,
                    taskId: taskId,
                    error: pollError.message
                  })
                },
                {
                  type: "text",
                  name: "x-save-result-display",
                  text: resultText
                }
              ]
            };
          }
        } else {
          throw new Error(saveResult?.errmsg || "API请求失败");
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `保存文件时发生错误: ${error.message}`,
            }
          ],
        };
      }
    },
  );
}
