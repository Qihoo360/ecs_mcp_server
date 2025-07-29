import { chmodSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

try {
  // 入口文件路径
  const entryFile = join(process.cwd(), 'build', 'index.js');
  
  // 给入口文件添加执行权限
  chmodSync(entryFile, '755');
  console.log(`已成功为入口文件添加执行权限: ${entryFile}`);
} catch (error) {
  console.error('处理入口文件时出错:', error);
  process.exit(1);
} 