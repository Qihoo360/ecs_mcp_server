import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetFilesTool } from "./file-list.js";
import { registerFileSearchTool } from "./file-search.js";
// import { registerFileDownloadStdioTool } from "./file-download-stdio.js";
import { registerMakeDirTool } from "./make-dir.js";
// import { registerFileDelTool } from "./file-del.js";
import { registerFileMoveTool } from "./file-move.js";
import { registerFileRenameTool } from "./file-rename.js";
// import { registerUploadFileStdioTool } from "./file-upload-stdio.js";
import { registerFileShareTool } from "./file-share.js";
import { registerUserInfoTool } from "./user-info.js";
import { registerFileSaveTool } from "./file-save.js";
import { registerVideoDownloadTool } from "./video-download.js";

/**
 * 注册所有工具到指定的 MCP 服务器实例
 * @param server MCP 服务器实例
 */
export function registerAllTools(server: McpServer) {
  // 注册云盘工具
  registerGetFilesTool(server);
  registerFileSearchTool(server);
  
  // 根据配置决定是否注册文件传输工具
  // const args = process.argv.slice(2);
  // const disableTransfer = args.includes('--sse') || args.includes('--http');
  // if (!disableTransfer) {
  //   registerFileDownloadStdioTool(server);
  //   registerUploadFileStdioTool(server);
  // }

  registerMakeDirTool(server);
  // registerFileDelTool(server);
  registerFileMoveTool(server);
  registerFileRenameTool(server);
  registerFileShareTool(server);
  registerUserInfoTool(server);
  registerFileSaveTool(server);
  registerVideoDownloadTool(server);
}
