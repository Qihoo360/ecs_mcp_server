import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig, TOOL_LIMIT_NOTE } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";

// 调用云盘API获取用户信息
async function fetchUserInfo(authInfo: AuthInfo): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');

    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || ''
    };

    // 构建请求参数
    const baseParams: Record<string, string> = {
      'method': 'User.getUserDetail',
      'access_token': authInfo.access_token || '',
      'qid': authInfo.qid || '',
      'sign': ''
    };

    // 添加所有参数到URL
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
    console.error('获取用户信息失败:', error);
    throw error;
  }
}

export function registerUserInfoTool(server: McpServer) {
  server.tool(
    "user-info",
    "获取360AI云盘用户详细信息。",
    async (mcpReq: any) => {
      const httpContext = gethttpContext(mcpReq, server);
      
      // 使用transport中的authInfo
      const transportAuthInfo = httpContext.authInfo;
      console.error('transportAuthInfo==user-info', transportAuthInfo);
      try {
        let authInfo: AuthInfo;
        try {
          // 传入方法名和qid参数
          authInfo = await getAuthInfo({}, transportAuthInfo);
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url
        } catch (authError) {
          throw new Error("获取鉴权信息失败，请提供有效的API_KEY");
        }

        // 调用API获取用户信息
        const apiResponse = await fetchUserInfo(authInfo);

        // 检查API响应是否成功
        if (apiResponse && apiResponse.errno === 0 && apiResponse.data) {
          const user = apiResponse.data;
          // 格式化部分关键信息
          const info = [
            `昵称: ${user.name}`,
            `会员: ${user.is_vip ? '是' : '否'}${user.vip_desc ? '（' + user.vip_desc + '）' : ''}`,
            `总空间: ${(parseInt(user.total_size) / (1024 * 1024 * 1024)).toFixed(2)} GB`,
            `已用空间: ${(parseInt(user.used_size) / (1024 * 1024 * 1024)).toFixed(2)} GB`,
            `剩余空间: ${(user.available_size / (1024 * 1024 * 1024)).toFixed(2)} GB`,
            `会员剩余天数: ${user.expire_day}天`,
            `会员到期时间: ${user.expire ? new Date(parseInt(user.expire) * 1000).toLocaleString() : '未知'}`
          ].join('\n');
          return {
            content: [
              {
                type: "text",
                text: `用户信息获取成功！\n${info}`,
              },
            ],
            userInfo: user
          };
        } else {
          const errorMsg = apiResponse?.errmsg || "API请求失败";
          throw new Error(errorMsg);
        }
      } catch (error: any) {
        console.error("获取用户信息出错:", error);
        return {
          content: [
            {
              type: "text",
              text: `获取用户信息时发生错误: ${error.message}`,
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