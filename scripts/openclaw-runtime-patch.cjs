#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const repoRoot = path.resolve(__dirname, '..')
const patchRoot = path.join(repoRoot, 'ops', 'openclaw-runtime-patches', '2026.5.12')
const manifestPath = path.join(patchRoot, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

const args = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith('--openclaw-root=')))
const rootArg = process.argv.slice(2).find((arg) => arg.startsWith('--openclaw-root='))
const openclawRoot = path.resolve(
  rootArg ? rootArg.slice('--openclaw-root='.length) : path.join(os.homedir(), '.openclaw', 'lib', 'node_modules', 'openclaw'),
)
const apply = args.has('--apply')
const json = args.has('--json')
const probe = apply && !args.has('--no-probe')

function usage() {
  return [
    'Usage:',
    '  node scripts/openclaw-runtime-patch.cjs --check',
    '  node scripts/openclaw-runtime-patch.cjs --apply',
    '',
    'Options:',
    '  --openclaw-root=/path/to/openclaw  Override installed OpenClaw package root',
    '  --json                           Print JSON report',
    '  --no-probe                       Skip post-apply status/session probes',
  ].join('\n')
}

if (args.has('--help') || (!args.has('--check') && !apply)) {
  console.log(usage())
  process.exit(args.has('--help') ? 0 : 2)
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function timestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('')
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 10000,
  })
}

function readOpenClawVersion() {
  try {
    return run('openclaw', ['--version'], { timeout: 10000 }).trim()
  } catch (error) {
    return `unavailable: ${error.message}`
  }
}

function ensureInsideRoot(targetPath) {
  const relative = path.relative(openclawRoot, targetPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside OpenClaw root: ${targetPath}`)
  }
}

const report = {
  mode: apply ? 'apply' : 'check',
  manifest: manifest.name,
  expectedOpenClawVersion: manifest.openclawVersion,
  observedOpenClawVersion: readOpenClawVersion(),
  openclawRoot,
  backupDir: null,
  files: [],
  probes: [],
}

if (!report.observedOpenClawVersion.includes(manifest.openclawVersion)) {
  throw new Error(`OpenClaw version mismatch. Expected ${manifest.openclawVersion}, got: ${report.observedOpenClawVersion}`)
}

function ensureBackupDir() {
  if (!report.backupDir) {
    report.backupDir = path.join(os.homedir(), '.openclaw', 'backups', `runtime-patch-reapply-${timestamp()}`)
    fs.mkdirSync(report.backupDir, { recursive: true })
  }
  return report.backupDir
}

for (const file of manifest.files) {
  const targetPath = path.join(openclawRoot, file.target)
  const assetPath = path.join(patchRoot, file.asset)
  ensureInsideRoot(targetPath)

  if (!fs.existsSync(targetPath)) throw new Error(`Missing target file: ${targetPath}`)
  if (!fs.existsSync(assetPath)) throw new Error(`Missing patch asset: ${assetPath}`)

  const currentSha = sha256(targetPath)
  const assetSha = sha256(assetPath)
  if (assetSha !== file.patchedSha256) {
    throw new Error(`Patch asset checksum mismatch for ${file.asset}: ${assetSha}`)
  }

  const entry = {
    target: file.target,
    currentSha256: currentSha,
    patchedSha256: file.patchedSha256,
    status: null,
    changed: false,
    backup: null,
  }

  if (currentSha === file.patchedSha256) {
    entry.status = 'already-patched'
  } else if (file.sourceSha256.includes(currentSha)) {
    entry.status = apply ? 'patched' : 'needs-apply'
    if (apply) {
      const backupPath = path.join(ensureBackupDir(), file.target.replace(/[\\/]/g, '__'))
      fs.copyFileSync(targetPath, backupPath)
      fs.copyFileSync(assetPath, targetPath)
      run(process.execPath, ['--check', targetPath], { timeout: 10000 })
      entry.changed = true
      entry.backup = backupPath
      entry.currentSha256 = sha256(targetPath)
    }
  } else {
    entry.status = 'unknown-current-sha'
    report.files.push(entry)
    throw new Error(`Refusing to patch unknown ${file.target}. Current SHA: ${currentSha}`)
  }

  report.files.push(entry)
}

if (probe) {
  const probes = [
    ['openclaw', ['status', '--json', '--timeout', '3000']],
    ['openclaw', ['sessions', '--json', '--limit', '1']],
  ]
  for (const [command, commandArgs] of probes) {
    const started = Date.now()
    run(command, commandArgs, { timeout: 15000 })
    report.probes.push({
      command: [command, ...commandArgs].join(' '),
      durationMs: Date.now() - started,
      status: 'pass',
    })
  }
}

if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`${report.manifest}: ${report.mode}`)
  console.log(`OpenClaw: ${report.observedOpenClawVersion}`)
  if (report.backupDir) console.log(`Backup: ${report.backupDir}`)
  for (const file of report.files) {
    console.log(`- ${file.target}: ${file.status}${file.changed ? ' (changed)' : ''}`)
  }
  for (const probeResult of report.probes) {
    console.log(`- ${probeResult.command}: ${probeResult.status} (${probeResult.durationMs}ms)`)
  }
}
