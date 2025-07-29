import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import { getConfig, TOOL_LIMIT_NOTE } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { spawn } from 'child_process';
import { homedir } from 'os';
import fs from 'fs/promises';

const execAsync = promisify(exec);

// 添加一个类型来跟踪下载状态
type DownloadProgress = {
  status: 'downloading' | 'completed' | 'failed';
  progress?: string;
  message: string;
};

// 调用云盘API获取下载链接
async function getDownloadUrl(authInfo: AuthInfo, nid: string): Promise<any> {
  try {
    const url = new URL(authInfo.request_url || '');
    
    // 构建请求头
    const headers = {
      'Access-Token': authInfo.access_token || '',
      'User-Agent': 'yunpan_mcp_server'
    };

    // 构建请求参数
    const baseParams: Record<string, string> = {
      'method': 'Sync.getVerifiedDownLoadUrl',
      'access_token': authInfo.access_token || '',
      'qid': authInfo.qid || '',
      'sign': authInfo.sign || '',
      'nid': String(nid)
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
      throw new Error(`无法解析API响应: ${responseText.substring(0, 100)}...`);
    }
  } catch (error) {
    throw error;
  }
}

// 检查目录权限并创建目录（如果不存在）
async function checkAndCreateDirectory(dirPath: string): Promise<boolean> {
  try {
    // 检查目录是否存在
    try {
      await fs.access(dirPath, fs.constants.F_OK);
    } catch (error) {
      // 目录不存在，尝试创建
      await fs.mkdir(dirPath, { recursive: true });
    }
    
    // 检查读写权限
    await fs.access(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch (error) {
    console.error(`目录 ${dirPath} 权限检查失败:`, error);
    return false;
  }
}

// 从URL中提取fname和fsize参数
function extractFileInfoFromUrl(url: string): {filename: string, sizeMB: number} {
  try {
    const urlObj = new URL(url);
    // 优先从URL参数中获取fname
    const fnameParam = urlObj.searchParams.get('fname');
    const filename = fnameParam ? decodeURIComponent(fnameParam) : 
                    path.basename(urlObj.pathname) || 'downloaded_file';
    
    // 从URL参数中获取fsize
    const fsizeParam = urlObj.searchParams.get('fsize');
    const sizeBytes = fsizeParam ? parseInt(fsizeParam, 10) : 0;
    const sizeMB = sizeBytes / (1024 * 1024);
    
    return {
      filename,
      sizeMB
    };
  } catch (error) {
    console.error('提取文件信息失败:', error);
    return {
      filename: 'downloaded_file',
      sizeMB: 0
    };
  }
}

// 修改下载函数实现，返回进度信息而不是使用回调
async function downloadFileWithCurl(url: string, filename: string, downloadDir: string, timeoutMs: number = 300000): Promise<{ downloadPath: string; progressLog: string[] }> {
  try {
    // 确保下载目录存在并有权限
    const hasPermission = await checkAndCreateDirectory(downloadDir);
    if (!hasPermission) {
      throw new Error(`目录 ${downloadDir} 没有读写权限`);
    }
    
    const downloadPath = path.join(downloadDir, filename);
    
    const progressLog: string[] = [];
    let lastReportedPercentage = -1; // Use -1 to ensure 0% can be reported if seen
    let lineBuffer = '';

    return new Promise((resolve, reject) => {
      const curlArgs = [
        '-L', // Follow redirects
        '-#', // Show progress bar (output to stderr)
        '-A', // User-Agent
        'yunpan_mcp_server',
        url,
        '-o', // Output to file
        downloadPath
      ];
      
      // 添加 Windows 特定的 SSL/TLS 参数
      if (process.platform === 'win32') {
        curlArgs.push('--ssl-reqd'); // 要求 SSL/TLS
        curlArgs.push('--tlsv1.2'); // 强制使用 TLS 1.2
        // curlArgs.push('--insecure'); // 如果需要可以跳过证书验证（临时方案）
      }
      
      const curl = spawn('curl', curlArgs);

      curl.stderr.on('data', (data) => {
        const dataStr = data.toString();
        lineBuffer += dataStr;
        
        let splitParts = lineBuffer.split(/[\r\n]/); // Split by CR or LF
        if (splitParts.length > 1) { // If we have at least one full line terminated by CR/LF
          for (let i = 0; i < splitParts.length - 1; i++) {
            const line = splitParts[i].trim();
            if (line.length === 0) continue;

            const percentageMatch = line.match(/(\d{1,3}(\.\d+)?)\s*%/);
            if (percentageMatch && percentageMatch[1]) {
              const currentPercentage = Math.floor(parseFloat(percentageMatch[1]));
              if ((currentPercentage >= lastReportedPercentage + 10 && currentPercentage < 100) || 
                  (currentPercentage === 100 && lastReportedPercentage < 100)) {
                progressLog.push(`进度: ${currentPercentage}%`);
                lastReportedPercentage = currentPercentage;
              }
            }
          }
          lineBuffer = splitParts[splitParts.length - 1]; // Keep the last (potentially incomplete) part
        }
      });

      curl.on('close', (code) => {
        const finalLine = lineBuffer.trim();
        if (finalLine.length > 0) {
            const percentageMatch = finalLine.match(/(\d{1,3}(\.\d+)?)\s*%/);
            if (percentageMatch && percentageMatch[1]) {
                const currentPercentage = Math.floor(parseFloat(percentageMatch[1]));
                if (currentPercentage === 100 && lastReportedPercentage < 100) {
                    progressLog.push(`进度: 100%`);
                    lastReportedPercentage = currentPercentage;
                }
            }
        }
        
        if (code === 0 && lastReportedPercentage < 100) {
            const foundHundred = progressLog.some(p => p.includes("100%"));
            if (!foundHundred) {
                 progressLog.push(`进度: 100%`);
            }
        }

        if (code === 0) {
          resolve({ downloadPath, progressLog });
        } else {
          let errorDetail = `下载失败，curl 退出码: ${code}.`;
          if (progressLog.length > 0) {
            errorDetail += ` Curl 输出摘要: ${progressLog.join('; ')}`;
          }
          if (lineBuffer.trim().length > 0 && !progressLog.some(l => l.includes(lineBuffer.trim()))) {
            errorDetail += ` Curl stderr tail: ${lineBuffer.trim()}`;
          }
          reject(new Error(errorDetail));
        }
      });

      curl.on('error', (spawnError) => {
        clearTimeout(timeoutId); // Clear timeout on spawn error too
        reject(new Error(`执行下载命令时出错: ${spawnError.message}`));
      });

      const timeoutId = setTimeout(() => {
        if (!curl.killed) {
           curl.kill();
        }
        reject(new Error(`下载超时（${timeoutMs / 60000}分钟）`));
      }, timeoutMs);
    });
  } catch (error: any) {
    throw error;
  }
}

// 后台下载文件，不等待完成
async function downloadFileInBackground(url: string, filename: string, downloadDir: string, timeoutMs: number = 300000): Promise<void> {
  try {
    // 构建后台下载命令
    const downloadPath = path.join(downloadDir, filename);
      let command = `curl -L -A "yunpan_mcp_server" "${url}" -o "${downloadPath}"`;
      if (process.platform === 'win32') {
        command += ' --ssl-reqd --tlsv1.2'; // 添加 Windows 特定的 SSL/TLS 参数
      }
      command += ' &';
    
    // 执行后台下载命令
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`后台下载失败: ${error.message}`);
        return;
      }
      console.error(`后台下载已启动: ${filename}`);
    });
  } catch (error: any) {
    console.error(`启动后台下载失败: ${error.message}`);
  }
}

export function registerFileDownloadStdioTool(server: McpServer) {
  server.tool(
    "file-download-stdio",
    "获取云盘中指定文件的下载链接并支持直接下载文件。可以指定下载目录，默认下载到用户主目录的 .mcp-downloads 文件夹中。",
    {
      nid: z.string().describe("文件的唯一标识ID，可通过文件列表或搜索获取"),
      auto: z.boolean().optional().describe("是否直接下载文件，默认为 true"),
      downloadDir: z.string().optional().describe("指定下载目录，必须有读写权限，默认为用户主目录下的 .mcp-downloads 文件夹"),
    },
    async ({ nid, auto = true, downloadDir: userDownloadDir }, mcpReq: any) => {
      // 设置下载目录，如果用户未指定则使用默认目录
      const downloadDir = userDownloadDir || path.join(homedir(), '.mcp-downloads');
      const httpContext = gethttpContext(mcpReq, server);
      
      // 使用transport中的authInfo
      const transportAuthInfo = httpContext.authInfo;
      try {
        let authInfo: AuthInfo;
        const extraParams = {
          nid: nid
        };
        
        try {
          // 传入方法名和路径等参数
          authInfo = await getAuthInfo({
            method: 'Sync.getVerifiedDownLoadUrl',
            extraParams: extraParams
          }, transportAuthInfo);
          
          authInfo.request_url = getConfig(transportAuthInfo?.ecsEnv).request_url
        } catch (authError) {
          throw new Error("获取鉴权信息失败，请提供有效的API_KEY");
        }
        
        // 调用API获取下载链接
        const apiResponse = await getDownloadUrl(authInfo, nid);
        
        if (apiResponse && apiResponse.errno === 0) {
          const downloadData = apiResponse.data || {};
          const downloadUrl = downloadData.downloadUrl || '';
          
          if (!downloadUrl) {
            return {
              content: [{ type: "text", text: "未能获取到文件下载链接" }],
            };
          }

          // 从URL中提取文件信息和大小
          const {filename, sizeMB} = extractFileInfoFromUrl(downloadUrl);
          const fileSizeInfo = sizeMB > 0 ? `${sizeMB.toFixed(2)} MB` : "未知大小";
          
          // 计算超时时间
          const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes
          let estimatedTimeoutMs = DEFAULT_TIMEOUT_MS;
          const MAX_TIMEOUT_MS = 30 * 60 * 1000; // Max 30 minutes timeout
          const TIMEOUT_INCREMENT_PER_MB_MS = 1000; // 1 second per MB
          const BASE_SIZE_FOR_INCREMENTAL_TIMEOUT_MB = 200; // Apply incremental timeout for files larger than 200MB

          if (sizeMB > BASE_SIZE_FOR_INCREMENTAL_TIMEOUT_MB) {
            estimatedTimeoutMs = DEFAULT_TIMEOUT_MS + 
                               (sizeMB - BASE_SIZE_FOR_INCREMENTAL_TIMEOUT_MB) * TIMEOUT_INCREMENT_PER_MB_MS;
            estimatedTimeoutMs = Math.min(estimatedTimeoutMs, MAX_TIMEOUT_MS);
          }

          if (auto) {
            let initialMessage = `正在准备下载文件 (大小: ${fileSizeInfo}).`;
            if (estimatedTimeoutMs > DEFAULT_TIMEOUT_MS) {
              initialMessage += ` 由于文件较大，预计超时时间已调整为 ${(estimatedTimeoutMs / 60000).toFixed(1)} 分钟。`;
            }
            // It's tricky to send this initialMessage to MCP client before download starts in a single request-response.
            // For now, this console.error serves as a server-side log.

            try {
              // 使用从URL中提取的文件名
              
              // 检查目录权限
              const hasPermission = await checkAndCreateDirectory(downloadDir);
              if (!hasPermission) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `❌ 下载失败: 目录 ${downloadDir} 没有读写权限`
                    },
                    {
                      type: "text",
                      text: TOOL_LIMIT_NOTE
                    }
                  ]
                };
              }
              
              // 对于大于10MB的文件，使用后台下载
              if (sizeMB > 10) {
                // 启动后台下载
                downloadFileInBackground(downloadUrl, filename, downloadDir, estimatedTimeoutMs);
                
                return {
                  content: [
                    {
                      type: "text",
                      text: `🚀 正在下载中，请稍后在"${downloadDir}"目录查看\n` +
                            `📁 文件名：${filename}\n` +
                            `🔗 下载链接：${downloadUrl}\n` +
                            `📦 文件大小：${fileSizeInfo}`
                    },
                    {
                      type: "text",
                      text: TOOL_LIMIT_NOTE
                    }
                  ]
                };
              }
              
              // 对于小文件，等待下载完成
              const { downloadPath, progressLog } = await downloadFileWithCurl(downloadUrl, filename, downloadDir, estimatedTimeoutMs);
              
              return {
                content: [
                  {
                    type: "text",
                    text: `✅ 文件下载完成！\n` +
                          `📁 文件名：${filename}\n` +
                          `💾 保存路径：${downloadPath}\n` +
                          `🔗 下载链接：${downloadUrl}\n` +
                          `📦 文件大小：${fileSizeInfo}`
                  },
                  {
                    type: "text",
                    text: TOOL_LIMIT_NOTE
                  }
                ]
              };
            } catch (downloadError: any) {
              const errorMessage = downloadError.message || "未知下载错误";
              return {
                content: [
                  {
                    type: "text",
                    text: `❌ 文件下载失败\n` +
                          `📝 错误信息：${errorMessage}\n` +
                          `🔗 下载链接：${downloadUrl}\n` +
                          `📦 文件大小：${fileSizeInfo}`
                  },
                  {
                    type: "text",
                    text: TOOL_LIMIT_NOTE
                  }
                ]
              };
            }
          }

          // 如果不下载，只返回链接和文件大小
          return {
            content: [
              {
                type: "text",
                text: `文件下载地址：${downloadUrl}\n📦 文件大小：${fileSizeInfo}`
              },
              {
                type: "text",
                text: TOOL_LIMIT_NOTE
              }
            ]
          };
        } else {
          throw new Error(apiResponse?.errmsg || "API请求失败");
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `获取文件下载链接时发生错误: ${error.message}`,
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
