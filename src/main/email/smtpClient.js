/**
 * SMTP mail sending in the main process (nodemailer).
 * SMTP 邮件发送（主进程），基于 nodemailer：https://nodemailer.com/
 *
 * Example / 典型用法：
 *   const { sendMail, verifySmtp } = require('./email/smtpClient');
 *   await sendMail({
 *     smtp: { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } },
 *     mail: { from: user, to: 'a@b.com', subject: 'Hi', text: '...' },
 *   });
 */

const nodemailer = require('nodemailer');

/**
 * @typedef {import('nodemailer').TransportOptions} SmtpTransportOptions
 */

/**
 * Create a nodemailer transporter (reuse the same instance when sending repeatedly).
 * 根据 SMTP 配置创建 transporter（多次发送时可复用同一实例）。
 *
 * @param {SmtpTransportOptions} smtpOptions - e.g. host/port/secure, auth: { user, pass } or OAuth2
 * @returns {import('nodemailer').Transporter}
 */
function createTransport(smtpOptions) {
  if (!smtpOptions || typeof smtpOptions !== 'object') {
    throw new Error('smtpClient: smtpOptions is required');
  }
  return nodemailer.createTransport(smtpOptions);
}

/**
 * Verify SMTP connectivity and credentials.
 * 校验 SMTP 是否可连接（登录是否成功）。
 *
 * @param {SmtpTransportOptions} smtpOptions
 * @returns {Promise<void>}
 */
async function verifySmtp(smtpOptions) {
  const transporter = createTransport(smtpOptions);
  await transporter.verify();
}

/**
 * Send one message.
 * 发送一封邮件。
 *
 * @param {object} params
 * @param {SmtpTransportOptions} params.smtp
 * @param {import('nodemailer').SendMailOptions} params.mail - from, to, cc, bcc, subject, text, html, attachments, …
 * @returns {Promise<import('nodemailer').SentMessageInfo>}
 */
async function sendMail({ smtp, mail }) {
  if (!mail || typeof mail !== 'object') {
    throw new Error('smtpClient: mail options are required');
  }
  const transporter = createTransport(smtp);
  return transporter.sendMail(mail);
}

/**
 * Send using an existing transporter (avoids extra connection setup).
 * 使用已有 transporter 发送（避免重复建连）。
 *
 * @param {import('nodemailer').Transporter} transporter
 * @param {import('nodemailer').SendMailOptions} mailOptions
 * @returns {Promise<import('nodemailer').SentMessageInfo>}
 */
async function sendMailWithTransport(transporter, mailOptions) {
  if (!transporter || typeof transporter.sendMail !== 'function') {
    throw new Error('smtpClient: valid transporter is required');
  }
  return transporter.sendMail(mailOptions);
}

module.exports = {
  createTransport,
  verifySmtp,
  sendMail,
  sendMailWithTransport,
};
