# 360 AI 云盘 MCP

360 AI 云盘的 Model Context Protocol 接入服务，让 AI 模型能够通过 MCP 协议直接操作云盘，提供完整的云盘文件管理能力。

## 📚 简介

本项目为 360 AI 云盘的 MCP（Model Context Protocol）服务实现，允许各类 AI 模型（如大语言模型）通过标准的 MCP 协议与 360 AI 云盘进行交互。通过这种方式，AI 模型可以帮助用户管理云盘文件，极大地提升了文件管理的智能化和便捷性。

## 🔧 配置方式（在 Cursor 中配置）

###  Stdio 接入方式

在 `~/.cursor/mcp.json` 文件中添加以下配置，连接 360 AI 云盘 MCP 服务：

```json
{
  "mcpServers": {
    "360-mcp-server-disk": {
      "command": "npx",
      "args": [
        "-y",
        "@aicloud360/mcp-server-disk"
      ],
      "env": {
        "API_KEY": "_xxxxxxxxx"
      }
    }
  }
}
```

### Streamable HTTP 接入方式

如果您希望通过HTTP方式接入，可以使用以下配置：

```json
{
  "mcpServers": {
    "mcp-server-disk-http": {
      "url": "https://mcp.yunpan.com/mcp?api_key=_xxxxxxxxx"
    }
  }
}
```

Streamable HTTP接入方式的特点：
- 无需安装 nodejs 环境
- 无需下载到本地运行
- 通过URL参数传递API_KEY进行认证
- 适合需要HTTP接口的集成场景

### SSE 接入方式

如果您希望通过SSE（Server-Sent Events）方式接入，可以使用以下配置：

```json
{
  "mcpServers": {
    "mcp-server-disk-sse": {
      "url": "https://mcp.yunpan.com/sse?api_key=_xxxxxxxxx"
    }
  }
}
```

SSE接入方式的特点：
- 基于HTTP长连接的服务器推送技术
- 实时性更强，适合需要即时响应的场景
- 单向通信，服务器向客户端推送数据
- 无需安装额外环境，浏览器原生支持
- 通过URL参数传递API_KEY进行认证

## 🔐 认证配置

使用 360 AI 云盘 MCP 服务需要以下认证信息：

- `API_KEY`：360AI云盘 API 密钥，格式为 "yunpan_" 开头的字符串

您可以通过以下方式获取API_KEY：
   - 参照 [快速接入](https://open.yunpan.360.cn/docs/mcp-server/preparation) MCP Server

### 360 AI 云盘开放平台优势

360 AI 云盘开放平台提供了多元化的产品能力和一站式文件服务：

- **账号一键关联**：无需重新注册账号，现有360 AI 云盘账号一键关联，实现"多平台，一账号"的无缝登录体验
- **支持 MCP 协议接入**：支持 Stdio/SSH/Streamable HTTP/SSE 协议，通过 MCP Client 轻松接入
- **丰富接口能力**：提供文件上传、下载、搜索、新建、重命名、移动、分享等 API，满足不同场景需求

访问 [360 AI 云盘开放平台官网](https://open.yunpan.360.cn) 获取更多详细信息和最新的开发文档。

## ✨ 功能概览

本 MCP 服务提供与 360AI 云盘交互的多种操作，包括：

- 📁 文件列表浏览 - 查看云盘目录内容
- 🔍 文件搜索 - 根据关键词搜索云盘文件
- ⬆️ 文件上传 - 将文件上传至 360 云盘
- ⬇️ 文件下载 - 获取云盘文件下载链接并支持直接下载
- 🎬 视频下载 - 通过URL下载视频到云盘，支持批量下载和实时进度监控
- 💾 文件保存 - 通过URL或文本内容保存文件到云盘
- 📂 目录创建 - 在云盘中创建新文件夹
- ✏️ 文件重命名 - 修改云盘文件或文件夹名称
- 🚚 文件移动 - 将文件移动到其他位置
- 🔗 文件分享 - 将指定文件生成分享链接
- 🔑 用户个人信息 - 获取用户信息

## 🛠️ 工具使用指南

当连接到 360 AI 云盘 MCP 服务后，可以使用以下工具与云盘交互：

### 文件上传 (file-upload-stdio) - 仅支持Stdio接入方式

将本地文件上传到 360 AI云盘指定路径。

**参数：**
- `filePaths`: 本地文件的完整路径（必填，可以是字符串数组包含多个文件）
- `uploadPath`: 上传到云盘的目标目录，默认为根目录 `/`

**示例：**
```json
{
  "filePaths": ["/Users/username/Documents/报告.docx", "/Users/username/Documents/数据.xlsx"],
  "uploadPath": "/工作文件"
}
```

**单文件上传示例：**
```json
{
  "filePaths": "/Users/username/Desktop/测试文档.pdf",
  "uploadPath": "/文档"
}
```

### 文件下载 (file-download-stdio) - 仅支持Stdio接入方式

获取云盘中指定文件的下载链接并支持直接下载文件。

**参数：**
- `nid`: 文件的唯一标识ID，可通过文件列表或搜索获取（必填）
- `auto`: 是否直接下载文件，默认为true
- `downloadDir`: 指定下载目录，必须有读写权限，默认为用户主目录下的.mcp-downloads文件夹

**仅获取下载链接示例：**
```json
{
  "nid": "12345678",
  "auto": false
}
```

**下载到指定目录示例：**
```json
{
  "nid": "12345678",
  "auto": true,
  "downloadDir": "/Users/username/Downloads"
}
```

### 文件列表查询 (file-list)

获取 360 AI云盘指定路径下的文件和文件夹列表。

**参数：**
- `path`: 要查询的路径，默认为根目录 `/`
- `page`: 页码，默认为 0
- `page_size`: 每页显示条数，默认为 50

**示例：**
```json
{
  "path": "/文档",
  "page": 1,
  "page_size": 20
}
```

### 文件搜索 (file-search)

根据关键词搜索 360 AI云盘文件。

**参数：**
- `key`: 搜索关键词（必填）
- `file_category`: 文件类型（-1:全部，0:其他，1:图片，2:文档，3:音乐，4:视频），默认为 -1
- `page`: 页码，默认为 1
- `page_size`: 每页显示条数，默认为 20

**示例：**
```json
{
  "key": "报告",
  "file_category": 2,
  "page": 1
}
```

### 文件保存 (file-save)

通过URL或文本内容保存文件到云盘。

**参数：**
- `url`: 文件下载地址（url或content必传1个）
- `content`: 文件内容，支持markdown格式（url或content必传1个）
- `upload_path`: 云盘存储路径，必须以/开头，默认为"/来自：mcp_server/"

**通过URL保存示例：**
```json
{
  "url": "https://example.com/sample.pdf",
  "upload_path": "/文档/下载/"
}
```

**通过文本内容保存示例：**
```json
{
  "content": "# 标题\n这是一段Markdown格式的文本内容",
  "upload_path": "/笔记/"
}
```

### 视频下载 (video-download)

通过URL下载视频到云盘，支持批量下载和实时进度监控。此操作可能需要较长时间，建议客户端设置更长的超时时间（建议300秒以上）。

**参数：**
- `urls`: 视频URL，多个URL使用英文竖线'|'分隔（必填）

**单视频下载示例：**
```json
{
  "urls": "https://example.com/video.mp4"
}
```

**批量视频下载示例：**
```json
{
  "urls": "https://example.com/video1.mp4|https://example.com/video2.mp4|https://example.com/video3.mp4"
}
```

**功能特点：**
- 🎯 **批量下载**：支持同时下载多个视频URL
- 📊 **实时进度**：提供详细的下载进度监控，包括任务状态分布
- 🔄 **自动轮询**：自动轮询任务状态直到完成，无需手动查询
- 📁 **云盘存储**：下载的视频直接保存到云盘，提供云盘文件链接
- ⚡ **状态跟踪**：实时跟踪任务状态（待开始/下载中/下载成功/上传成功/失败）
- 🔗 **便捷访问**：完成后提供云盘文件链接，方便直接访问

**返回结果说明：**
- 成功下载的视频会显示云盘文件路径、文件大小、访问链接等信息
- 失败的视频会显示具体的失败原因
- 支持结构化数据返回，便于程序处理

### 创建文件夹 (make-dir)

在 360 AI云盘中创建新文件夹。

**参数：**
- `fname`: 文件夹路径，例如：`/新文件夹/`（必填）

**示例：**
```json
{
  "fname": "/工作文件/项目A/"
}
```

### 文件分享 (file-share)

将指定文件生成分享链接。

**参数：**
- `paths`: 要分享的文件路径，多个文件路径用竖线(|)隔开（必填）

**示例：**
```json
{
  "paths": "/文档/报告.docx|/文档/数据.xlsx"
}
```

### 移动文件 (file-move)

移动 360 AI云盘中的文件或文件夹到新位置。

**参数：**
- `src_name`: 文件原路径，多个路径用竖线隔开（必填）
- `new_name`: 目标路径（必填）

**示例：**
```json
{
  "src_name": "/文档/报告.docx|/文档/数据.xlsx",
  "new_name": "/归档文件夹/"
}
```

### 重命名文件 (file-rename)

重命名 360AI 云盘中的文件或文件夹。

**参数：**
- `src_name`: 原路径名称，如：`/文件夹/旧文件名.txt`（必填）
- `new_name`: 新名称，如：`新文件名.txt`（必填）

**示例：**
```json
{
  "src_name": "/文档/草稿.docx",
  "new_name": "最终报告.docx"
}
```

### 用户个人信息 (user-info)

获取 360 AI云盘用户个人信息。

**参数：**
- 无


## 🧠 AI 应用场景

通过 360 AI 云盘 MCP 接入，AI 可以帮助用户实现以下场景：

- **智能文件整理**：AI 可以分析用户文件内容，并自动归类整理
- **文档智能检索**：使用自然语言描述查找云盘内的文档
- **自动文件备份**：根据用户习惯，提供智能备份建议
- **文件内容分析**：分析文档内容并提供摘要或见解
- **基于对话的文件操作**：用户可以通过对话方式管理云盘文件
- **文件上传及分享**：用户可以通过对话方式保存文件到云盘，并生成文件分享链接，方便把文件分享给他人
- **网络资源保存**：用户可以通过提供URL，让AI帮助将网络资源保存到云盘
- **文件内容创建与保存**：AI可以根据用户需求创建文档内容，并直接保存到云盘
- **云盘文件下载**：用户可以通过对话方式从云盘下载文件到本地
- **视频资源下载**：用户可以通过提供视频URL，让AI帮助将视频下载到云盘，支持批量下载和进度监控

## 🔑 关键词

- 360 AI 云盘
- mcp
- modelcontextprotocol
- ai助手
- 文件管理
- 视频下载
- 批量下载
- sse
- streamable http

## 📄 许可证

Apache-2.0
