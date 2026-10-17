# Gmail `fetchGmailBody` Attachment Examples

This document provides practical example outputs for `fetchGmailBody(uid)` after adding recipient and attachment fields, plus examples for extracting and storing attachment names safely.

## Updated Return Shape (Suggested)

```js
return {
  uid,
  subject: parsed.subject || msg.envelope?.subject || '',
  from: parsed.from?.text || (msg.envelope?.from || []).map((a) => a.address || a.name).join(', '),
  to: parsed.to?.text || (msg.envelope?.to || []).map((a) => a.address || a.name).join(', '),
  date: parsed.date || msg.envelope?.date || null,
  text: parsed.text || '',
  html: parsed.html || '',
  attachments: (parsed.attachments || []).map((a) => ({
    filename: a.filename || '',
    contentType: a.contentType || '',
    size: a.size ?? null,
  })),
}
```

## Example Output (With Attachments)

```json
{
  "uid": 5123,
  "subject": "Sprint Update - Week 8",
  "from": "Alice Zhang <alice@example.com>",
  "to": "Team 08 <team08@example.com>, Bob Li <bob@example.com>",
  "date": "2026-03-23T09:30:00.000Z",
  "text": "Hi team,\n\nThis week we finished the text extraction integration.\n\nBest,\nAlice",
  "html": "<!doctype html><html><body><p>Hi team,</p><p>This week we finished...</p></body></html>",
  "attachments": [
    {
      "filename": "Sprint_Report_v2.pdf",
      "contentType": "application/pdf",
      "size": 124560
    },
    {
      "filename": "API_Contract.docx",
      "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "size": 45678
    }
  ]
}
```

## Example Output (No Attachments)

```json
{
  "uid": 5124,
  "subject": "Quick question",
  "from": "Bob Li <bob@example.com>",
  "to": "alice@example.com",
  "date": "2026-03-23T10:15:00.000Z",
  "text": "Can we sync tomorrow?",
  "html": "<p>Can we sync tomorrow?</p>",
  "attachments": []
}
```

## Optional Simplified `attachments` Shape

If only file names are needed:

```js
attachments: (parsed.attachments || [])
  .map((a) => a.filename || '')
  .filter(Boolean)
```

Then output becomes:

```json
{
  "attachments": ["Sprint_Report_v2.pdf", "API_Contract.docx"]
}
```

## Safe Attachment Name Extraction Snippet

```js
const attachmentNames = result.attachments?.map((a) =>
  typeof a === 'string' ? a : (a.filename || a.original_name || '')
).filter(Boolean) ?? []
```

This snippet works with both:
- `string[]`
- `[{ filename, ... }]`
- `[{ original_name, ... }]`

