const { defineConfig } = require('vite')
const react = require('@vitejs/plugin-react')
const path = require('path')
const DEV_PORT = require('./devPort.cjs')

module.exports = defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: DEV_PORT,
    strictPort: true,
    // Avoid ::1 — on some Windows setups `listen EACCES ::1:PORT` breaks dev startup.
    host: '127.0.0.1',
  },
})

