import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig, TOOL_LIMIT_NOTE } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";

// 调用云盘API删除文件
async function deleteFiles(authInfo: AuthInfo, fname: string): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 构建请求参数（注意：fname不计算sign，所以不包含在baseParams中）
    const baseParams: Record<string, string> = {
      'method': 'File.delete',
      'access_token': authInfo.access_token || '',
      'qid': authInfo.qid || '',
      'sign': authInfo.sign || ''
    };

    // 构建表单数据
    const formData = new URLSearchParams();
    Object.entries(baseParams).forEach(([key, value]) => {
      formData.append(key, String(value));
    });
    
    // 单独添加fname参数（不参与sign计算）
    formData.append('fname', fname);
    
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
    console.error('删除文件失败:', error);
    throw error;
  }
}

export function registerFileDelTool(server: McpServer) {
  server.tool(
    "file-del",
    "删除云盘中的文件或文件夹。支持批量删除多个文件。",
    {
      fname: z.string().describe("要删除的文件或文件夹路径，多个文件路径用竖线(|)隔开，例如：/文件1.txt|/文件夹2/文件2.txt"),
    },
    async ({ fname }, mcpReq: any) => {
      const httpContext = gethttpContext(mcpReq, server);
      
      // 使用transport中的authInfo
      const transportAuthInfo = httpContext.authInfo;
      try {
        let authInfo: AuthInfo;
        
        // 注意：因为fname不计算sign，所以这里不传入extraParams
        try {
          // 传入方法名，但不传入fname
          authInfo = await getAuthInfo({
            method: 'File.delete'
            // 不传入fname作为extraParams，因为它不参与sign计算
          }, transportAuthInfo);
          
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url
        } catch (authError) {
          console.error("自动获取鉴权信息失败:", authError);
          throw new Error("获取鉴权信息失败，请提供有效的API_KEY");
        }
        
        // 调用API删除文件
        const apiResponse = await deleteFiles(authInfo, fname);
        
        // 检查API响应是否成功
        if (apiResponse && apiResponse.errno === 0) {
          // 计算删除的文件数
          const fileCount = fname.split('|').length;
          const fileWord = fileCount > 1 ? "些文件/文件夹" : "个文件/文件夹";
          
          // 返回删除成功信息
          return {
            content: [
              {
                type: "text",
                text: `成功删除了${fileCount}${fileWord}！`,
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
        console.error("删除文件出错:", error);
        return {
          content: [
            {
              type: "text",
              text: `删除文件时发生错误: ${error.message}`,
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