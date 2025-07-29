import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig, TOOL_LIMIT_NOTE } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";

// 调用云盘API移动文件
async function moveFiles(authInfo: AuthInfo, src_name: string, new_name: string): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 构建请求参数
    const baseParams: Record<string, string> = {
      'method': 'File.move',
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
    console.error('移动文件失败:', error);
    throw error;
  }
}

export function registerFileMoveTool(server: McpServer) {
  server.tool(
    "file-move",
    "移动云盘中的文件或文件夹到指定位置。支持批量移动多个文件。",
    {
      src_name: z.string().describe("源文件或文件夹路径，多个文件用竖线(|)分隔，例如：/文件1.txt|/文件2.txt"),
      new_name: z.string().describe("目标文件夹路径，例如：/目标文件夹/"),
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
            method: 'File.move',
            extraParams: extraParams
          }, transportAuthInfo);
          
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url
        } catch (authError) {
          console.error("自动获取鉴权信息失败:", authError);
          throw new Error("获取鉴权信息失败，请提供有效的API_KEY");
        }
        
        // 调用API移动文件
        const apiResponse = await moveFiles(authInfo, src_name, new_name);
        
        // 检查API响应是否成功
        if (apiResponse && apiResponse.errno === 0) {
          // 计算移动的文件数
          const fileCount = src_name.split('|').length;
          const fileWord = fileCount > 1 ? "些文件" : "个文件";
          
          // 返回移动成功信息
          return {
            content: [
              {
                type: "text",
                text: `成功将${fileCount}${fileWord}移动到"${new_name}"！`,
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
        console.error("移动文件出错:", error);
        return {
          content: [
            {
              type: "text",
              text: `移动文件时发生错误: ${error.message}`,
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