## Gmail IMAP 邮件列表接口说明

### 一、主进程 IPC 通道

- **通道名称**：`mail:gmail-fetch`  
- **方向**：Renderer → Main（`ipcRenderer.invoke` / `ipcMain.handle`）  
- **文件位置**：`src/main/main.js`

#### 1. 请求参数

```ts
// 通过 preload 暴露的封装（推荐前端使用）
window.electronAPI.fetchGmailMessages(page?: number, pageSize?: number)
```

- **page**（可选）：页码，从 **1** 开始，默认 `1`（即最新一页）  
- **pageSize**（可选）：每页数量，默认 `20`，最大 `100`

#### 2. 响应结构

```ts
type GmailMessage = {
  uid: number
  subject: string
  from: string
  date: string | Date
  flags: string[]
}

type Pagination = {
  page: number        // 当前页码（最终生效的安全页码）
  pageSize: number    // 每页数量
  total: number       // 邮箱内邮件总数（INBOX 中的 exists）
  totalPages: number  // 总页数
  hasNext: boolean    // 是否还有下一页
  hasPrev: boolean    // 是否还有上一页
}

type GmailFetchResult = {
  status: 'ok' | 'error'
  messages?: GmailMessage[]
  pagination?: Pagination
  debug?: {
    mailbox?: string
    exists?: number
    seqRange?: string  // 本次从 IMAP 中获取的序号区间，例如 "81:100"
  }
  error?: string
}
```

实际调用返回示例：

```js
const result = await window.electronAPI.fetchGmailMessages(1, 20)
// result: GmailFetchResult
```

### 二、预加载层（前端入口）

- **文件位置**：`src/main/preload.js`  
- **暴露对象**：`window.electronAPI`

#### 1. 可用方法

```js
// Google 登录
window.electronAPI.googleLogin()

// Yahoo 登录（若需要）
window.electronAPI.yahooLogin()

// 分页获取 Gmail 邮件（推荐使用）
window.electronAPI.fetchGmailMessages(page = 1, pageSize = 20)
```

> 提示：前端只需要关心 `window.electronAPI.fetchGmailMessages`，不需要直接操作 IMAP。

### 三、分页使用示例（前端伪代码）

```js
let currentPage = 1
const pageSize = 20

async function loadPage(page) {
  const { status, messages, pagination, error } =
    await window.electronAPI.fetchGmailMessages(page, pageSize)

  if (status !== 'ok') {
    console.error('加载邮箱失败：', error)
    return
  }

  // 渲染邮件列表
  renderMessages(messages)

  // 更新分页 UI
  updatePaginationUI(pagination)
}

// 初次加载：最新 20 封
loadPage(1)

// 用户点击“跳转页码”
goButton.onclick = () => {
  const page = Number(pageInput.value) || 1
  loadPage(page)
}

// 下一页 / 上一页按钮
nextButton.onclick = () => {
  if (lastPagination?.hasNext) loadPage(lastPagination.page + 1)
}

prevButton.onclick = () => {
  if (lastPagination?.hasPrev) loadPage(lastPagination.page - 1)
}
```


这样前端只需要根据 `messages` 和 `pagination` 渲染即可：  
- 第 1 页 = **最新的 20 封**  
- 下一页依次向更早的邮件扩展。

---

## Gmail IMAP API (English Version)

### 1. Main Process IPC Channel

- **Channel name**: `mail:gmail-fetch`  
- **Direction**: Renderer → Main (`ipcRenderer.invoke` / `ipcMain.handle`)  
- **Location**: `src/main/main.js`

#### 1. Request Parameters

```ts
// Wrapper exposed via preload (recommended entry point for renderer)
window.electronAPI.fetchGmailMessages(page?: number, pageSize?: number)
```

- **page** (optional): page index, starting from **1**. Default: `1` (the latest page).  
- **pageSize** (optional): page size. Default: `20`, max: `100`.

#### 2. Response Shape

```ts
type GmailMessage = {
  uid: number
  subject: string
  from: string
  date: string | Date
  flags: string[]
}

type Pagination = {
  page: number        // current page (normalized/safe value)
  pageSize: number    // items per page
  total: number       // total number of emails in INBOX
  totalPages: number  // total pages
  hasNext: boolean    // whether a next page exists
  hasPrev: boolean    // whether a previous page exists
}

type GmailFetchResult = {
  status: 'ok' | 'error'
  messages?: GmailMessage[]
  pagination?: Pagination
  debug?: {
    mailbox?: string
    exists?: number
    seqRange?: string  // IMAP sequence range used for this request, e.g. "81:100"
  }
  error?: string
}
```

Example usage:

```js
const result = await window.electronAPI.fetchGmailMessages(1, 20)
// result: GmailFetchResult
```

### 2. Preload Layer (Renderer Entry)

- **Location**: `src/main/preload.js`  
- **Exposed object**: `window.electronAPI`

#### 1. Available Methods

```js
// Google login
window.electronAPI.googleLogin()

// Yahoo login (if needed)
window.electronAPI.yahooLogin()

// Fetch Gmail messages with pagination (recommended)
window.electronAPI.fetchGmailMessages(page = 1, pageSize = 20)
```

> Note: the renderer only needs to work with `window.electronAPI.fetchGmailMessages`. It does **not** have to talk to IMAP directly.

### 3. Pagination Usage Example (Renderer Pseudo Code)

```js
let currentPage = 1
const pageSize = 20

async function loadPage(page) {
  const { status, messages, pagination, error } =
    await window.electronAPI.fetchGmailMessages(page, pageSize)

  if (status !== 'ok') {
    console.error('Failed to load mailbox:', error)
    return
  }

  // Render email list
  renderMessages(messages)

  // Update pagination UI
  updatePaginationUI(pagination)
}

// Initial load: latest 20 emails
loadPage(1)

// Jump to page from an input
goButton.onclick = () => {
  const page = Number(pageInput.value) || 1
  loadPage(page)
}

// Next / Previous buttons
nextButton.onclick = () => {
  if (lastPagination?.hasNext) loadPage(lastPagination.page + 1)
}

prevButton.onclick = () => {
  if (lastPagination?.hasPrev) loadPage(lastPagination.page - 1)
}
```

With this, the frontend just needs to render by `messages` and `pagination`:
- Page 1 = **latest 20 emails**  
- Following pages show older emails step by step.
