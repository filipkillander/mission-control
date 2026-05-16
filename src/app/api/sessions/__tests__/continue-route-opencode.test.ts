import { describe, expect, it, vi, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { POST } from '@/app/api/sessions/continue/route'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { role: 'operator', username: 'tester' } })),
}))

vi.mock('@/lib/command', () => ({
  runCommand: mocks.runCommand,
}))

vi.mock('@/lib/opencode-sessions', () => ({
  getOpenCodeExecutable: vi.fn(() => '/custom/bin/opencode'),
}))

describe('OpenCode session continue route', () => {
  beforeEach(() => {
    mocks.runCommand.mockClear()
    delete process.env.CODEX_BIN
  })

  it('invokes the OpenCode CLI with the resume command for kind=opencode', async () => {
    const request = new Request('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'opencode', id: 'ses_open_1', prompt: 'continue' }),
    })
    const response = await POST(request as any)
    expect(response.status).not.toBe(400)
    expect(mocks.runCommand).toHaveBeenCalledWith(
      '/custom/bin/opencode',
      ['run', '--session', 'ses_open_1', 'continue'],
      expect.objectContaining({ timeoutMs: 180000 }),
    )
  })

  it('surfaces OpenCode runtime failures as a 500 error', async () => {
    mocks.runCommand.mockRejectedValueOnce(new Error('Model not found: anthropic/claude-opus-4.5'))

    const request = new Request('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'opencode', id: 'ses_open_1', prompt: 'continue' }),
    })

    const response = await POST(request as any)
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toContain('Model not found')
  })

  it('invokes Codex CLI resume through resolved binary and stdin prompt', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-codex-bin-'))
    const codexBin = path.join(tmpDir, 'codex')
    await fs.writeFile(codexBin, '#!/bin/sh\nexit 0\n')
    await fs.chmod(codexBin, 0o755)
    process.env.CODEX_BIN = codexBin

    const request = new Request('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'codex-cli', id: 'codex_session_1', prompt: 'continue safely' }),
    })

    const response = await POST(request as any)
    expect(response.status).toBe(200)
    expect(mocks.runCommand).toHaveBeenCalledWith(
      codexBin,
      expect.arrayContaining(['exec', 'resume', 'codex_session_1', '-']),
      expect.objectContaining({ timeoutMs: 180000, input: 'continue safely' }),
    )
  })
})
