/**
 * Google OAuth2 authentication and Gmail account linking (multi-account).
 * Google OAuth2 认证与 Gmail 多账户绑定。
 */
const { google } = require('googleapis');
const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');
const OpenModule = require('open');

const IS_ELECTRON = Boolean(process.versions && process.versions.electron);
const USE_EXTERNAL_BROWSER =
  process.env.GOOGLE_OAUTH_EXTERNAL_BROWSER === '1' || process.env.GOOGLE_OAUTH_EXTERNAL_BROWSER === 'true';
const OAUTH_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const ElectronStore = require('electron-store');
const { getStoreEncryptionKey } = require('../storeEncryption');

const open = typeof OpenModule === 'function' ? OpenModule : OpenModule.default;
const Store = typeof ElectronStore === 'function' ? ElectronStore : ElectronStore.default;

const store = new Store({
  name: 'auth',
  encryptionKey: getStoreEncryptionKey(),
  clearInvalidConfig: true,
});

const GOOGLE_ACCOUNTS_KEY = 'googleAccounts';
const ACTIVE_GOOGLE_EMAIL_KEY = 'activeGoogleEmail';
const LEGACY_GOOGLE_TOKENS = 'googleTokens';
const LEGACY_GMAIL_ACCOUNT = 'gmailAccount';

function normalizeEmailKey(email) {
  if (!email) return null;
  const t = String(email).trim().toLowerCase();
  return t || null;
}

function migrateLegacyGoogleStore() {
  try {
    const legacyTokens = store.get(LEGACY_GOOGLE_TOKENS);
    const legacyAcc = store.get(LEGACY_GMAIL_ACCOUNT);
    let map = store.get(GOOGLE_ACCOUNTS_KEY);
    if (!map || typeof map !== 'object') map = {};
    if (legacyTokens && legacyAcc?.email) {
      const k = normalizeEmailKey(legacyAcc.email);
      if (k && !map[k]) {
        map[k] = {
          tokens: legacyTokens,
          email: String(legacyAcc.email).trim(),
          name: legacyAcc.name ?? null,
          picture: legacyAcc.picture ?? null,
          linkedAt: legacyAcc.linkedAt || new Date().toISOString(),
        };
        store.set(GOOGLE_ACCOUNTS_KEY, map);
      }
      store.delete(LEGACY_GOOGLE_TOKENS);
      store.delete(LEGACY_GMAIL_ACCOUNT);
    }
  } catch (err) {
    console.warn('[googleAuth] migrate legacy failed:', err.message);
  }
}

function getGoogleAccountsMap() {
  migrateLegacyGoogleStore();
  const map = store.get(GOOGLE_ACCOUNTS_KEY);
  return map && typeof map === 'object' ? { ...map } : {};
}

function listGoogleAccounts() {
  return Object.values(getGoogleAccountsMap()).map((row) => ({
    email: row.email,
    name: row.name ?? null,
    picture: row.picture ?? null,
    linkedAt: row.linkedAt || null,
  }));
}

function listGoogleAccountEmails() {
  return Object.keys(getGoogleAccountsMap());
}

function resolveDefaultGoogleEmail() {
  const map = getGoogleAccountsMap();
  const keys = Object.keys(map);
  if (keys.length === 0) return null;
  const active = store.get(ACTIVE_GOOGLE_EMAIL_KEY);
  const activeKey = normalizeEmailKey(active);
  if (activeKey && map[activeKey]) return map[activeKey].email;
  return map[keys[0]].email;
}

function saveGoogleAccount(email, tokens, profile = {}) {
  const k = normalizeEmailKey(email);
  if (!k || !tokens) return;
  const map = getGoogleAccountsMap();
  const prev = map[k] || {};
  map[k] = {
    tokens,
    email: String(email).trim(),
    name: profile.name != null ? profile.name : (prev.name ?? null),
    picture: profile.picture != null ? profile.picture : (prev.picture ?? null),
    linkedAt: prev.linkedAt || new Date().toISOString(),
  };
  store.set(GOOGLE_ACCOUNTS_KEY, map);
  store.set(ACTIVE_GOOGLE_EMAIL_KEY, map[k].email);
}

function removeGoogleAccountRow(email) {
  const k = normalizeEmailKey(email);
  if (!k) return false;
  const map = getGoogleAccountsMap();
  if (!map[k]) return false;
  delete map[k];
  store.set(GOOGLE_ACCOUNTS_KEY, map);
  const activeKey = normalizeEmailKey(store.get(ACTIVE_GOOGLE_EMAIL_KEY));
  if (activeKey === k) {
    const nextKeys = Object.keys(map);
    if (nextKeys.length && map[nextKeys[0]]?.email) {
      store.set(ACTIVE_GOOGLE_EMAIL_KEY, map[nextKeys[0]].email);
    } else {
      store.delete(ACTIVE_GOOGLE_EMAIL_KEY);
    }
  }
  return true;
}

function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback';

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Tokens for a specific linked Gmail address (or null if unknown / not linked).
 */
function getStoredTokensForEmail(email) {
  const map = getGoogleAccountsMap();
  const k = normalizeEmailKey(email);
  if (!k) return null;
  return map[k]?.tokens || null;
}

/**
 * @param {string} [email] - When omitted, uses the active / sole stored account (legacy behaviour).
 */
function getStoredTokens(email) {
  const resolved = email ? String(email).trim() : resolveDefaultGoogleEmail();
  if (!resolved) return null;
  return getStoredTokensForEmail(resolved);
}

/**
 * @param {string} [email]
 */
function getAuthenticatedClientForEmail(email) {
  const resolved = email && String(email).trim() ? String(email).trim() : resolveDefaultGoogleEmail();
  if (!resolved) return null;
  const tokens = getStoredTokensForEmail(resolved);
  if (!tokens) return null;
  const oAuth2Client = createOAuthClient();
  oAuth2Client.setCredentials(tokens);
  return oAuth2Client;
}

function getAuthenticatedClient() {
  return getAuthenticatedClientForEmail(resolveDefaultGoogleEmail());
}

/**
 * @param {string} [email]
 */
function getLinkedGmailAccount(email) {
  const map = getGoogleAccountsMap();
  const resolved = email && String(email).trim() ? String(email).trim() : resolveDefaultGoogleEmail();
  if (!resolved) return null;
  const k = normalizeEmailKey(resolved);
  const row = map[k];
  if (!row) return null;
  return {
    email: row.email,
    name: row.name ?? null,
    picture: row.picture ?? null,
    linkedAt: row.linkedAt || null,
  };
}

/**
 * @param {string} [email]
 */
async function ensureGmailAccountInfo(email) {
  const resolved = email && String(email).trim() ? String(email).trim() : resolveDefaultGoogleEmail();
  if (!resolved) return null;

  const tokens = getStoredTokensForEmail(resolved);
  if (!tokens) return null;

  const existing = getLinkedGmailAccount(resolved);
  if (existing?.email && existing.name) {
    return existing;
  }

  const authClient = getAuthenticatedClientForEmail(resolved);
  if (!authClient) {
    return existing || null;
  }

  let em = existing?.email || null;
  let name = existing?.name || null;
  let picture = existing?.picture || null;

  try {
    const oauth2 = google.oauth2({
      version: 'v2',
      auth: authClient,
    });
    const { data } = await oauth2.userinfo.get();
    if (data.email) em = data.email;
    if (data.name) name = data.name;
    if (data.picture) picture = data.picture;
  } catch (err) {
    console.warn('[googleAuth] userinfo.get failed:', err.message);
  }

  if (!em) {
    try {
      const gmail = google.gmail({ version: 'v1', auth: authClient });
      const { data } = await gmail.users.getProfile({ userId: 'me' });
      if (data.emailAddress) em = data.emailAddress;
    } catch (err) {
      console.warn('[googleAuth] gmail.users.getProfile failed:', err.message);
    }
  }

  if (em) {
    saveGoogleAccount(em, tokens, { name, picture });
    return getLinkedGmailAccount(em);
  }

  return existing || null;
}

/**
 * Run the browser OAuth loop and local callback server; stores tokens + profile per account.
 */
async function startGoogleOAuthFlow() {
  const oAuth2Client = createOAuthClient();

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      /** Required for Gmail API users.drafts.* (create/update/delete/list); web Gmail shows the same drafts. */
      'https://www.googleapis.com/auth/gmail.compose',
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  console.log('[googleAuth] Generated OAuth2 authorization URL:', authUrl);

  return new Promise((resolve, reject) => {
    let settled = false;
    let oauthWin = null;
    let server = null;
    let timeoutId = null;

    const closeServer = () => {
      if (server && server.listening) {
        server.close(() => { });
      }
    };

    const safeReject = (err) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (oauthWin && !oauthWin.isDestroyed()) {
        oauthWin.removeAllListeners('closed');
        oauthWin.close();
      }
      closeServer();
      reject(err);
    };

    const safeResolve = (tokens) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (oauthWin && !oauthWin.isDestroyed()) {
        oauthWin.removeAllListeners('closed');
        oauthWin.close();
      }
      closeServer();
      resolve(tokens);
    };

    timeoutId = setTimeout(() => {
      safeReject(
        new Error(
          'Google OAuth timed out waiting for authorization. Close the login window or complete sign-in.'
        )
      );
    }, OAUTH_WAIT_TIMEOUT_MS);

    server = http.createServer(async (req, res) => {
      try {
        const reqUrl = url.parse(req.url, true);
        if (reqUrl.pathname !== '/auth/callback') {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = reqUrl.query.code;
        if (!code) {
          res.writeHead(400);
          res.end('Missing code parameter');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Authentication successful. You can close this window.');

        console.log('[googleAuth] Exchanging authorization code for tokens...');
        const { tokens } = await oAuth2Client.getToken({
          code,
          codeVerifier,
        });
        console.log('[googleAuth] Received OAuth2 tokens response:', JSON.stringify(tokens, null, 2));
        oAuth2Client.setCredentials(tokens);

        let emailAddr = null;
        let name = null;
        let picture = null;
        try {
          const oauth2 = google.oauth2({
            version: 'v2',
            auth: oAuth2Client,
          });
          const { data } = await oauth2.userinfo.get();
          emailAddr = data.email || null;
          name = data.name || null;
          picture = data.picture || null;
        } catch (infoErr) {
          console.warn('[googleAuth] userinfo after token:', infoErr.message);
        }

        if (!emailAddr) {
          try {
            const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
            const { data } = await gmail.users.getProfile({ userId: 'me' });
            if (data.emailAddress) emailAddr = data.emailAddress;
          } catch (gErr) {
            console.warn('[googleAuth] getProfile after token:', gErr.message);
          }
        }

        if (!emailAddr) {
          safeReject(new Error('Could not determine Google account email after sign-in.'));
          return;
        }

        saveGoogleAccount(emailAddr, tokens, { name, picture });

        safeResolve(tokens);
      } catch (err) {
        safeReject(err);
      }
    });

    server.on('error', (err) => {
      safeReject(err);
    });

    server.listen(3000, () => {
      if (IS_ELECTRON && !USE_EXTERNAL_BROWSER) {
        const { BrowserWindow } = require('electron');
        oauthWin = new BrowserWindow({
          width: 520,
          height: 720,
          show: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });
        oauthWin.on('closed', () => {
          oauthWin = null;
          if (!settled) {
            safeReject(
              new Error(
                'Google login was cancelled (window closed before completing sign-in).'
              )
            );
          }
        });
        oauthWin.loadURL(authUrl);
      } else {
        open(authUrl, { wait: false });
      }
    });
  });
}

async function revokeGoogleTokens(tokens) {
  const accessOrRefresh = tokens?.access_token || tokens?.refresh_token;
  if (!accessOrRefresh) return false;

  let revoked = false;
  try {
    await new Promise((resolve) => {
      const req = https.request(
        {
          method: 'POST',
          hostname: 'oauth2.googleapis.com',
          path: `/revoke?token=${encodeURIComponent(accessOrRefresh)}`,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': 0,
          },
        },
        (res) => {
          revoked = res.statusCode && res.statusCode < 500;
          res.resume();
          res.on('end', resolve);
        }
      );
      req.on('error', () => {
        revoked = false;
        resolve();
      });
      req.end();
    });
  } catch (err) {
    console.warn('[googleAuth] revoke failed:', err.message);
  }
  return revoked;
}

/**
 * @param {string} [accountEmail] - If set, only remove that Google account; otherwise remove all.
 * @returns {Promise<{ revoked: boolean, clearedEmail: string|null, clearedEmails?: string[] }>}
 */
async function logoutGoogle(accountEmail) {
  const map = getGoogleAccountsMap();
  const keys = Object.keys(map);

  if (accountEmail && String(accountEmail).trim()) {
    const k = normalizeEmailKey(accountEmail);
    const row = k ? map[k] : null;
    const clearedEmail = row?.email || null;
    let revoked = false;
    if (row?.tokens) {
      revoked = await revokeGoogleTokens(row.tokens);
    }
    removeGoogleAccountRow(accountEmail);
    return { revoked, clearedEmail };
  }

  let revokedAny = false;
  const clearedEmails = [];
  for (const k of keys) {
    const row = map[k];
    if (row?.tokens) {
      const r = await revokeGoogleTokens(row.tokens);
      if (r) revokedAny = true;
    }
    if (row?.email) clearedEmails.push(row.email);
  }

  try {
    store.delete(GOOGLE_ACCOUNTS_KEY);
    store.delete(ACTIVE_GOOGLE_EMAIL_KEY);
    store.delete(LEGACY_GOOGLE_TOKENS);
    store.delete(LEGACY_GMAIL_ACCOUNT);
  } catch (err) {
    console.warn('[googleAuth] clear store failed:', err.message);
  }

  return { revoked: revokedAny, clearedEmail: clearedEmails[0] || null, clearedEmails };
}

module.exports = {
  startGoogleOAuthFlow,
  getStoredTokens,
  getStoredTokensForEmail,
  getLinkedGmailAccount,
  listGoogleAccounts,
  listGoogleAccountEmails,
  resolveDefaultGoogleEmail,
  getAuthenticatedClient,
  getAuthenticatedClientForEmail,
  ensureGmailAccountInfo,
  logoutGoogle,
  saveGoogleAccount,
};
