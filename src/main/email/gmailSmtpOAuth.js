/**
 * Send via smtp.gmail.com using stored Google OAuth tokens (XOAUTH2), per account.
 * 使用已保存的 Google OAuth 令牌通过 smtp.gmail.com 发信（按账号 XOAUTH2）。
 */
const {
  getAuthenticatedClientForEmail,
  getStoredTokensForEmail,
  getLinkedGmailAccount,
  ensureGmailAccountInfo,
} = require('../auth/googleAuth');

/**
 * Build nodemailer transport options for Gmail SMTP + OAuth2.
 * @param {string} accountEmail - Linked Google / Gmail address.
 * @returns {Promise<import('nodemailer').TransportOptions>}
 */
async function getGmailSmtpTransportOptions(accountEmail) {
  if (!accountEmail || !String(accountEmail).trim()) {
    throw new Error('getGmailSmtpTransportOptions: accountEmail is required');
  }

  await ensureGmailAccountInfo(accountEmail);

  const tokens = getStoredTokensForEmail(accountEmail);
  const client = getAuthenticatedClientForEmail(accountEmail);
  const account = getLinkedGmailAccount(accountEmail);

  if (!tokens || !client) {
    throw new Error('No Google sign-in found for this account. Please use “Sign in with Google” first.');
  }
  if (!account?.email) {
    throw new Error('Could not resolve Gmail address. Please sign in to Google again.');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment.');
  }

  let accessToken;
  try {
    const res = await client.getAccessToken();
    accessToken = typeof res === 'string' ? res : res?.token;
  } catch (err) {
    throw new Error(`Failed to refresh Google access token: ${err.message}`);
  }

  if (!accessToken && !tokens.refresh_token) {
    throw new Error(
      'No access_token or refresh_token available. Re-authorize Google (prefer offline access).'
    );
  }

  return {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      type: 'OAuth2',
      user: account.email,
      clientId,
      clientSecret,
      refreshToken: tokens.refresh_token || undefined,
      accessToken: accessToken || undefined,
    },
  };
}

module.exports = {
  getGmailSmtpTransportOptions,
};
