#!/usr/bin/env node
'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const extractionDir = path.join(rootDir, 'src', 'text_extraction')
const extractionSrcDir = path.join(extractionDir, 'src')
const requirements = path.join(extractionDir, 'requirements.txt')
const distDir = path.join(rootDir, 'build', 'text_extraction')
const workDir = path.join(rootDir, 'build', 'pyinstaller', 'work')
const specDir = path.join(rootDir, 'build', 'pyinstaller', 'spec')
const outputExe = path.join(distDir, 'text_extraction_server.exe')

function run(cmd, args, cwd = rootDir) {
  const pretty = `${cmd} ${args.join(' ')}`
  console.log(`[build:text-extraction] ${pretty}`)
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false })
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw new Error(`${pretty} failed with exit code ${r.status}`)
  }
}

function commandWorks(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: rootDir, stdio: 'ignore', shell: false })
  return r.status === 0
}

function resolvePython() {
  const fromEnv = process.env.PYTHON || process.env.PYTHON_EXECUTABLE
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim()
  if (commandWorks('python', ['--version'])) return 'python'
  if (process.platform === 'win32' && commandWorks('py', ['-3', '--version'])) return 'py -3'
  throw new Error(
    'Python not found. Install Python 3.10+ or set PYTHON / PYTHON_EXECUTABLE before build:win.'
  )
}

function runPython(pythonCmd, args) {
  const [cmd, ...prefix] = pythonCmd.split(' ')
  run(cmd, [...prefix, ...args])
}

function ensureDirs() {
  fs.mkdirSync(distDir, { recursive: true })
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(specDir, { recursive: true })
}

function readInstallableRequirements() {
  const raw = fs.readFileSync(requirements, 'utf8')
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => !/^python\s*(==|>=|<=|>|<)/i.test(line))
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[build:text-extraction] Skip exe build on non-Windows platform.')
    return
  }
  ensureDirs()
  const python = resolvePython()
  runPython(python, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  const reqPkgs = readInstallableRequirements()
  const installArgs = ['-m', 'pip', 'install', ...reqPkgs, 'pyinstaller']
  runPython(python, installArgs)

  runPython(python, [
    '-m', 'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onefile',
    '--name', 'text_extraction_server',
    '--distpath', distDir,
    '--workpath', workDir,
    '--specpath', specDir,
    '--paths', extractionSrcDir,
    '--collect-submodules', 'html2text',
    path.join(extractionSrcDir, 'app.py'),
  ])

  if (!fs.existsSync(outputExe)) {
    throw new Error(`Expected output not found: ${outputExe}`)
  }
  console.log(`[build:text-extraction] OK: ${outputExe}`)
}

main()
