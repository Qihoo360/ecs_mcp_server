import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";
import { TOOL_TIMEOUT_CONFIG } from "../utils/timeout-config.js";

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

// 调用云盘API创建视频下载任务
async function createVideoDownload(authInfo: AuthInfo, urls: string): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      // 'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 构建请求参数
    const baseParams: Record<string, string> = {
      'method': 'File.createCloudDownload',
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
    body.append('urls', urls);
    
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
    console.error('创建视频下载任务失败:', error);
    throw error;
  }
}

// 查询任务状态
async function queryDownloadProgress(authInfo: AuthInfo, taskIds: string): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      // 'Content-Type': 'application/x-www-form-urlencoded'
    };

    // 构建GET参数
    url.searchParams.append('method', 'File.getDownloadProgress');
    url.searchParams.append('qid', authInfo.qid || '');
    url.searchParams.append('access_token', authInfo.access_token || '');
    url.searchParams.append('sign', authInfo.sign || '');

    // 构建POST参数
    const body = new URLSearchParams();
    body.append('task_id', taskIds);
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: headers,
      body: body
    });
    
    if (!response.ok) {
      throw new Error(`API 请求失败，状态码: ${response.status}`);
    }
    
    const responseData = await response.json();
    // console.error('response data', responseData);
    return responseData;
  } catch (error) {
    console.error('查询下载进度失败:', error);
    throw error;
  }
}

// 安全的通知发送函数：如果通知失败则记录日志但不中断执行
async function safeSendNotification(
  sendNotification: (notification: any) => Promise<void>,
  notification: any,
  context: string
): Promise<void> {
  try {
    await sendNotification(notification);
  } catch (error: any) {
    console.error(`[${context}] 通知发送失败，继续执行: ${error.message}`);
  }
}

// 轮询任务状态（使用固定的认证信息，避免并发串用）
async function pollDownloadProgress(
  taskIds: string, 
  transportAuthInfo: any, // ⚠️ stdio模式下此参数可能为undefined
  sendNotification: (notification: any) => Promise<void>,
  interval = TOOL_TIMEOUT_CONFIG.VIDEO_DOWNLOAD.pollInterval, 
  maxAttempts = TOOL_TIMEOUT_CONFIG.VIDEO_DOWNLOAD.maxPollAttempts
): Promise<any> {
  let attempts = 0;
  let result;

  // 兼容stdio模式：即使transportAuthInfo未定义，也尝试从环境变量获取ecsEnv
  const ecsEnv = transportAuthInfo?.ecsEnv || process.env.ECS_ENV || 'prod';
  
  // 🔒 使用固定的传输认证信息，避免并发请求中API key串用
  console.error(`[轮询初始化] 固定使用API Key: ${transportAuthInfo?.apiKey}... (避免并发串用)`);
  
  // 发送初始进度通知
  await safeSendNotification(sendNotification, {
    method: "notifications/progress",
    params: {
      progressToken: Date.now(),
      progress: 0,
      total: 100,
      message: "开始轮询下载进度..."
    }
  }, "轮询初始化");
  
  while (attempts < maxAttempts) {
    attempts++;
    
    // 🔧 基于固定的传输认证信息重新生成API认证（保证认证时效性）
    let currentAuthInfo: AuthInfo;
    
    try {
      // 检查固定的认证信息是否仍然有效
      // 兼容stdio模式：transportAuthInfo可以为undefined，getAuthInfo会从环境变量中回退
      // if (!transportAuthInfo) {
      //   console.error(`[轮询第${attempts}次] 固定认证信息无效，退出轮询`);
      //   break;
      // }
      
      // 基于固定的传输认证信息重新生成API认证（刷新签名等时效信息）
      const extraParams = {
        task_id: taskIds
      };
      currentAuthInfo = await getAuthInfo({
        method: 'File.getDownloadProgress',
        extraParams: extraParams
      }, transportAuthInfo); // transportAuthInfo在stdio模式下为undefined，getAuthInfo会从环境变量回退
      currentAuthInfo.request_url = getConfig(ecsEnv).request_url;
      
      console.error(`[轮询第${attempts}次] 使用固定API Key生成新签名: ${transportAuthInfo?.apiKey}...`);
      
    } catch (authError) {
      console.error(`[轮询第${attempts}次] 基于固定认证生成签名失败:`, authError);
      if (attempts >= maxAttempts) {
        throw authError;
      }
      // 认证失败时等待后重试
      await new Promise(resolve => setTimeout(resolve, interval));
      continue;
    }
    
    try {
      result = await queryDownloadProgress(currentAuthInfo, taskIds);
      console.error('result==pollDownloadProgress', JSON.stringify(result, null, 2));
      
      if (result.errno !== 0) {
        throw new Error(result.errmsg || '查询下载进度失败');
      }
      
      if (!result.data || !Array.isArray(result.data)) {
        console.error(`轮询第${attempts}次: 未获取到任务数据`);
        await new Promise(resolve => setTimeout(resolve, interval));
        continue;
      }
      
      // 📊 计算总体进度并发送通知
      const statusCounts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
      let totalTasks = result.data.length;
      
      result.data.forEach((task: any) => {
        const status = String(task.status);
        if (statusCounts.hasOwnProperty(status)) {
          statusCounts[status as keyof typeof statusCounts]++;
        }
      });
      
      // 计算进度百分比：完成的任务 / 总任务数
      const completedTasks = statusCounts['4'] + statusCounts['5']; // 成功 + 失败都算完成
      const progressPercent = Math.round((completedTasks / totalTasks) * 100);
      
      // 🔔 发送实时进度通知
      await safeSendNotification(sendNotification, {
        method: "notifications/progress",
        params: {
          progressToken: Date.now(),
          progress: progressPercent,
          total: 100,
          message: `下载进度 ${progressPercent}% (${completedTasks}/${totalTasks}) - 待开始:${statusCounts['1']}, 下载中:${statusCounts['2']}, 下载成功:${statusCounts['3']}, 上传成功:${statusCounts['4']}, 失败:${statusCounts['5']}`
        }
      }, `轮询第${attempts}次-进度`);
      
      // 📢 发送状态日志通知
      await safeSendNotification(sendNotification, {
        method: "notifications/message",
        params: {
          level: "info",
          data: `轮询第${attempts}次: 任务状态分布 - 待开始:${statusCounts['1']}, 下载中:${statusCounts['2']}, 下载成功:${statusCounts['3']}, 上传成功:${statusCounts['4']}, 失败:${statusCounts['5']}`
        }
      }, `轮询第${attempts}次-状态`);
      
      // 检查所有任务是否都已进入最终状态（4=上传成功, 5=失败）
      const allTasksAreFinished = result.data.every((task: any) => {
        const status = Number(task.status);
        return status === 4 || status === 5;
      });
      
      if (allTasksAreFinished) {
        console.error(`轮询第${attempts}次: 所有任务已进入最终状态（成功或失败），结束轮询。`);
        
        // 📢 发送完成通知
        await safeSendNotification(sendNotification, {
          method: "notifications/message",
          params: {
            level: "info",
            data: `所有下载任务已完成！成功:${statusCounts['4']}, 失败:${statusCounts['5']}`
          }
        }, "任务完成");
        
        return result;
      }
      
      console.error(`轮询第${attempts}次: 任务状态分布 - 待开始:${statusCounts['1']}, 下载中:${statusCounts['2']}, 下载成功:${statusCounts['3']}, 上传成功:${statusCounts['4']}, 失败:${statusCounts['5']}`);
      
      // ✅ 优化：仅在还有下一次尝试时才打印"等待"日志并执行等待
      if (attempts < maxAttempts) {
        console.error(`轮询第${attempts}次: 任务进行中，等待${interval/1000}秒后继续查询...`);
        await new Promise(resolve => setTimeout(resolve, interval));
      } else {
        // 这是最后一次尝试，只打印结束信息，不再等待
        console.error(`轮询第${attempts}次: 已达到最大尝试次数，结束轮询。`);
        
        // 📢 发送超时通知
        await safeSendNotification(sendNotification, {
          method: "notifications/message",
          params: {
            level: "warning",
            data: `轮询超时，但任务可能仍在后台处理中，请稍后查看云盘`
          }
        }, "轮询超时");
      }
      
    } catch (error) {
      console.error(`轮询第${attempts}次查询失败:`, error);
      
      // 📢 发送错误通知
      await safeSendNotification(sendNotification, {
        method: "notifications/message",
        params: {
          level: "error",
          data: `轮询第${attempts}次查询失败: ${error}`
        }
      }, `轮询第${attempts}次-错误`);
      
      if (attempts >= maxAttempts) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  
  // 即使超时，也返回最后的结果数据，让调用方能够处理
  if (result && result.data) {
    console.error(`轮询超时，但返回最后获取到的任务数据供处理`);
  }
  return result;
}

// 注册视频下载工具
export function registerVideoDownloadTool(server: McpServer) {
  server.tool(
    "video-download",
    "下载视频到云盘。注意：此操作可能需要较长时间，建议客户端设置更长的超时时间（建议300秒以上）。",
    {
      urls: z.string().describe("视频URL，多个URL使用英文竖线'|'分隔")
    },
    async ({ urls }, mcpReq) => {
      // 参数验证
      if (!urls) {
        return {
          content: [{
            type: "text",
            text: "❌ 参数错误: 必须提供urls参数"
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
            method: 'File.createCloudDownload'
          }, transportAuthInfo);
          console.error('authInfo==video-download', authInfo);
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url;

        } catch (authError) {
          console.error("获取鉴权信息失败:", authError);
          throw new Error("获取鉴权信息失败");
        }
        
        // 调用创建下载任务API
        const createResult = await createVideoDownload(authInfo, urls);
        console.error('createResult==video-download', JSON.stringify(createResult, null, 2));
        if (createResult && createResult.errno === 0) {
          const taskData = createResult.data;
          
          if (!taskData || taskData.length === 0) {
            return {
              content: [{
                type: "text",
                text: "❌ 创建下载任务失败: 未获取到任务信息"
              }]
            };
          }
          
          // 提取所有任务ID
          const taskIds = taskData.map((task: any) => task.task_id).join(',');
          
          // 🔄 恢复一体化下载体验：自动轮询直到完成
          console.error(`✅ 任务创建成功，开始轮询进度，任务ID: ${taskIds}`);
          
          // 使用配置的轮询参数
          const timeoutConfig = TOOL_TIMEOUT_CONFIG.VIDEO_DOWNLOAD;
          
          // 轮询任务状态直到完成
          try {
            const finalResult = await pollDownloadProgress(
              taskIds, 
              transportAuthInfo, 
              async (notification) => {
                await mcpReq.sendNotification(notification);
              }, 
              timeoutConfig.pollInterval, 
              timeoutConfig.maxPollAttempts
            );
            
            if (!finalResult?.data || !Array.isArray(finalResult.data)) {
              // 轮询超时且没有获取到任务数据，提供基本的任务信息
              let timeoutText = "❌ 轮询超时或获取最终结果失败\n\n";
              timeoutText += `📋 任务信息:\n${taskData.map((task: any) => 
                `• 任务ID: ${task.task_id}\n• URL: ${task.url}`
              ).join('\n\n')}\n\n`;
              timeoutText += `💡 请稍后在云盘传输列表中查询任务状态: ${taskIds}\n\n`;
              
              // 为每个任务生成默认查看路径
              timeoutText += '📁 您也可以在以下路径查看文件（如果任务已完成）：\n';
              taskData.forEach((task: any, index: number) => {
                if (task.qid) {
                  const defaultPath = `https://www.yunpan.com/file/index#/fileManage/my/file${task.default_path ? encodeURIComponent(task.default_path) : '/AI为我下载/'}?focus_nid=${task.upload_info?.data?.nid}&owner_qid=${task.qid}`;
                  timeoutText += `${index + 1}. [查看云盘文件](${defaultPath})\n`;
                }
              });
              
              return {
                content: [{
                  type: "text",
                  text: timeoutText
                }]
              };
            }
            
            // 分析最终结果
            const completedTasks: any[] = [];
            const failedTasks: any[] = [];
            
            finalResult.data.forEach((task: any) => {
              const numericStatus = Number(task.status);
              
              if (numericStatus === 4) {
                // 任务完成（上传成功），添加云盘链接
                if (task.upload_info && task.upload_info.data && task.upload_info.data.path && task.upload_info.data.nid && task.qid) {
                  const dirPath = task.upload_info.data.path.substring(0, task.upload_info.data.path.lastIndexOf('/') + 1);
                  const href = `https://www.yunpan.com/file/index#/fileManage/my/file/${encodeURIComponent(dirPath)}?focus_nid=${task.upload_info.data.nid}&owner_qid=${task.qid}`;
                  task.upload_info.data.href = href;
                }
                completedTasks.push(task);
              } else if (numericStatus === 5) {
                // 任务失败
                failedTasks.push(task);
              }
            });
            
            // 格式化最终结果
            let resultText: string;
            const hasFinishedTasks = completedTasks.length > 0 || failedTasks.length > 0;

            if (hasFinishedTasks) {
              resultText = `🎬 视频下载完成！\n\n`;
            } else {
              resultText = `⏳ 视频下载轮询超时\n\n`;
            }
            
            if (completedTasks.length > 0) {
              resultText += `✅ 成功下载 ${completedTasks.length} 个视频:\n`;
              completedTasks.forEach((task, index) => {
                resultText += `${index + 1}. **视频${task.task_id}**\n`;
                resultText += `   📹 原始链接: ${task.url}\n`;
                if (task.upload_info?.data?.href) {
                  const fileSize = task.upload_info.data.size ? formatBytes(task.upload_info.data.size) : '未知大小';
                  resultText += `   📁 [点击查看云盘文件](${task.upload_info.data.href})\n`;
                  resultText += `   📂 云盘路径: ${task.upload_info.data.path}\n`;
                  resultText += `   📦 文件大小: ${fileSize}\n`;
                  resultText += `   🔑 文件NID: ${task.upload_info.data.nid}\n`;
                  resultText += `   👤 用户QID: ${task.qid}\n`;
                }
                resultText += '\n';
              });
            }
            
            if (failedTasks.length > 0) {
              resultText += `❌ 下载失败 ${failedTasks.length} 个视频:\n`;
              failedTasks.forEach((task, index) => {
                // ❗️ 关键改造: 使用更健壮的逻辑链来查找最具体的错误信息
                const failureReason = 
                  task.progress?.error || 
                  task.upload_info?.errmsg || 
                  task.progress?.status_desc ||
                  task.errmsg || 
                  '未知错误';
                resultText += `${index + 1}. **视频${task.task_id}**: ${task.url}\n`;
                resultText += `   - **失败原因**: ${failureReason}\n`;
              });
              resultText += '\n';
            }
            
            if (completedTasks.length === 0 && failedTasks.length === 0) {
              resultText += '部分任务仍在处理中（待开始/下载中/下载成功但未上传完成）\n';
              resultText += '💡 请稍后在云盘传输列表中查询任务状态\n';
              // resultText += `📝 任务ID列表: ${taskIds}\n`;
              
              // 🔗 为超时的任务生成默认查看路径
              const timeoutTasks = finalResult.data.filter((task: any) => {
                const status = Number(task.status);
                return status !== 4 && status !== 5; // 不是成功也不是失败的任务
              });
              
              if (timeoutTasks.length > 0) {
                resultText += '\n📁 您可以在以下路径查看文件（如果任务已完成）：\n';
                timeoutTasks.forEach((task: any, index: number) => {
                  if (task.qid) {
                    // 生成默认查看路径，类似 href 但指向目录
                    const defaultPath = `https://www.yunpan.com/file/index#/fileManage/my/file${task.default_path ? encodeURIComponent(task.default_path) : '/AI为我下载/'}?focus_nid=${task.upload_info?.data?.nid || ''}&owner_qid=${task.qid}`;
                    resultText += `${index + 1}. [查看云盘文件](${defaultPath})\n`;
                  }
                });
              }
            }
            
            // 为结构化数据确定最终状态
            const finalStatus = (completedTasks.length === 0 && failedTasks.length === 0)
              ? 'timeout'
              : (failedTasks.length > 0)
                  ? (completedTasks.length > 0 ? 'partial_success' : 'all_failed')
                  : 'all_success';

            // 混合模式返回
            return {
              content: [
                // 1. 给机器看的结构化数据 (序列化为JSON字符串)
                {
                  type: "text",
                  name: "x-download-result-json",
                  text: JSON.stringify({
                    status: finalStatus,
                    completedTasks: completedTasks,
                    failedTasks: failedTasks,
                    taskIds: taskIds
                  })
                },
                // 2. 给人看的预格式化文本
                {
                  type: "text",
                  name: "x-download-result-display",
                  text: resultText
                }
              ]
            };
            
          } catch (pollError: any) {
            console.error('轮询过程出错:', pollError);
            
            let errorText = `✅ 任务创建成功，但轮询过程中出现问题: ${pollError.message}\n\n`;
            errorText += `📋 任务信息:\n${taskData.map((task: any) => 
              `• 任务ID: ${task.task_id}\n• URL: ${task.url}`
            ).join('\n\n')}\n\n`;
            errorText += `💡 请稍后在云盘传输列表中查询任务状态: ${taskIds}\n\n`;
            
            // 为每个任务生成默认查看路径
            errorText += '📁 您可以在以下路径查看文件（如果任务已完成）：\n';
            taskData.forEach((task: any, index: number) => {
              if (task.qid) {
                const defaultPath = `https://www.yunpan.com/file/index#/fileManage/my/file${task.dirPath ? encodeURIComponent(task.default_path) : '/AI为我下载/'}?focus_nid=${task.upload_info?.data?.nid || ''}&owner_qid=${task.qid}`;
                errorText += `${index + 1}. [查看云盘文件](${defaultPath})\n`;
              }
            });
            
            return {
              content: [
                {
                  type: "text",
                  text: errorText
                }
              ]
            };
          }
        } else {
          throw new Error(createResult?.errmsg || "API请求失败");
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `下载视频时发生错误: ${error.message}`,
            }
          ],
        };
      }
    },
  );
}
