import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  buildBackupObjectKey,
  downloadD1Dump,
  startAndPollD1Export,
} from './export-d1-backup.mjs'

test('D1 export starts once and polls using the returned bookmark', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body), authorization: options.headers.authorization })
    if (calls.length === 1) {
      return new Response(JSON.stringify({ success: true, result: { at_bookmark: 'bookmark-1' } }))
    }
    return new Response(JSON.stringify({
      success: true,
      result: { signed_url: 'https://downloads.example/backup.sql?signature=opaque', filename: 'backup.sql' },
    }))
  }

  const result = await startAndPollD1Export({
    accountId: 'account-1',
    databaseId: 'database-1',
    apiToken: 'test-token',
    fetchImpl,
    sleepImpl: async () => {},
    maxPolls: 2,
    pollIntervalMs: 0,
  })

  assert.equal(result.bookmark, 'bookmark-1')
  assert.equal(result.filename, 'backup.sql')
  assert.equal(result.signedUrl, 'https://downloads.example/backup.sql?signature=opaque')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].body, { output_format: 'polling' })
  assert.deepEqual(calls[1].body, { current_bookmark: 'bookmark-1' })
  assert.equal(calls[0].authorization, 'Bearer test-token')
})

test('D1 export refuses a response without a bookmark', async () => {
  await assert.rejects(
    startAndPollD1Export({
      accountId: 'account-1',
      databaseId: 'database-1',
      apiToken: 'test-token',
      fetchImpl: async () => new Response(JSON.stringify({ success: true, result: {} })),
      maxPolls: 1,
      pollIntervalMs: 0,
    }),
    /did not return an export bookmark/,
  )
})

test('D1 export stops on Cloudflare API errors without exposing request credentials', async () => {
  await assert.rejects(
    startAndPollD1Export({
      accountId: 'account-1',
      databaseId: 'database-1',
      apiToken: 'secret-value',
      fetchImpl: async () => new Response(JSON.stringify({
        success: false,
        errors: [{ message: 'permission denied' }],
      }), { status: 403 }),
    }),
    error => error.message.includes('HTTP 403')
      && error.message.includes('permission denied')
      && !error.message.includes('secret-value'),
  )
})

test('D1 export fails closed when polling does not finish within its bound', async () => {
  let requests = 0
  await assert.rejects(
    startAndPollD1Export({
      accountId: 'account-1',
      databaseId: 'database-1',
      apiToken: 'test-token',
      fetchImpl: async () => {
        requests += 1
        return new Response(JSON.stringify({ success: true, result: { at_bookmark: 'bookmark-1' } }))
      },
      sleepImpl: async () => {},
      maxPolls: 2,
      pollIntervalMs: 0,
    }),
    /not ready after 2 polling attempts/,
  )
  assert.equal(requests, 3)
})

test('D1 dump downloads with a SHA-256 digest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'otya-d1-backup-test-'))
  const filePath = join(directory, 'backup.sql')
  try {
    const result = await downloadD1Dump({
      url: 'https://downloads.example/backup.sql?signature=opaque',
      filePath,
      fetchImpl: async () => new Response('CREATE TABLE test (id INTEGER);'),
    })
    const contents = await readFile(filePath, 'utf8')
    assert.equal(contents, 'CREATE TABLE test (id INTEGER);')
    assert.equal(result.bytes, Buffer.byteLength(contents))
    assert.match(result.sha256, /^[a-f0-9]{64}$/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('D1 dump rejects non-HTTPS URLs and oversized exports before upload', async () => {
  await assert.rejects(
    downloadD1Dump({ url: 'http://downloads.example/backup.sql', filePath: '/tmp/nope.sql' }),
    /must be HTTPS/,
  )
  await assert.rejects(
    downloadD1Dump({
      url: 'https://downloads.example/backup.sql',
      filePath: '/tmp/nope.sql',
      maxBytes: 4,
      fetchImpl: async () => new Response('12345', { headers: { 'content-length': '5' } }),
    }),
    /exceeds the configured 4-byte safety limit/,
  )
})

test('R2 object paths include a date and unique workflow run attempt', () => {
  assert.equal(
    buildBackupObjectKey('2026-11-09', '42600000000', '2'),
    'd1/otyapoint-db/2026-11-09/backup-42600000000-2.sql',
  )
  assert.throws(() => buildBackupObjectKey('../x', '1', '1'), /YYYY-MM-DD/)
  assert.throws(() => buildBackupObjectKey('2026-11-09', '../1', '1'), /digits only/)
})
