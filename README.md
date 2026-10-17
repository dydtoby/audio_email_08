# audio_emailer 🎧📧

> An Electron.js desktop application that converts emails to speech, helping busy professionals, students, and visually impaired individuals stay on top of their inbox hands-free.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Team & Module Ownership](#team--module-ownership)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Git Workflow](#git-workflow)
- [Coding Standards](#coding-standards)
- [Feature Checklist](#feature-checklist)

---

## Project Overview

audio_emailer is a desktop email client that reads emails aloud using text-to-speech. It connects to Gmail (via OAuth2) and other email servers (IMAP/SMTP), supports multiple voices, reading speeds, and scheduled read-aloud sessions.

**Target Users:** Busy executives, students, visually impaired individuals, eTourism staff.

---

## Team & Module Ownership

Splitting the codebase by module allows 7 team members to work in parallel with minimal merge conflicts.

| # | Member | Module | Folder(s) |
|---|--------|--------|-----------|
| 1 | TBD | Auth & Session Management | `src/main/auth/`, `src/renderer/pages/Login/` |
| 2 | TBD | Email Client (IMAP/SMTP) | `src/main/email/`, `src/main/gmailImap.js` |
| 3 | TBD | Text-to-Speech Engine | `src/tts/`, `src/renderer/hooks/`, `src/renderer/context/VoiceContext.jsx` |
| 4 | TBD | Scheduler & Notifications | `src/main/scheduler/` |
| 5 | TBD | Secure persistence | `src/main/storeEncryption.js` (and `electron-store` usage in main) |
| 6 | TBD | UI – mail & reader | `src/renderer/pages/EmailView/` |
| 7 | TBD | UI – settings & preferences | `src/renderer/pages/EmailView/Setting.jsx`, `src/renderer/context/` |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | [Electron](https://www.electronjs.org/) |
| Frontend | React + Vite |
| Styling | Plain CSS (e.g. page-level `style.css`) |
| IMAP / parsing | `imapflow`, `mailparser` |
| SMTP | `nodemailer` |
| Gmail OAuth2 | `googleapis` |
| Text-to-Speech | Web Speech API (renderer) + Python helpers in `src/tts/` |
| Scheduling | `node-schedule` |
| Secure Storage | `electron-store` (optional key via `DB_ENCRYPTION_KEY`) |
| Text extraction | Python service under `src/text_extraction/` (see that folder’s README) |
| Testing | Jest (`jest.config.js`) |

---

## Project Structure

```
audio_emailer/
├── public/icons/                 # SVG assets
├── scripts/
│   └── build_text_extraction_exe.cjs
├── src/
│   ├── data/test_emails.json
│   ├── main/
│   │   ├── main.js, preload.js, gmailImap.js
│   │   ├── storeEncryption.js, textExtractionServer.js
│   │   ├── auth/, email/, integration/, scheduler/
│   ├── renderer/
│   │   ├── main.jsx, index.html
│   │   ├── components/icons/
│   │   ├── context/, hooks/, utils/
│   │   └── pages/Login/, pages/EmailView/
│   ├── text_extraction/          # Python pipeline (+ vendored html2text under src/)
│   └── tts/                      # Python TTS scripts, preferences
├── test/
├── docs/                         # diagrams / examples (optional)
├── .env.example
├── devPort.cjs
├── package.json
├── tsconfig.json
└── vite.config.js
```

---

## Getting Started

### Prerequisites

- Node.js >= 18.x
- npm >= 9.x
- Python >= 3.10 (for `src/text_extraction/` and `src/tts/` workflows)
- Google Cloud OAuth2 credentials for Gmail (see [Environment Variables](#environment-variables))

### Installation

```bash
# 1. Clone the repository
git clone https://git.shefcompsci.org.uk/com6103-2025-26/team08/project.git
cd project
git checkout dev
git pull origin dev

# 2. Install dependencies
npm install

# 3. Environment file
cp .env.example .env
# Edit .env with your client ID/secret and any optional vars

# 4. Development
npm run dev
```

Vite serves the renderer on **port 5174** (`npm run dev:vite`). Google sign-in uses a **separate** loopback server on **port 3000** with path `/auth/callback` (default redirect URI; optional `GOOGLE_REDIRECT_URI` override). Register that exact URL in Google Cloud if you use the default.

---

## Environment Variables

Copy `.env.example` to `.env` in the repo root. Committed secrets are forbidden — `.env` is gitignored.

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail OAuth |
| `GOOGLE_OAUTH_EXTERNAL_BROWSER` | Optional: `1` or `true` to use system browser |
| `YAHOO_*` | Optional Yahoo OAuth (`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`) |
| `DB_ENCRYPTION_KEY` | Optional `electron-store` encryption key |
| `TEXT_EXTRACTION_URL` | HTTP base for extraction service (default `http://127.0.0.1:5000`) |
| `TEXT_EXTRACTION_AUTOSTART` | Set `0` to disable auto-start where supported |
| `TTS_BASE_URL` | TTS HTTP base (default `http://127.0.0.1:5001`) |
| `SMTP_*` | Optional SMTP fallbacks (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`) |
| `PYTHON` / `PYTHON_EXECUTABLE` | Optional path for Python when building/running extraction |
| `TEST_IMAP_*`, `TEST_GMAIL_*`, `TEST_SMTP_*`, `MAIL_TEST_ONLY` | Optional: `npm run test:mail` (see `.env.example`) |

> ⚠️ Use the **team's shared test Google account** only. Do not use personal accounts.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` / `npm run dev` | Vite (5174) + Electron |
| `npm run dev:vite` | Vite dev server only |
| `npm run dev:electron` | Electron after Vite is up |
| `npm run build` | Production build of the renderer (`vite build`) |
| `npm run dist` | `build` + `electron-builder` (current platform targets, no publish) |
| `npm run build:win` | `build`, text-extraction exe, Windows NSIS |
| `npm run build:mac` | `build` + macOS targets (dmg) |
| `npm run build:linux` | `build` + Linux (tar.gz) |
| `npm run build:linux:deb` | `build` + Linux `.deb` |
| `npm run build:all` | `build` + Windows + Linux + macOS |
| `npm run build:all:win` | `build` then `electron-builder` with `--win` and `--linux` |
| `npm run build:text-extraction` | Build text-extraction helper exe (used by `build:win`) |
| `npm test` | Jest |
| `npm run test:smoke` | Fast Node smoke scripts (`test/run_smoke_tests.js`, no Python) |
| `npm run test:google-oauth` | Interactive Google OAuth check (`test/googleAuthTest.js`) |
| `npm run test:mail` | IMAP / Gmail OAuth refresh / SMTP checks (`test/email/`; needs `.env`) |
| `npm run test:email-connect` | End-to-end extraction + TTS + pipeline (`test/audio/email_connect/`) |
| `npm run test:audio` | Alias for `test:email-connect` |

---

## Git Workflow

To keep 7 people working smoothly:

1. **Integration branches:** **`dev`** is the day-to-day development branch (merge feature work here). **`main`** is kept for stable / release-ready code—promote **`dev`** to **`main`** when the team chooses (course rules may dictate timing).

2. **Branch naming:** `feature/<member-initials>/<short-description>`
   - e.g. `feature/jd/imap-client`, `feature/ab/tts-voice-selector`

3. **Merge requests:** open MRs **into `dev`** (not directly into **`main`**). Prefer feature branches → **`dev`** via MR; avoid committing straight to **`dev`**/`main`.

4. **MR rules (align with your module tutor / GitLab project settings):**
   - At least **1 reviewer** when required by the course or branch protection
   - Run **`npm run test:smoke`** and **`npm test`** (and any checks your team agrees on) before merge; this repo has **no in-tree CI** unless the host adds it
   - Prefer **squash on merge** if the platform offers it, for a clearer history on **`dev`** (and later on **`main`** when you promote)

5. **Commit message format** (Conventional Commits, optional but helpful):
   ```
   feat(tts): add pause duration preference
   fix(imap): handle connection timeout gracefully
   docs(readme): update setup instructions
   ```

6. **Updating your feature branch from `dev`:** many teams use **rebase** for a linear history:
   ```bash
   git fetch origin
   git rebase origin/dev
   ```
   If the branch was already pushed, update the remote safely with `git push --force-with-lease` after a rebase. If your group prefers merge commits, `git merge origin/dev` is fine instead—pick one approach and stay consistent.

---

## Coding Standards

- Prefer **functional** React components with hooks.
- Keep tokens and passwords out of git; use `.env` for local OAuth secrets.
- Align IPC and persistence changes with existing patterns in `src/main/main.js` and `preload.js`.

---

## Feature Checklist

| # | Feature | Module Owner | Status |
|---|---------|-------------|--------|
| 1 | Send & receive emails | Member 2 | ⬜ |
| 2 | Google account login | Member 1 | ⬜ |
| 3 | IMAP + SMTP + Gmail API | Member 2 | ⬜ |
| 4 | Select emails to read | Member 6 | ⬜ |
| 5 | Read all unread emails | Member 3 | ⬜ |
| 6 | Read out attachment titles | Member 3 | ⬜ |
| 7 | Scheduled read-aloud | Member 4 | ⬜ |
| 8 | Persist credentials securely | Member 5 | ⬜ |
| 9 | Logout | Member 1 | ⬜ |
| 10a | Voice preference (3+ voices) | Member 7 | ⬜ |
| 10b | Reading speed preference | Member 7 | ⬜ |
| 10c | Light/Dark theme | Member 7 | ⬜ |
| 10d | Paragraph/sentence pause config | Member 3 | ⬜ |
| 11 | GUI with secure login | Member 6 | ⬜ |
| 12 | ⭐ Star/mark important emails | Member 6 | ⬜ (optional) |
| 13 | 🎤 Speech-driven interface | Member 3 | ⬜ (optional) |

---

*Built by the audio_emailer team — eTourism Project Module*
