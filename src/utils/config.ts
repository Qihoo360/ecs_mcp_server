import fs from 'fs';
import path from 'path';

export interface ServerConfig {
  name: string;
  version: string;
}

export function loadConfig(): ServerConfig {
  try {
     // 尝试从package.json获取基本信息
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    // 默认配置
    return {
      name: packageData.name,
      version: packageData.version
    };
  } catch (error) {
    console.error('加载配置失败，使用默认配置', error);
    return {
      name: 'mcp-server',
      version: '1.0.0'
    };
  }
} 