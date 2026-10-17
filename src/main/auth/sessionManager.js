/**
 * 会话管理：确保用户通过 Google / Yahoo OAuth2 登录并取得可用的会话。
 * Session management: ensure the user is logged in via Google / Yahoo OAuth2 with a usable session.
 */
const {
  getStoredTokensForEmail,
  listGoogleAccountEmails,
  resolveDefaultGoogleEmail,
  getAuthenticatedClientForEmail,
  startGoogleOAuthFlow,
  ensureGmailAccountInfo,
} = require('./googleAuth');

const {
  getStoredYahooTokens,
  getAuthenticatedYahooContext,
  getLinkedYahooAccount,
  startYahooOAuthFlow,
} = require('./yahooAuth');

/**
 * Ensure Google OAuth session for a specific linked Gmail address.
 * 确保指定 Gmail 地址在本地已有 OAuth 会话；未指定时沿用默认账号（兼容旧调用）。
 *
 * @param {string} [googleAccountEmail] - Gmail address whose tokens must exist (no OAuth unless legacy single-account flow).
 */
async function ensureGoogleSession(googleAccountEmail) {
  const target = googleAccountEmail && String(googleAccountEmail).trim()
    ? String(googleAccountEmail).trim()
    : null;

  if (target) {
    const existing = getStoredTokensForEmail(target);
    if (existing) {
      const client = getAuthenticatedClientForEmail(target);
      const account = await ensureGmailAccountInfo(target);
      return { hasToken: true, client, email: account ? account.email : target };
    }
    throw new Error(
      `This Google account (${target}) is not linked on this device. Use “Add account” and sign in with that address.`
    );
  }

  const emails = listGoogleAccountEmails();
  if (emails.length === 1) {
    const only = resolveDefaultGoogleEmail();
    const existing = getStoredTokensForEmail(only);
    if (existing) {
      const client = getAuthenticatedClientForEmail(only);
      const account = await ensureGmailAccountInfo(only);
      return { hasToken: true, client, email: account ? account.email : only };
    }
  }

  if (emails.length > 1) {
    const def = resolveDefaultGoogleEmail();
    if (def) {
      const existing = getStoredTokensForEmail(def);
      if (existing) {
        const client = getAuthenticatedClientForEmail(def);
        const account = await ensureGmailAccountInfo(def);
        return { hasToken: true, client, email: account ? account.email : def };
      }
    }
    throw new Error(
      'Multiple Google accounts are linked; the app needs an explicit account email for this action.'
    );
  }

  const anyEmail = resolveDefaultGoogleEmail();
  const existing = anyEmail ? getStoredTokensForEmail(anyEmail) : null;
  if (existing) {
    const client = getAuthenticatedClientForEmail(anyEmail);
    const account = await ensureGmailAccountInfo(anyEmail);
    return { hasToken: true, client, email: account ? account.email : anyEmail };
  }

  const tokens = await startGoogleOAuthFlow();
  const after = resolveDefaultGoogleEmail();
  const client = getAuthenticatedClientForEmail(after);
  const account = await ensureGmailAccountInfo(after);
  return { hasToken: !!tokens, client, email: account ? account.email : after };
}

async function ensureYahooSession() {
  const existing = getStoredYahooTokens();
  if (existing) {
    const context = getAuthenticatedYahooContext();
    const account = getLinkedYahooAccount();
    return { hasToken: true, context, email: account ? account.email : null };
  }

  const tokens = await startYahooOAuthFlow();
  const context = getAuthenticatedYahooContext();
  const account = getLinkedYahooAccount();
  return { hasToken: !!tokens, context, email: account ? account.email : null };
}

module.exports = {
  ensureGoogleSession,
  ensureYahooSession,
};
