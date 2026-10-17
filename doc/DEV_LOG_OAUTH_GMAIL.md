# PG04 开发日志（OAuth 登录 & Gmail 绑定）  
# PG04 Dev Log – OAuth Login & Gmail Linking

> 本文档用于记录 `PG04` 分支（OAuth 登录 / 自动链接 Gmail）的主要实现思路和使用方法，方便团队其他成员继续开发与调试。  
> This document records the main design and usage of the `PG04` branch (OAuth login / automatic Gmail linking) for other teammates.

---

## 1. 当前功能概览  
## 1. Current Feature Overview

- 通过 **Google OAuth2** 登录桌面应用，无需应用专用密码。  
  Login to the desktop app via **Google OAuth2**, no app‑password needed.
- 成功登录后，自动读取并保存当前 Google 账户的 **Gmail 邮箱地址**。  
  After login, automatically read and store the **Gmail address** of the Google account.
- 使用 `electron-store`（加密）在本机安全保存 OAuth token 与绑定的 Gmail 账号信息。  
  Use encrypted `electron-store` to securely store OAuth tokens and linked Gmail account locally.
- 渲染进程有一个简单的「Sign in with Google」界面，用于测试后端是否工作正常。  
  Renderer has a simple “Sign in with Google” UI to verify the backend.

---

## 2. 主要文件位置  
## 2. Key File Locations

- `src/main/auth/googleAuth.js`  
  - Google OAuth2 流程 & Gmail 账号绑定逻辑。  
    Google OAuth2 flow & Gmail account linking logic.
- `src/main/auth/sessionManager.js`  
  - 会话管理：确保有可用 OAuth 会话，并返回绑定的 Gmail 邮箱。  
    Session management: ensure a valid OAuth session and return linked Gmail email.
- `src/main/main.js`  
  - Electron 主进程入口，注册 `auth:google-login` IPC 供前端调用。  
    Electron main entry, registers `auth:google-login` IPC for frontend.
- `src/main/preload.js`  
  - 将 `googleLogin()` 暴露到 `window.electronAPI`。  
    Exposes `googleLogin()` to `window.electronAPI`.
- `src/renderer/index.html`  
  - 简单测试界面（按钮 + 状态文案），用来手工验证 OAuth 流程。  
    Simple test UI (button + status text) to manually verify the OAuth flow.
- `test/googleAuthTest.js`  
  - Node 端测试脚本（仅调试用），会受 `electron-store` / `electron` 限制。  
    Node test script (for debugging only), constrained by `electron-store` / `electron`.

---

## 3. 环境变量配置（.env）  
## 3. Environment Variables (.env)

文件：`PG04/.env`  
File: `PG04/.env`

```env
###############################
# Google OAuth2
###############################
GOOGLE_CLIENT_ID=...your_client_id...
GOOGLE_CLIENT_SECRET=...your_client_secret...
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

###############################
# Database
###############################
DB_ENCRYPTION_KEY=a_random_32_char_secret_key

###############################
# App
###############################
NODE_ENV=development
```

- 请使用团队共享的 **测试 Google 账号**，不要使用个人账号。  
  Please use the team’s **test Google account**, not personal accounts.
- `GOOGLE_REDIRECT_URI` 需要与 Google Cloud Console 中的 OAuth2 客户端配置一致。  
  `GOOGLE_REDIRECT_URI` must match the OAuth2 client redirect URI in Google Cloud Console.

---

## 4. 后端流程说明  
## 4. Backend Flow Description

### 4.1 `googleAuth.js`

1. **创建 OAuth2 客户端**  
   **Create OAuth2 client**
   - 从 `process.env.GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` 读取配置。  
     Read config from `process.env.GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`.

2. **生成授权 URL 并在浏览器中打开**  
   **Generate auth URL and open in browser**
   - 使用 `google.auth.OAuth2().generateAuthUrl()`，scope 覆盖 Gmail 读写。  
     Use `google.auth.OAuth2().generateAuthUrl()` with Gmail read/write scopes.

3. **本地起一个 HTTP server 监听回调**  
   **Start a local HTTP server to listen for callback**
   - 监听 `http://localhost:3000/auth/callback`，从 query string 中读取 `code`。  
     Listen on `http://localhost:3000/auth/callback` and read `code` from query string.

4. **交换 code 获取 tokens**  
   **Exchange code for tokens**
   - 调用 `oAuth2Client.getToken(code)` 获取 `access_token` / `refresh_token` 等。  
     Call `oAuth2Client.getToken(code)` to obtain `access_token` / `refresh_token`, etc.

5. **获取当前用户邮箱并保存**  
   **Fetch current user email and save**
   - 使用 `google.oauth2('v2').userinfo.get()` 获取 `email`。  
     Use `google.oauth2('v2').userinfo.get()` to get `email`.
   - `electron-store` 中保存：
     - `googleTokens`：完整的 token 信息。  
       `googleTokens`: full token info.
     - `gmailAccount`：`{ email, linkedAt }`，用于“自动链接到 Gmail”。  
       `gmailAccount`: `{ email, linkedAt }`, used for “auto‑linking Gmail”.

### 4.2 `sessionManager.js`

- `ensureGoogleSession()`：
  - 如果本地已有 token，则直接返回 `{ hasToken: true, client, email }`。  
    If tokens exist, return `{ hasToken: true, client, email }` directly.
  - 否则调用 `startGoogleOAuthFlow()` 触发浏览器授权，完成后再返回上述结构。  
    Otherwise call `startGoogleOAuthFlow()` to trigger browser auth, then return that structure.

---

## 5. 前端调用方式  
## 5. Frontend Usage

### 5.1 预加载脚本（`preload.js`）  
### 5.1 Preload Script (`preload.js`)

```js
// 暴露 googleLogin 给渲染进程。
// Expose googleLogin to the renderer process.
contextBridge.exposeInMainWorld('electronAPI', {
  googleLogin: () => ipcRenderer.invoke('auth:google-login'),
});
```

### 5.2 渲染页面（当前为 `src/renderer/index.html`）  
### 5.2 Renderer Page (currently `src/renderer/index.html`)

简化后的调用逻辑：  
Simplified call logic:

```js
const result = await window.electronAPI.googleLogin();
// result: { status: 'ok', hasToken: boolean, email: string | null }
```

成功后可以：

- 更新全局 Auth 状态（如 `AuthContext`）。  
  Update global auth state (e.g., `AuthContext`).
- 记录当前 Gmail 地址，作为默认收件箱账号。  
  Record the Gmail address as the default inbox account.
- 跳转到 Inbox 页面，开始加载该邮箱的邮件列表。  
  Navigate to the Inbox page and load emails for that account.

---

## 6. 后续开发建议  
## 6. Next Steps / Suggestions

1. **整合到 React 登录页**  
   Integrate into React login page  
   - 按 README 结构创建 `src/renderer/pages/Login/Login.jsx` 和 `Login.module.css`，将当前 `index.html` 的按钮逻辑迁移过去。  
     Create `src/renderer/pages/Login/Login.jsx` and `Login.module.css` and move current button logic there.

2. **将 Gmail 账号写入邮箱账户管理模块**  
   Propagate Gmail account into mail account manager  
   - 和后续的 `emailService` / account manager 协调，使用从 OAuth 得到的 email 作为默认账号。  
     Coordinate with `emailService` / account manager to use the OAuth email as default account.

3. **错误处理与提示优化**  
   Improve error handling and UX  
   - 对网络错误、权限拒绝、配置错误（Client ID 未设置等）给出清晰的前端提示。  
     Provide clear frontend messages for network errors, access denial, or misconfiguration (e.g. missing client id).

---

如需修改或扩展此模块，请在此文档追加你的变更记录与注意事项。  
If you modify or extend this module, please append your change notes and caveats here for the team.

