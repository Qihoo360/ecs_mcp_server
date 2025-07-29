import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig, TOOL_LIMIT_NOTE } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";

// 调用云盘API生成分享链接
async function shareFiles(authInfo: AuthInfo, paths: string): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');

    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 构建请求参数（注意：paths不计算sign，所以不包含在baseParams中）
    const baseParams: Record<string, string> = {
      'method': 'Share.preShare',
      'access_token': authInfo.access_token || '',
      'qid': authInfo.qid || '',
      'sign': authInfo.sign || ''
    };

    // 构建表单数据
    const formData = new URLSearchParams();
    Object.entries(baseParams).forEach(([key, value]) => {
      formData.append(key, String(value));
    });
    // 单独添加paths参数（不参与sign计算）
    formData.append('paths', paths);

    console.error("请求URL:", url.toString());
    console.error("请求参数:", Object.fromEntries(formData.entries()));

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
    console.error('生成分享链接失败:', error);
    throw error;
  }
}

export function registerFileShareTool(server: McpServer) {
  server.tool(
    "file-share",
    "生成云盘文件的分享链接。支持批量生成多个文件的分享链接。",
    {
      paths: z.string().describe("要分享的文件全路径，多个文件用竖线(|)隔开，例如：/文件1.txt|/文件夹2/文件2.txt"),
    },
    async ({ paths }, mcpReq: any) => {
      const httpContext = gethttpContext(mcpReq, server);
      
      // 使用transport中的authInfo
      const transportAuthInfo = httpContext.authInfo;
      try {
        let authInfo: AuthInfo;
        // 注意：paths不计算sign，所以这里不传入extraParams
        try {
          // 传入方法名，但不传入paths
          authInfo = await getAuthInfo({
            method: 'Share.preShare'
            // 不传入paths作为extraParams，因为它不参与sign计算
          }, transportAuthInfo);
          
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url
        } catch (authError) {
          console.error("自动获取鉴权信息失败:", authError);
          throw new Error("获取鉴权信息失败，请提供有效的API_KEY");
        }

        // 调用API生成分享链接
        const apiResponse = await shareFiles(authInfo, paths);

        // 检查API响应是否成功
        if (apiResponse && apiResponse.errno === 0 && apiResponse.data && apiResponse.data.share) {
          const share = apiResponse.data.share;
          return {
            content: [
              {
                type: "text",
                text: `分享链接生成成功！\n链接: ${share.url}\n提取码: ${share.password || '无'}\n短链: ${share.shorturl}\n二维码: ${share.qrcode}`,
              },
              {
                type: "text",
                text: TOOL_LIMIT_NOTE,
              },
            ],
            shareInfo: share
          };
        } else {
          const errorMsg = apiResponse?.errmsg || "API请求失败";
          throw new Error(errorMsg);
        }
      } catch (error: any) {
        console.error("生成分享链接出错:", error);
        return {
          content: [
            {
              type: "text",
              text: `生成分享链接时发生错误: ${error.message}`,
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