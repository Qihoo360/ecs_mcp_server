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
    `文件nid: ${file.nid || ""}`,
    `---`
  ].join("\n");
}

// 调用云盘API获取文件列表
async function fetchFileList(authInfo: AuthInfo, extraParams: Record<string|number, string|number>): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || ''
    };

    // 确保所有参数都是字符串
    const stringifiedParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(extraParams)) {
      // 去除 access_token
      if (key !== 'access_token') {
        stringifiedParams[String(key)] = String(value);
      }
    }

    const baseParams: Record<string, string> = {
      'method': 'File.getList',
      'access_token': authInfo.access_token || '',
      'qid': authInfo.qid || '',
      'sign': authInfo.sign || '',
      ...stringifiedParams
    };

    // 确保所有参数被正确添加
    Object.entries(baseParams).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: headers
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
      console.error("JSON解析错误:", jsonError);
      throw new Error(`无法解析API响应: ${responseText.substring(0, 100)}...`);
    }
  } catch (error) {
    console.error('获取文件列表失败:', error);
    throw error;
  }
}

export function registerGetFilesTool(server: McpServer) {
  server.tool(
    "file-list",
    "获取云盘指定路径下的文件和文件夹列表，支持分页查询。返回文件名、大小、创建时间、修改时间等详细信息。",
    {
      page: z.number().optional().default(0).describe("页码，默认从0开始。"),
      page_size: z.number().optional().default(50).describe("每页显示的条目数，默认50条。"),
      path: z.string().optional().default("/").describe("要查询的云盘路径，默认为根目录'/'"),
    },
    async ({ page, page_size, path }, mcpReq: any) => {
      const httpContext = gethttpContext(mcpReq, server);
      const transportAuthInfo = httpContext.authInfo;

      try {
        let authInfo: AuthInfo;
        const extraParams = {
          path: path || '/',
          page: page || 0,
          page_size: page_size || 100,
        }
        try {
          authInfo = await getAuthInfo({
            method: 'File.getList',
            extraParams: extraParams
          }, transportAuthInfo);
          
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url
        } catch (authError) {
        
          return {
            content: [{
              type: "text",
              text: "获取鉴权信息失败，请提供有效的API_KEY"
            }],
            isError: true
          };
        }
        
        const apiResponse = await fetchFileList(authInfo, extraParams);
        
        if (apiResponse && apiResponse.errno === 0) {
          const files = (apiResponse.data && apiResponse.data.node_list) || [];
          
          if (files.length === 0) {
            return {
              content: [{
                type: "text",
                text: "没有找到符合条件的文件"
              }]
            };
          }
          
          const dirCount = files.filter((file: YunPanFile) => file.type === "1").length;
          const fileCount = files.length - dirCount;
          
          const filesText = [
            `云盘文件列表 (路径: ${path})`,
            `共 ${files.length} 项 (${dirCount} 个文件夹, ${fileCount} 个文件)`,
            "",
            ...files.map(formatFileInfo)
          ].join("\n");
          
          return {
            content: [
              {
                type: "text",
                text: filesText
              },
              {
                type: "text",
                text: TOOL_LIMIT_NOTE
              }
            ]
          };
        } else {
          return {
            content: [{
              type: "text",
              text: apiResponse?.errmsg || "API请求失败"
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `获取文件列表出错: ${error.message || "未知错误"}`,
            },
            {
              type: "text",
              text: TOOL_LIMIT_NOTE,
            }
          ],
          isError: true
        };
      }
    },
  );
} 