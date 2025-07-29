import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import del from 'rollup-plugin-delete';
import json from '@rollup/plugin-json';
import { readFileSync } from 'fs';
import terser from '@rollup/plugin-terser';

// 环境变量
const isProd = process.env.NODE_ENV === 'production';
const isDev = process.env.NODE_ENV === 'development';
console.log(`构建模式: ${isProd ? '生产环境' : isDev ? '开发环境' : '默认'}`);

// 读取 package.json
const pkg = JSON.parse(readFileSync('./package.json', { encoding: 'utf8' }));

// 获取所有的依赖项，它们将被视为外部模块
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {})
];

// 对于外部依赖，创建正确的导入路径
const globals = {};
for (const dep of external) {
  globals[dep] = dep;
}

export default {
  input: 'src/index.ts',
  output: {
    dir: 'build',
    format: 'es',
    exports: 'named',
    preserveModules: false,  // 不再保持模块结构，生成单个或少量文件
    sourcemap: !isProd,  // 非生产环境生成 sourcemap
    generatedCode: {
      constBindings: true  // 使用 const 替代 var 声明
    },
    // 在输出时进行基本的压缩
    compact: isProd,  // 生产环境压缩代码
    minifyInternalExports: isProd  // 压缩内部导出
  },
  external,  // 排除外部依赖，减少打包体积
  plugins: [
    // 构建前清理输出目录
    del({ targets: 'build/*' }),
    
    // 解析并处理 JSON 文件
    json(),
    
    // 解析第三方模块
    resolve({
      preferBuiltins: true,  // 优先使用 Node.js 内置模块
      exportConditions: ['node'],  // 适配 Node.js 环境
      extensions: ['.mjs', '.js', '.json', '.ts']  // 支持的文件扩展名
    }),
    
    // 将 CommonJS 模块转换为 ES 模块
    commonjs({
      transformMixedEsModules: true,  // 支持混合模块
      extensions: ['.js', '.ts']  // 转换的文件扩展名
    }),
    
    // 编译 TypeScript
    typescript({
      tsconfig: './tsconfig.json',
      outputToFilesystem: true,  // 提高性能
      sourceMap: !isProd,  // 非生产环境生成 sourcemap
      // 生产环境下使用 TypeScript 自带的优化
      inlineSourceMap: false,
      inlineSources: false,
      removeComments: isProd
    }),
    
    // 生产环境下使用 terser 进行代码压缩和混淆
    isProd && terser({
      compress: {
        pure_getters: true,
        conditionals: true,
        unused: true,
        comparisons: true,
        sequences: true,
        dead_code: true,
        evaluate: true,
        if_return: true,
        join_vars: true,
        drop_console: true, // 移除控制台日志
        drop_debugger: true, // 移除debugger语句
      },
      format: {
        comments: false, // 删除注释
      },
      mangle: {
        properties: {
          regex: /^_/ // 只混淆以下划线开头的属性名
        }
      }
    })
  ].filter(Boolean),  // 过滤掉可能为false的插件
  
  // 优化构建性能的选项
  treeshake: {
    moduleSideEffects: false,  // 假设模块没有副作用，提高摇树优化效果
    tryCatchDeoptimization: false,  // 禁用 try/catch 导致的优化禁用
    propertyReadSideEffects: false,  // 假设属性读取没有副作用
    unknownGlobalSideEffects: false  // 减少未知全局变量的副作用假设
  },
  
  // 开发模式下使用监听选项
  watch: isDev ? {
    include: 'src/**',
    clearScreen: false  // 防止清屏
  } : null,
  
  // 更好的错误报告
  onwarn(warning, warn) {
    // 忽略某些警告
    if (warning.code === 'THIS_IS_UNDEFINED') return;
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  }
}; 