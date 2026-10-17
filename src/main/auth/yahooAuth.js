/**
 * Yahoo OAuth2 认证与邮箱账户绑定逻辑（在 Electron 应用内完成授权）。
 * Yahoo OAuth2 authentication and email account linking logic (authorization flow stays inside the Electron app).
 */
const https = require('https');
const url = require('url');
const querystring = require('querystring');
const { BrowserWindow } = require('electron');
const ElectronStore = require('electron-store');
const crypto = require('crypto');
const { getStoreEncryptionKey } = require('../storeEncryption');

// 兼容 ESM 默认导出的 electron-store。
// Compatible with ESM default export for electron-store.
const Store = typeof ElectronStore === 'function' ? ElectronStore : ElectronStore.default;

const store = new Store({
  name: 'auth',
  encryptionKey: getStoreEncryptionKey(),
  clearInvalidConfig: true,
});

// 根据环境变量创建 Yahoo OAuth2 配置。
// Build Yahoo OAuth2 config from environment variables.
// 注意：YAHOO_CLIENT_ID 必须填 Yahoo 控制台里的 Consumer Key（长字符串），不是 App ID。
// Note: YAHOO_CLIENT_ID must be the Consumer Key from Yahoo console (long string), not the App ID.
function createYahooConfig() {
  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  const redirectUri = (process.env.YAHOO_REDIRECT_URI || 'http://localhost:3000/auth/yahoo-callback').trim();

  if (!clientId || !clientSecret) {
    throw new Error('YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET must be set in environment variables');
  }

  return { clientId, clientSecret, redirectUri };
}

// 从本地安全存储中读取已保存的 Yahoo OAuth token。
// Read stored Yahoo OAuth tokens from local secure storage.
function getStoredYahooTokens() {
  return store.get('yahooTokens') || null;
}

// 将 Yahoo OAuth token 以及邮箱地址安全保存到本地。
// Securely save Yahoo OAuth tokens and email locally.
function saveYahooTokens(tokens, email) {
  if (!tokens) return;
  store.set('yahooTokens', tokens);
  if (email) {
    store.set('yahooAccount', {
      email,
      linkedAt: new Date().toISOString(),
    });
  }
}

// 读取当前已绑定的 Yahoo 邮箱账户信息（如果存在）。
// Get the currently linked Yahoo email account information (if any).
function getLinkedYahooAccount() {
  return store.get('yahooAccount') || null;
}

// 使用已保存的 token 构造一个简单的“认证上下文”对象，仅包含访问令牌。
// Build a simple "auth context" object using stored tokens, currently only access token.
function getAuthenticatedYahooContext() {
  const tokens = getStoredYahooTokens();
  if (!tokens) {
    return null;
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    raw: tokens,
  };
}

// 使用授权码向 Yahoo 交换 access token（支持 PKCE）。
// Exchange authorization code for Yahoo access token (supports PKCE).
function exchangeCodeForTokens(code, codeVerifier) {
  const { clientId, clientSecret, redirectUri } = createYahooConfig();

  // Public client + PKCE: do not send client_secret, only client_id + code_verifier.
  // 公开客户端 + PKCE：不再发送 client_secret，只发 client_id + code_verifier。
  const isPkce = Boolean(codeVerifier);
  const body = isPkce
    ? {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }
    : {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      };

  const postData = querystring.stringify(body);

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData),
  };

  // 非 PKCE（传统 confidential 客户端）才带 Basic Authorization 头。
  if (!isPkce) {
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${authHeader}`;
  }

  const options = {
    method: 'POST',
    hostname: 'api.login.yahoo.com',
    path: '/oauth2/get_token',
    headers,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString('utf8');
      });
      res.on('end', () => {
        try {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error(`Yahoo token endpoint returned status ${res.statusCode}: ${data}`)
            );
          }
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

// 使用 access token 从 Yahoo OpenID Connect UserInfo 端点获取邮箱地址。
// Fetch email address from Yahoo OpenID Connect UserInfo endpoint using access token.
function fetchYahooUserInfo(accessToken) {
  const options = {
    method: 'GET',
    hostname: 'api.login.yahoo.com',
    path: '/openid/v1/userinfo',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString('utf8');
      });
      res.on('end', () => {
        try {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error(`Yahoo userinfo endpoint returned status ${res.statusCode}: ${data}`)
            );
          }
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

// 启动完整的 Yahoo OAuth2 授权流程，在应用内弹出 BrowserWindow 完成登录授权。
// 按照官方文档 https://developer.yahoo.com/sign-in-with-yahoo/#step-two 组装参数（包括 state / nonce / PKCE）。
// Start the full Yahoo OAuth2 authorization flow using an in-app BrowserWindow for login/consent.
// Build params following Yahoo docs (including state / nonce / PKCE) for better security.
async function startYahooOAuthFlow() {
  const { clientId, redirectUri } = createYahooConfig();

  const useOob = redirectUri.toLowerCase() === 'oob';
  const authRedirectUri = useOob ? 'oob' : redirectUri;

  // CSRF / replay protection: generate state and nonce per Yahoo guidance.
  // CSRF 防护及重放攻击防护：按官方建议生成 state / nonce。
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');

  // PKCE: code_verifier and S256 code_challenge.
  // PKCE：生成 code_verifier 与 code_challenge (S256)。
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // OAuth UI language (could read from app or OS locale). / 授权页语言，可按系统或应用设置改为 zh-CN 等。
  const language = 'en-us';

  const authUrl =
    'https://api.login.yahoo.com/oauth2/request_auth?' +
    querystring.stringify({
      client_id: clientId,
      redirect_uri: authRedirectUri,
      response_type: 'code',
      scope: 'openid email',
      state,
      nonce,
      language,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

  return new Promise((resolve, reject) => {
    let loginWin = new BrowserWindow({
      width: 600,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    let finished = false;

    const cleanup = () => {
      if (loginWin) {
        loginWin.close();
        loginWin = null;
      }
    };

    const handleUrl = async (targetUrl) => {
      if (finished) return;
      try {
        const parsed = new url.URL(targetUrl);

        const redirectBase = authRedirectUri === 'oob' ? 'oob' : redirectUri.replace(/\/+$/, '');
        const currentBase = (parsed.origin + parsed.pathname).replace(/\/+$/, '');
        if (authRedirectUri !== 'oob' && currentBase !== redirectBase) return;

        // Validate state to mitigate CSRF (recommended by Yahoo docs).
        // 官方文档推荐校验 state 以避免 CSRF。
        const returnedState = parsed.searchParams.get('state');
        if (returnedState && returnedState !== state) {
          return;
        }

        const code = parsed.searchParams.get('code');
        if (!code) return;

        finished = true;

        const tokens = await exchangeCodeForTokens(code, codeVerifier);

        let email = null;
        try {
          const userInfo = await fetchYahooUserInfo(tokens.access_token);
          email = userInfo && (userInfo.email || userInfo.preferred_username || null);
        } catch (infoErr) {
          email = null;
        }

        saveYahooTokens(tokens, email);
        cleanup();
        resolve(tokens);
      } catch (err) {
        finished = true;
        cleanup();
        reject(err);
      }
    };

    const tryExtractCodeFromPage = () => {
      if (finished || !useOob) return;
      loginWin.webContents.executeJavaScript(
        `(function(){ var u = window.location.href; var m = u.match(/[?&]code=([^&]+)/); if(m) return m[1]; var pre = document.querySelector('pre'); return pre ? pre.textContent.trim() : null; })();`
      ).then((code) => {
        if (!code || typeof code !== 'string') return;
        code = code.trim();
        if (code.length < 10) return;
        finished = true;
        exchangeCodeForTokens(code, codeVerifier).then((tokens) => {
          let email = null;
          return fetchYahooUserInfo(tokens.access_token).then((userInfo) => {
            email = userInfo && (userInfo.email || userInfo.preferred_username || null);
            saveYahooTokens(tokens, email);
            cleanup();
            resolve(tokens);
          }).catch(() => {
            saveYahooTokens(tokens, null);
            cleanup();
            resolve(tokens);
          });
        }).catch((err) => {
          finished = true;
          cleanup();
          reject(err);
        });
      }).catch(() => {});
    };

    loginWin.webContents.on('will-redirect', (event, targetUrl) => {
      handleUrl(targetUrl);
    });

    loginWin.webContents.on('did-navigate', (event, targetUrl) => {
      handleUrl(targetUrl);
    });

    if (useOob) {
      loginWin.webContents.on('did-finish-load', () => {
        tryExtractCodeFromPage();
      });
    }

    loginWin.on('closed', () => {
      if (!finished) {
        finished = true;
        reject(new Error('Yahoo OAuth window closed by user before completion'));
      }
    });

    loginWin.loadURL(authUrl).catch((err) => {
      finished = true;
      cleanup();
      reject(err);
    });
  });
}

/**
 * Clear Yahoo tokens and linked account info from local secure storage.
 * 清除本地安全存储中的 Yahoo token 和绑定账号信息。
 *
 * Yahoo does not expose a stable public revoke endpoint for OAuth2/OIDC access
 * tokens, so this logout just removes local state. Revocation can be performed
 * by the user from the Yahoo account page.
 *
 * @returns {Promise<{ clearedEmail: string|null }>}
 */
async function logoutYahoo() {
  const account = getLinkedYahooAccount();
  const clearedEmail = account?.email || null;
  try {
    store.delete('yahooTokens');
    store.delete('yahooAccount');
  } catch (err) {
    console.warn('[yahooAuth] clear store failed:', err.message);
  }
  return { clearedEmail };
}

module.exports = {
  startYahooOAuthFlow,
  getStoredYahooTokens,
  getLinkedYahooAccount,
  getAuthenticatedYahooContext,
  logoutYahoo,
};

