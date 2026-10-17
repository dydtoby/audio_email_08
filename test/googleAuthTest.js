// Simple Node script to verify the backend Google OAuth2 flow.
// 简单的 Node 测试脚本，用于验证后端 Google OAuth2 流程是否正常。

// Load configuration from .env (client id, secret, etc.).
// 加载 .env 中的配置（客户端 ID、密钥等）。
require('dotenv').config();

const { ensureGoogleSession } = require('../src/main/auth/sessionManager');

async function main() {
  // Print whether key environment variables are configured.
  // 打印当前关键环境变量是否已配置。
  console.log('== Google OAuth2 backend test ==');
  console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '[set]' : '[NOT SET]');
  console.log('GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI || '(not set)');

  try {
    const { hasToken } = await ensureGoogleSession();
    if (hasToken) {
      console.log('OAuth token obtained and stored successfully.');
      // Successfully obtained and stored token, exit code 0.
      // 成功获取并保存 token，退出码为 0。
      process.exit(0);
    } else {
      console.error('OAuth flow finished but no token was stored.');
      // Flow finished but no token was stored, treat as failure.
      // 流程结束但未保存 token，视为失败。
      process.exit(1);
    }
  } catch (err) {
    console.error(' Error during OAuth test:', err);
    // Exit with code 1 on error so CI or scripts can detect failure.
    // 出现异常时退出码为 1，便于 CI 或脚本检测。
    process.exit(1);
  }
}

// Run the test when this file is executed directly.
// 直接运行该文件时启动测试。
main();
