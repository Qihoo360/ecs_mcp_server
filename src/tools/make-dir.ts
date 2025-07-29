import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig, TOOL_LIMIT_NOTE } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";

// 调用云盘API创建文件夹
async function createDirectory(authInfo: AuthInfo, fname: string): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 构建请求参数
    const baseParams: Record<string, string> = {
      'method': 'File.mkdir',
      'access_token': authInfo.access_token || '',
      'qid': authInfo.qid || '',
      'sign': authInfo.sign || '',
      'fname': fname
    };

    // 构建表单数据
    const formData = new URLSearchParams();
    Object.entries(baseParams).forEach(([key, value]) => {
      formData.append(key, String(value));
    });
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: headers,
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`API 请求失败，状态码: ${response.status}`);
    }
    
    // 获取原始响应文本
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
    console.error('创建文件夹失败:', error);
    throw error;
  }
}

export function registerMakeDirTool(server: McpServer) {
  server.tool(
    "make-dir",
    "在云盘中创建新文件夹，支持指定路径。",
    {
      fname: z.string().describe("要创建的文件夹完整路径，例如：/新文件夹/ 或 /文档/子文件夹/"),
    },
    async ({ fname }, mcpReq: any) => {
      const httpContext = gethttpContext(mcpReq, server);
      
      // 使用transport中的authInfo
      const transportAuthInfo = httpContext.authInfo;
      try {
        let authInfo: AuthInfo;
        const extraParams = {
          fname: fname
        };
        
        try {
          // 传入方法名和路径等参数
          authInfo = await getAuthInfo({
            method: 'File.mkdir',
            extraParams: extraParams
          }, transportAuthInfo);
          
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url
        } catch (authError) {
          console.error("自动获取鉴权信息失败:", authError);
          throw new Error("获取鉴权信息失败，请提供有效的API_KEY");
        }
        
        // 调用API创建文件夹
        const apiResponse = await createDirectory(authInfo, fname);
        
        // 检查API响应是否成功
        if (apiResponse && apiResponse.errno === 0) {
          const folderData = apiResponse.data || {};
          const folderId = folderData.nid || '';
          
          // 返回创建成功信息
          return {
            content: [
              {
                type: "text",
                text: `文件夹"${fname}"创建成功！\n文件夹ID: ${folderId}`,
              },
              {
                type: "text",
                text: TOOL_LIMIT_NOTE,
              },
            ],
          };
        } else {
          const errorMsg = apiResponse?.errmsg || "API请求失败";
          throw new Error(errorMsg);
        }
      } catch (error: any) {
        console.error("创建文件夹出错:", error);
        return {
          content: [
            {
              type: "text",
              text: `创建文件夹时发生错误: ${error.message}`,
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