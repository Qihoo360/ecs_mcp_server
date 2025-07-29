export const YUNPAN_API_KEY = "e7b24b112a44fdd9ee93bdf998c6ca0e";

const urlMap = {
  test: 'https://qaopen.eyun.360.cn/intf.php',
  hgtest: 'https://hg-openapi.eyun.360.cn/intf.php',
  prod: 'https://openapi.eyun.360.cn/intf.php'
};

export function getConfig(envParam?: keyof typeof urlMap) {
  const env = envParam || process.env.ECS_ENV as keyof typeof urlMap || 'prod';
  const request_url = urlMap[env] || urlMap['prod'];
  
  const client_id = env === 'test'
    ? 'e4757e933b6486c08ed206ecb6d5d9e684fcb4e2'
    : 'e4757e933b6486c08ed206ecb6d5d9e684fcb4e2';
  
  const client_secret = env === 'test'
    ? 'b11b8fff1c75a5d227c8cc93aaeb0bb70c8eee47'
    : '885fd3231f1c1e37c9f462261a09b8c38cde0c2b';

  return {
    request_url,
    client_id,
    client_secret
  };
}

export const TOOL_LIMIT_NOTE = "注意：如问题中未明确指定，请勿再自行调用其他无关工具。";
