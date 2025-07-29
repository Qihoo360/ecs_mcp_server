import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig, TOOL_LIMIT_NOTE } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";

// 定义文件对象接口
interface YunPanFile {
  is_dir: boolean;
  name: string;
  count_size: string;
  create_time: string;
  modify_time: string;
  nid: string;
  [key: string]: any; // 允许其他属性
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// 格式化文件信息
function formatFileInfo(file: YunPanFile): string {
  const isDir = file.type === "1" || false;
  const fileType = isDir ? "文件夹" : (file.name.split('.').pop() || "未知");
  return [
    `文件名: ${file.name || "未命名"}`,
    `类型: ${isDir ? "文件夹" : fileType}`,
    `大小: ${formatFileSize(parseInt(file.count_size || "0") || 0)}`,
    `创建时间: ${new Date(parseInt(file.create_time || "0") * 1000).toLocaleString()}`,
    `修改时间: ${new Date(parseInt(file.modify_time || "0") * 1000).toLocaleString()}`,
    `ID: ${file.nid || "未知"}`,
    "---",
  ].join("\n");
}

// 调用云盘API搜索文件
async function searchFiles(authInfo: AuthInfo, extraParams: Record<string|number, string|number>): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 构建基本请求参数
    const baseParams: Record<string, string> = {
      'method': 'File.searchList',
      'access_token': authInfo.access_token || '',
      'qid': authInfo.qid || '',
      'sign': authInfo.sign || ''
    };

    // 添加所有基本参数到URL
    Object.entries(baseParams).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });

    // 构建表单数据
    const body = new URLSearchParams();
    
    // 添加额外参数到表单数据
    for (const [key, value] of Object.entries(extraParams)) {
      // 去除 access_token，因为已经在URL中添加
      if (key !== 'access_token') {
        body.append(String(key), String(value));
      }
    }
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: headers,
      body
    });
    
    if (!response.ok) {
      throw new Error(`API 请求失败，状态码: ${response.status}`);
    }
    
    // 先获取原始响应文本
    const responseText = await response.text();
    
    try {
      // 尝试解析为JSON
      const data = JSON.parse(responseText);
      return data;
    } catch (jsonError) {
      throw new Error(`无法解析API响应: ${responseText.substring(0, 100)}...`);
    }
  } catch (error) {
    console.error('搜索文件失败:', error);
    throw error;
  }
}

export function registerFileSearchTool(server: McpServer) {
  server.tool(
    "file-search",
    "在云盘中根据关键词搜索文件和文件夹，支持按文件类型筛选和分页查询。返回符合条件的文件详细信息。",
    {
      file_category: z.number().optional().default(-1).describe("文件类型筛选：-1(全部)、0(其他)、1(图片)、2(文档)、3(音乐)、4(视频)"),
      key: z.string().optional().default("").describe("搜索关键词，当file_category 不为 -1 时，可以为空，否则必填"),
      page: z.number().optional().default(1).describe("页码，从1开始"),
      page_size: z.number().optional().default(20).describe("每页显示的条目数，默认20条，最大100条"),
    },
    async ({ file_category, key, page, page_size }, mcpReq: any) => {
      const httpContext = gethttpContext(mcpReq, server);
      
      // 使用transport中的authInfo
      const transportAuthInfo = httpContext.authInfo;
      try {
        let authInfo: AuthInfo;
        
        // 参数验证
        if (!key && file_category === -1) {
          throw new Error("必须提供搜索关键词(key)或指定文件类型(file_category)");
        }
        
        const extraParams: Record<string|number, string|number> = {
          file_category,
          key,
          page: page || 1,
          page_size: page_size || 20,
        }
        try {
          // 传入方法名和路径等参数
          authInfo = await getAuthInfo({
            method: 'File.searchList',
            extraParams: extraParams
          }, transportAuthInfo);
          
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url
        } catch (authError) {
          throw new Error("获取鉴权信息失败，请提供有效的API_KEY");
        }
        
        // 调用API搜索文件
        const apiResponse = await searchFiles(authInfo, extraParams);
        
        // 检查API响应是否成功
        if (apiResponse && apiResponse.errno === 0) {
          const files = (apiResponse.data && apiResponse.data.node_list) || [];
          
          if (files.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "没有找到符合条件的文件",
                },
              ],
            };
          }
          
          // 统计文件夹和文件数量
          const dirCount = files.filter((file: YunPanFile) => file.type === "1").length;
          const fileCount = files.length - dirCount;
          
          // 格式化结果
          const formattedFiles = files.map(formatFileInfo);
          const filesText = `云盘文件搜索结果 (关键词: ${key})\n共 ${files.length} 项 (${dirCount} 个文件夹, ${fileCount} 个文件)\n\n${formattedFiles.join("\n")}`;
          
          return {
            content: [
              {
                type: "text",
                text: filesText,
              },
              {
                type: "text",
                text: TOOL_LIMIT_NOTE,
              },
            ],
          };
        } else {
          throw new Error(apiResponse?.errmsg || "API请求失败");
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `搜索文件时发生错误: ${error.message}`,
            },
            {
              type: "text",
              text: TOOL_LIMIT_NOTE,
            },
          ],
        };
      }
    },
  );
}
