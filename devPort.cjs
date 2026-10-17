/**
 * Dev-only: Vite port for `npm run dev`. Keep in sync with package.json (dev:vite, wait-on).
 * Use 5174 so another app (e.g. a second clone) can keep using 5173.
 * Dev server host is 127.0.0.1 (see vite.config.js); keep wait-on / loadURL in sync.
 */
module.exports = 5174;
