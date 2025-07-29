import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthInfo, AuthInfo } from "../utils/auth.js";
import fs from 'fs';
import { TOOL_LIMIT_NOTE } from "../utils/const.js";
import { gethttpContext } from "../utils/transport.js";

// 在这里声明UploadNode类型，实际使用时会从@q/sec_sdk_node导入
// 由于这是第三方库，我们需要声明类型来避免TypeScript错误
// @ts-ignore
declare class UploadNode {
  constructor(config: any, callbacks: any);
  addWaitFile(filePaths: string[]): void;
}

// 动态导入SDK
async function importUploadSDK() {
  try {
    // 动态导入SDK，避免编译时的依赖问题
    // @ts-ignore
    const module = await import('@aicloud360/sec-sdk-node');
    return module.UploadNode;
  } catch (error) {
    console.error('导入@aicloud360/sec-sdk-node失败:', error);
    throw new Error('请先安装@aicloud360/sec-sdk-node: npm install @aicloud360/sec-sdk-node');
  }
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// 格式化时间戳为可读时间
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// 获取文件类别名称
function getFileCategoryName(category: string): string {
  const categories: Record<string, string> = {
    '-1': '所有',
    '0': '其他',
    '1': '图片',
    '2': '文档',
    '3': '音乐',
    '4': '视频'
  };
  
  return categories[category] || '未知';
}

// 定义文件上传结果详情接口
interface FileUploadDetail {
  fileName: string;
  fileId: string;
  fileSize: string;
  fileType: string;
  createTime: string;
  modifyTime: string;
  filePath: string;
  fileHash?: string;
  uploadSpeed?: string;
}

// 定义API错误结构接口
interface ApiError {
  errno?: number;      // 错误码
  errmsg?: string;     // 错误消息
  data?: any;          // 附加数据
  trace_id?: string;   // 追踪ID
  consume?: number;    // 处理耗时
  message?: string;    // 一般错误信息
  stack?: string;      // 堆栈信息
}

// 定义文件上传错误结构
interface FileUploadError {
  fileName: string;    // 文件名
  filePath?: string;   // 文件路径
  originalError: ApiError | Error | any;  // 原始错误
  formattedMessage: string;  // 格式化后的错误消息
}

// 使用文件路径方式上传文件
async function uploadFilesByPath(authInfo: AuthInfo, filePaths: string[], uploadPath: string): Promise<any> {
  return new Promise(async (resolve, reject) => {
    try {
      // 动态导入SDK
      const UploadNode = await importUploadSDK();
      
      // 检查所有文件是否存在
      for (const filePath of filePaths) {
        if (!fs.existsSync(filePath)) {
          reject(new Error(`文件不存在: ${filePath}`));
          return;
        }
      }
      
      // 创建上传配置
      const config = {
        qid: process.env.qid || authInfo.qid || '0',
        token: process.env.ECS_TOKEN || authInfo.token || '',
        access_token: process.env.ECS_ACCESS_TOKEN || authInfo.access_token || '',
        env: process.env.ECS_ENV || 'prod',
        path: uploadPath || '/'
      };
      
      // 上传错误数组
      let uploadErrors: FileUploadError[] = [];
      
      // 记录开始时间
      const startTime = Date.now();
      
      // 存储重名文件列表
      let duplicateFiles: any[] = [];
      
      // 存储上传结果集合
      let uploadResults: any[] = [];
      
      // 记录文件上传开始时间 (fileId -> timestamp)
      const fileStartTimes: Record<string, number> = {};
      
      // 记录文件上传进度信息 (fileId -> {loaded, total, name})
      const fileProgressInfo: Record<string, {loaded: number, total: number, name: string}> = {};
      
      // 格式化API错误
      const formatApiError = (error: any, file: any): FileUploadError => {
        let formattedMessage = '';
        let apiError: ApiError = {};
        
        // 尝试解析API错误
        if (error && typeof error === 'object') {
          // 如果错误包含errno和errmsg，则是标准API错误
          if ('errno' in error && 'errmsg' in error) {
            apiError = error as ApiError;
            formattedMessage = `错误码: ${apiError.errno}, 错误信息: ${apiError.errmsg}`;
            if (apiError.trace_id) {
              formattedMessage += `, 追踪ID: ${apiError.trace_id}`;
            }
          } else if (error instanceof Error) {
            // 标准Error对象
            apiError = {
              message: error.message,
              stack: error.stack
            };
            formattedMessage = error.message;
          } else if (error.message) {
            // 有message属性但不是标准Error
            apiError = {
              message: error.message
            };
            formattedMessage = error.message;
          } else {
            // 其他情况
            apiError = error;
            formattedMessage = JSON.stringify(error);
          }
        } else {
          // 非对象类型错误
          formattedMessage = String(error);
          apiError = { message: formattedMessage };
        }
        
        return {
          fileName: file?.name || '未知文件',
          filePath: file?.path || '',
          originalError: apiError,
          formattedMessage
        };
      };
      
      // 创建上传器实例
      const uploader = new UploadNode(config, {
        success: (result: any) => {
          
          // 文件ID
          const fileId = result.fid || result.nid;
          
          // 保存上传结果到结果集合
          uploadResults.push({
            ...result,
            uploadEndTime: Date.now(),
            uploadStartTime: fileStartTimes[fileId] || startTime
          });
        },
        progress: (fid: string, loaded: number, total: number, file: any) => {
          if (!loaded) {
            return;
          }
          
          // 记录文件开始上传的时间
          if (!fileStartTimes[fid]) {
            fileStartTimes[fid] = Date.now();
          }
          
          // 记录文件进度信息
          fileProgressInfo[fid] = {
            loaded,
            total,
            name: file.name
          };
          
          console.error(
            'id: ', fid, 
            '上传进度:' + Math.floor((loaded / total) * 100) + '%', 
            '文件:', file.name, 
            '已上传:', formatSize(loaded), 
            '总大小:', formatSize(total)
          );
        },
        error: (file: any, error: any) => {
          // 将错误添加到错误数组中
          uploadErrors.push(formatApiError(error, file));
        },
        duplicateList: (list: any, resData: any) => {
          // 存储重名文件信息
          duplicateFiles = list.map((item: any) => ({
            fileName: item.name || '未知',
            fileId: item.nid || '未知',
            fileSize: item.count_size ? formatSize(parseInt(item.count_size)) : '未知',
            fileType: getFileCategoryName(item.file_category || '0'),
            createTime: item.create_time ? formatTimestamp(parseInt(item.create_time)) : '未知',
            modifyTime: item.modify_time ? formatTimestamp(parseInt(item.modify_time)) : '未知',
            filePath: item.path || uploadPath
          }));
        },
        complete() {
          console.error('上传完成');
          
          // 处理上传错误
          if (uploadErrors.length > 0 && uploadResults.length === 0) {
            // 如果所有文件都上传失败，则拒绝promise
            const errorMessages = uploadErrors.map(err => 
              `文件: ${err.fileName} - ${err.formattedMessage}`
            ).join('; ');
            reject(new Error(`所有文件上传失败: ${errorMessages}`));
            return;
          }
          
          // 计算总上传耗时
          const endTime = Date.now();
          const totalUploadTime = ((endTime - startTime) / 1000).toFixed(2);
          
          // 添加上传耗时信息
          const resultWithTiming = {
            uploadResults: uploadResults,
            totalUploadTime: totalUploadTime,
            startTime: startTime,
            endTime: endTime,
            duplicateFiles: duplicateFiles, // 添加重名文件列表到结果中
            fileCount: uploadResults.length,
            totalFileCount: filePaths.length,
            progressInfo: fileProgressInfo,
            uploadErrors: uploadErrors // 添加上传错误列表
          };
          
          // 解析结果并返回
          resolve(resultWithTiming);
        }
      });
      
      // 使用addWaitFile添加文件路径,开始上传
      console.error(`准备上传 ${filePaths.length} 个文件到 ${uploadPath}`);
      uploader.addWaitFile(filePaths);
      
    } catch (error) {
      console.error('上传文件过程中出错:', error);
      reject(error);
    }
  });
}

export function registerUploadFileStdioTool(server: McpServer) {
  server.tool(
    "file-upload-stdio",
    "将本地文件上传到云盘指定路径。支持批量上传多个文件。",
    {
      filePaths: z.array(z.string()).describe("本地文件路径数组，例如：['/本地/文件1.txt', '/本地/文件2.jpg']"),
      uploadPath: z.string().optional().default('/').describe("云盘上传目标路径，默认为根目录'/'")
    },
    async ({ filePaths, uploadPath }, mcpReq: any) => {
      const httpContext = gethttpContext(mcpReq, server);
            
      // 使用transport中的authInfo
      const transportAuthInfo = httpContext.authInfo;
      try {
        let authInfo: AuthInfo;
        
        try {
          // 获取鉴权信息
          authInfo = await getAuthInfo({}, transportAuthInfo);

        } catch (authError) {
          console.error("自动获取鉴权信息失败:", authError);
          throw new Error("获取鉴权信息失败，请提供有效的API_KEY");
        }
        
        try {
          // 检查必填参数
          if (!filePaths || filePaths.length === 0) {
            throw new Error("filePaths为必填参数且不能为空");
          }
          
          // 使用文件路径方式上传
          const uploadResult = await uploadFilesByPath(authInfo, filePaths, uploadPath);
          
          const uploadResults = uploadResult.uploadResults || [];
          const totalUploadTime = uploadResult.totalUploadTime || '未知';
          const duplicateFiles = uploadResult.duplicateFiles || [];
          const progressInfo = uploadResult.progressInfo || {};
          const uploadErrors = uploadResult.uploadErrors || [];
          
          // 处理上传结果，为每个文件创建详细信息
          const fileDetails: FileUploadDetail[] = uploadResults.map((result: any) => {
            const uploadRes = result.uploadRes || result || {};
            const fileId = result.fid || uploadRes.nid || '未知';
            const fileName = uploadRes.name || result.name || '未知';
            
            // 计算单个文件上传耗时
            const fileUploadTime = result.uploadStartTime && result.uploadEndTime
              ? ((result.uploadEndTime - result.uploadStartTime) / 1000).toFixed(2)
              : '未知';
            
            // 获取文件大小和计算上传速度
            let fileSize = '未知';
            let uploadSpeed = '未知';
            
            if (progressInfo[fileId]) {
              fileSize = formatSize(progressInfo[fileId].total);
              if (fileUploadTime !== '未知') {
                uploadSpeed = formatSize(progressInfo[fileId].total / parseFloat(fileUploadTime)) + '/s';
              }
            } else if (uploadRes.count_size) {
              fileSize = formatSize(parseInt(uploadRes.count_size));
              if (fileUploadTime !== '未知') {
                uploadSpeed = formatSize(parseInt(uploadRes.count_size) / parseFloat(fileUploadTime)) + '/s';
              }
            }
            
            return {
              fileName: fileName,
              fileId: fileId,
              fileSize: fileSize,
              fileType: getFileCategoryName(uploadRes.file_category || '0'),
              createTime: uploadRes.create_time ? formatTimestamp(parseInt(uploadRes.create_time)) : '未知',
              modifyTime: uploadRes.modify_time ? formatTimestamp(parseInt(uploadRes.modify_time)) : '未知',
              filePath: uploadPath,
              fileHash: uploadRes.file_hash || undefined,
              uploadSpeed: uploadSpeed
            };
          });
          
          // 构建上传摘要
          const uploadSummary = [
            `总计上传文件数: ${fileDetails.length}/${filePaths.length}`,
            `总上传耗时: ${totalUploadTime}秒`,
            `上传路径: ${uploadPath}`
          ].join('\n');
          
          // 构建详细的文件信息文本
          const fileDetailsText = fileDetails.map((detail, index) => {
            return [
              `文件 ${index + 1}:`,
              `  文件名: ${detail.fileName}`,
              `  文件ID: ${detail.fileId}`,
              `  文件大小: ${detail.fileSize}`,
              `  文件类型: ${detail.fileType}`,
              `  创建时间: ${detail.createTime}`,
              `  修改时间: ${detail.modifyTime}`,
              `  存储路径: ${detail.filePath}`,
              detail.fileHash ? `  文件哈希: ${detail.fileHash}` : '',
              `  上传速度: ${detail.uploadSpeed || '未知'}`
            ].filter(line => line).join('\n');
          }).join('\n\n');
          
          // 构建重名文件提示信息
          let duplicateFilesText = '';
          if (duplicateFiles.length > 0) {
            duplicateFilesText = '\n\n检测到以下文件已存在（重名文件）：\n' + 
              duplicateFiles.map((file: any, index: number) => 
                `${index + 1}. 文件名: ${file.fileName}\n   路径: ${file.filePath}\n   大小: ${file.fileSize}\n   创建时间: ${file.createTime}`
              ).join('\n\n');
          }
          
          // 构建错误文件提示信息
          let errorFilesText = '';
          if (uploadErrors.length > 0) {
            errorFilesText = '\n\n以下文件上传失败：\n' + 
              uploadErrors.map((errorInfo: FileUploadError, index: number) => {
                // 获取API错误详情
                const apiError = errorInfo.originalError;
                let detailText = '';
                
                if (apiError && typeof apiError === 'object' && 'errno' in apiError) {
                  // 标准API错误
                  detailText = [
                    `   错误码: ${apiError.errno}`,
                    `   错误信息: ${apiError.errmsg || '未知'}`,
                    apiError.trace_id ? `   追踪ID: ${apiError.trace_id}` : '',
                    apiError.consume ? `   处理耗时: ${apiError.consume}ms` : ''
                  ].filter(line => line).join('\n');
                } else {
                  // 普通错误
                  detailText = `   错误信息: ${errorInfo.formattedMessage}`;
                }
                
                return `${index + 1}. 文件名: ${errorInfo.fileName}\n${detailText}`;
              }).join('\n\n');
          }
          
          // 返回上传成功信息
          return {
            content: [
              {
                type: "text",
                text: `文件上传完成！\n\n${uploadSummary}\n\n${fileDetailsText}${duplicateFilesText}${errorFilesText}`,
              },
              {
                type: "text",
                text: TOOL_LIMIT_NOTE,
              },
            ],
          };
        } catch (uploadError: any) {
          throw uploadError;
        }
      } catch (error: any) {
        console.error("上传文件出错:", error);
        return {
          content: [
            {
              type: "text",
              text: `上传文件时发生错误: ${error.message}`,
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
