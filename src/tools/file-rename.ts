import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig, TOOL_LIMIT_NOTE } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";

// 调用云盘API重命名文件
async function renameFile(authInfo: AuthInfo, src_name: string, new_name: string): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 构建请求参数
    const baseParams: Record<string, string> = {
      'method': 'File.rename',
      'access_token': authInfo.access_token || '',
      'qid': authInfo.qid || '',
      'sign': authInfo.sign || '',
      'src_name': src_name,
      'new_name': new_name
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
    console.error('重命名文件失败:', error);
    throw error;
  }
}

export function registerFileRenameTool(server: McpServer) {
  server.tool(
    "file-rename",
    "重命名云盘中的文件或文件夹。",
    {
      src_name: z.string().describe("原文件或文件夹的完整路径，例如：/我的知识库/111.doc 或 /我的知识库/"),
      new_name: z.string().describe("新的名称（仅文件名或文件夹名，不含父路径）。文件夹名需以/结尾，例如：222.doc 或 我的知识库/"),
    },
    async ({ src_name, new_name }, mcpReq: any) => {
      const httpContext = gethttpContext(mcpReq, server);
      
      // 使用transport中的authInfo
      const transportAuthInfo = httpContext.authInfo;
      try {
        let authInfo: AuthInfo;
        const extraParams = {
          src_name: src_name,
          new_name: new_name
        };
        
        try {
          // 传入方法名和参数
          authInfo = await getAuthInfo({
            method: 'File.rename',
            extraParams: extraParams
          }, transportAuthInfo);
          
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url
        } catch (authError) {
          console.error("自动获取鉴权信息失败:", authError);
          throw new Error("获取鉴权信息失败，请提供有效的API_KEY");
        }
        
        // 调用API重命名文件
        const apiResponse = await renameFile(authInfo, src_name, new_name);
        
        // 检查API响应是否成功
        if (apiResponse && apiResponse.errno === 0) {
          // 获取文件类型（通过判断src_name末尾是否有斜杠来确定是文件夹还是文件）
          const isFolder = src_name.endsWith('/');
          const fileType = isFolder ? "文件夹" : "文件";
          
          // 提取原文件/文件夹名（从路径中获取最后一部分）
          const srcParts = src_name.split('/').filter(part => part !== '');
          const oldName = srcParts.length > 0 ? srcParts[srcParts.length - 1] : src_name;
          
          // 返回重命名成功信息
          return {
            content: [
              {
                type: "text",
                text: `成功将${fileType}"${oldName}"重命名为"${new_name}"！`,
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
        console.error("重命名文件出错:", error);
        return {
          content: [
            {
              type: "text",
              text: `重命名文件时发生错误: ${error.message}`,
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