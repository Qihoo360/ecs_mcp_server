import crypto from 'crypto';
import { YUNPAN_API_KEY } from './const.js';

/**
 * PHP风格的URL编码
 * @param str 需要编码的字符串
 * @returns 编码后的字符串
 */
export function phpUrlEncode(str: string): string {
  return encodeURIComponent(str)
    // 将空格替换为+
    .replace(/%20/g, '+')
    // 处理其他需替换的字符
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 计算MD5哈希
 * @param data 要哈希的数据
 * @returns MD5哈希值
 */
export function md5(data: string): string {
  return crypto.createHash('md5').update(data, 'utf8').digest('hex');
}

/**
 * 生成API请求签名
 * @param params 请求参数
 * @param secretKey 密钥 (如果提供则使用，否则使用默认值)
 * @returns 生成的签名
 */
export function generateSign(params: Record<string, string>, secretKey: string = YUNPAN_API_KEY): string {
  // 1. 按字典序升序排序键
  const sortedKeys = Object.keys(params).sort();

  // 2. 生成key=encodedValue形式的字符串并用&连接
  const keyValuePairs = sortedKeys.map(key => {
    const encodedValue = phpUrlEncode(params[key]);
    return `${key}=${encodedValue}`;
  });
  let str = keyValuePairs.join('&');

  // 3. 追加密钥
  str += secretKey;

  // 4. 计算MD5
  return md5(str);
}

/**
 * 使用认证信息生成完整的请求参数（包含签名）
 * @param authInfo 认证信息
 * @param method API方法名
 * @param additionalParams 其他参数
 * @returns 包含签名的完整参数
 */
export function generateSignedParams(
  authInfo: any,
  method: string,
  additionalParams: Record<string | number, any> = {}
): Record<string, string> {
  // 构建基本参数，确保所有值都是字符串
  const params: Record<string, string> = {};
  
  // 添加基本参数
  if (authInfo.access_token) params.access_token = String(authInfo.access_token);
  if (method) params.method = String(method);
  if (authInfo.qid) params.qid = String(authInfo.qid);
  
  // 添加额外参数，确保所有值都是字符串
  if (additionalParams) {
    for (const [key, value] of Object.entries(additionalParams)) {
      if (value !== undefined && value !== null) {
        params[String(key)] = String(value);
      }
    }
  }
  
  // 添加签名到参数中
  return {
    ...params
  };
}
