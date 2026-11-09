#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

const DEFAULT_DATABASE_ID = '65cc4aee-154a-474f-9ed4-aabea0924c98'
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_POLLS = 120
const DEFAULT_POLL_INTERVAL_MS = 5_000
const API_BASE = 'https://api.cloudflare.com/client/v4'

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required ${name}`)
  }
  return value.trim()
}

async function parseCloudflareResponse(response, operation) {
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`${operation} returned a non-JSON response (HTTP ${response.status})`)
  }

  if (!response.ok || payload?.success !== true) {
    const messages = Array.isArray(payload?.errors)
      ? payload.errors.map(item => item?.message).filter(Boolean).join('; ')
      : ''
    const suffix = messages ? `: ${messages}` : ''
    throw new Error(`${operation} failed (HTTP ${response.status})${suffix}`)
  }

  return payload.result
}

/** Start a D1 SQL export and poll until Cloudflare provides a signed download URL. */
export async function startAndPollD1Export({
  accountId,
  databaseId,
  apiToken,
  fetchImpl = fetch,
  sleepImpl = sleep,
  maxPolls = DEFAULT_MAX_POLLS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}) {
  accountId = requireText(accountId, 'Cloudflare account ID')
  databaseId = requireText(databaseId, 'D1 database ID')
  apiToken = requireText(apiToken, 'Cloudflare D1 export token')

  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1) {
    throw new Error('maxPolls must be a positive safe integer')
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error('pollIntervalMs must be a non-negative safe integer')
  }

  const endpoint = `${API_BASE}/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/export`
  const headers = {
    authorization: `Bearer ${apiToken}`,
    'content-type': 'application/json',
    accept: 'application/json',
  }

  async function exportRequest(body) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    return parseCloudflareResponse(response, 'Cloudflare D1 export')
  }

  let result = await exportRequest({ output_format: 'polling' })
  const bookmark = result?.at_bookmark
  if (typeof bookmark !== 'string' || bookmark.trim() === '') {
    throw new Error('Cloudflare D1 export did not return an export bookmark')
  }

  for (let poll = 0; poll <= maxPolls; poll += 1) {
    if (typeof result?.signed_url === 'string' && result.signed_url.trim() !== '') {
      let signedUrl
      try {
        signedUrl = new URL(result.signed_url)
      } catch {
        throw new Error('Cloudflare D1 export returned an invalid signed download URL')
      }
      if (signedUrl.protocol !== 'https:' || signedUrl.username || signedUrl.password) {
        throw new Error('Cloudflare D1 export returned an unsafe signed download URL')
      }
      return { signedUrl: signedUrl.toString(), filename: result.filename ?? null, bookmark }
    }

    if (poll === maxPolls) break
    await sleepImpl(pollIntervalMs)
    result = await exportRequest({ current_bookmark: bookmark })
  }

  throw new Error(`Cloudflare D1 export was not ready after ${maxPolls} polling attempts`)
}

/** Download the SQL dump to a private temporary file while computing a bounded SHA-256. */
export async function downloadD1Dump({
  url,
  filePath,
  fetchImpl = fetch,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  const parsedUrl = new URL(requireText(url, 'signed download URL'))
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('The D1 dump URL must be HTTPS and must not contain credentials')
  }
  filePath = requireText(filePath, 'backup file path')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer')
  }

  const response = await fetchImpl(parsedUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(5 * 60_000),
  })
  if (!response.ok) {
    throw new Error(`Downloading the D1 export failed (HTTP ${response.status})`)
  }
  if (!response.body) throw new Error('The D1 export response had no body')

  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`The D1 export exceeds the configured ${maxBytes}-byte safety limit`)
  }

  const digest = createHash('sha256')
  let bytes = 0
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length
      if (bytes > maxBytes) {
        callback(new Error(`The D1 export exceeds the configured ${maxBytes}-byte safety limit`))
        return
      }
      digest.update(chunk)
      callback(null, chunk)
    },
  })

  await mkdir(dirname(filePath), { recursive: true })
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      meter,
      createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
    )
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => {})
    throw error
  }

  if (bytes === 0) {
    await rm(filePath, { force: true }).catch(() => {})
    throw new Error('The D1 export was empty; refusing to upload an empty backup')
  }

  return { bytes, sha256: digest.digest('hex') }
}

export function buildBackupObjectKey(date, runId, runAttempt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must use YYYY-MM-DD')
  if (!/^\d+$/.test(String(runId))) throw new Error('runId must contain digits only')
  if (!/^\d+$/.test(String(runAttempt))) throw new Error('runAttempt must contain digits only')
  return `d1/otyapoint-db/${date}/backup-${runId}-${runAttempt}.sql`
}

async function main() {
  const accountId = requireText(process.env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID')
  const apiToken = requireText(process.env.OTYAPOINT_BACKUP_CLOUDFLARE_API_TOKEN, 'OTYAPOINT_BACKUP_CLOUDFLARE_API_TOKEN')
  const databaseId = process.env.OTYAPOINT_D1_DATABASE_ID?.trim() || DEFAULT_DATABASE_ID
  const runId = requireText(process.env.GITHUB_RUN_ID, 'GITHUB_RUN_ID')
  const runAttempt = requireText(process.env.GITHUB_RUN_ATTEMPT, 'GITHUB_RUN_ATTEMPT')
  const githubOutput = requireText(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT')
  const runnerTemp = process.env.RUNNER_TEMP?.trim() || tmpdir()
  const date = new Date().toISOString().slice(0, 10)
  const objectKey = buildBackupObjectKey(date, runId, runAttempt)
  const filePath = join(runnerTemp, `otyapoint-d1-${runId}-${runAttempt}.sql`)

  let completed = false
  try {
    console.log(`Starting consistent D1 export for database ${databaseId}.`)
    const exported = await startAndPollD1Export({ accountId, databaseId, apiToken })
    const downloaded = await downloadD1Dump({ url: exported.signedUrl, filePath })

    const outputs = [
      `backup_file=${filePath}`,
      `object_key=${objectKey}`,
      `sha256=${downloaded.sha256}`,
      `bytes=${downloaded.bytes}`,
    ].join('\n') + '\n'
    await appendFile(githubOutput, outputs, { mode: 0o600 })
    completed = true
    console.log(`D1 export downloaded: ${downloaded.bytes} bytes; SHA-256 ${downloaded.sha256}.`)
    console.log(`Private R2 destination: otyapoint-backups/${objectKey}.`)
  } finally {
    if (!completed) await rm(filePath, { force: true }).catch(() => {})
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(`D1 backup export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exitCode = 1
  })
}
