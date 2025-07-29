import dotenv from 'dotenv';
import { generateSign, generateSignedParams } from './sign.js';
import { getConfig } from './const.js';

// 加载环境变量
dotenv.config();

// 定义鉴权响应接口
export interface AuthResponse {
  errno: number;
  errmsg: string;
  data: {
    token: string;
    access_token: string;
    access_token_expire: number;
    qid: string;
  };
  trace_id: string;
}

// 定义存储鉴权信息的接口
export interface AuthInfo {
  access_token: string;
  qid: string;
  token: string;
  sign?: string;
  request_url?: string;
}

// 定义认证方法参数接口
export interface AuthParams {
  method?: string;
  extraParams?: Record<string|number, string|number>;
  req?: any; // 添加Express请求对象参数
}

// 鉴权信息缓存
let authCache: AuthInfo | null = null;
let authExpireTime: number = 0;

/**
 * 从环境变量读取云盘API密钥信息
 * @returns 云盘API密钥信息
 */
function getKeyInfo(transportAuthInfo?: any): {
  apiKey: string;
  clientId: string;
  clientSecret: string;
} {
  // 首先尝试从HTTP请求获取API_KEY
  let apiKey = '';
  if (transportAuthInfo) {
    // 直接使用传入的 apiKey
    if (transportAuthInfo.apiKey) {
      apiKey = transportAuthInfo.apiKey;
    }
  }
  
  // 如果请求中没有找到，使用环境变量
  if (!apiKey) {
    apiKey = process.env.API_KEY || '';
  }

  const { client_id, client_secret } = getConfig(transportAuthInfo?.ecsEnv);
  
  return {
    apiKey,
    clientId: client_id,
    clientSecret: client_secret
  }
}

/**
 * 调用鉴权接口获取认证信息
 * @param authParams 可选的认证参数
 * @returns 鉴权信息
 */
async function fetchAuthInfo(authParams: AuthParams, transportAuthInfo?: any): Promise<AuthInfo> {
  const keyInfo = getKeyInfo(transportAuthInfo);
  if (!keyInfo.apiKey) {
    throw new Error('未配置YUNPAN_API_KEY环境变量');
  }

  try {
    const { request_url } = getConfig(transportAuthInfo?.ecsEnv);
    // 构建请求URL和参数
    const url = new URL(request_url);
    
    // 基础参数
    let baseParams: Record<string, string> = {};
    
    const extraParams = authParams.extraParams;
    
    if (extraParams && extraParams.toolName === 'file-upload-stdio') {
      baseParams['method'] = extraParams.method as string;
      baseParams['client_id'] = extraParams.clientId as string;
      baseParams['client_secret'] = extraParams.clientSecret as string;
      baseParams['qid'] = extraParams.qid as string;
      baseParams['grant_type'] = extraParams.grantType as string;
    } else {
      baseParams['method'] = 'Oauth.getAccessTokenByApiKey';
      baseParams['client_id'] = keyInfo.clientId;
      baseParams['client_secret'] = keyInfo.clientSecret;
      baseParams['grant_type'] = 'authorization_code';
      baseParams['api_key'] = keyInfo.apiKey;
    }
    
    // 添加所有参数到URL
    Object.entries(baseParams).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`鉴权请求失败，状态码: ${response.status}`);
    }

    const authResponse: AuthResponse = await response.json();
    
    if (authResponse.errno !== 0) {
      throw new Error(`鉴权请求返回错误: ${authResponse.errmsg}`);
    }

    // 从响应中提取需要的信息
    const { access_token, qid, token } = authResponse.data;
    
    return { access_token, qid, token };
  } catch (error) {
    console.error('获取鉴权信息失败:', error);
    throw error;
  }
}

/**
 * 获取鉴权信息，如果缓存有效则使用缓存
 * @param authParams 可选的认证参数，包括方法名和路径等
 * @returns 鉴权信息
 */
export async function getAuthInfo(authParams: AuthParams = {}, transportAuthInfo?: any): Promise<AuthInfo> {
  const now = Date.now();
  
  // 如果缓存可用且未过期，直接返回缓存
  // if (authCache && now < authExpireTime) {
  //   delete authCache.sign;
  //   authCache.sign = generateSign(generateSignedParams(authCache, authParams.method || '', authParams.extraParams));
  //   return authCache;
  // }
  
  // 获取新的鉴权信息
  const authInfo = await fetchAuthInfo(authParams, transportAuthInfo);
  
  if (authParams.extraParams && authParams.extraParams.toolName === 'file-upload-stdio') {
    authInfo.qid = authParams.extraParams.qid as string;
    return authInfo;
  }

  const signedAuthInfo = {
    access_token: authInfo.access_token,
    qid: authInfo.qid,
  }

  // 确保方法名存在，默认为空字符串
  const method = authParams.method || '';
  
  // 生成签名
  const sign = generateSign(generateSignedParams(signedAuthInfo, method, authParams.extraParams));
  
  authInfo.sign = sign;
  
  // 更新缓存，使用API返回的过期时间
  authCache = authInfo;
  authExpireTime = now + 60 * 60 * 1000; // 默认1小时过期
  
  return authInfo;
}
