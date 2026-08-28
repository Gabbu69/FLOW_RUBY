import { blobIdFromCode, encryptJSON, decryptJSON, type Envelope } from '../crypto/vault'
import { applyImport, collectExport, type ExportPayload } from '../db/transfer'

/**
 * Zero-knowledge backup to a Ruby relay (Cloudflare Worker + R2). The device
 * encrypts everything with a key derived from the recovery code; the relay
 * stores an opaque blob keyed by a hash of that code and can never read it.
 */
export async function pushBackup(endpoint: string, recoveryCode: string): Promise<void> {
  const [id, envelope] = await Promise.all([
    blobIdFromCode(recoveryCode),
    encryptJSON(await collectExport(), recoveryCode),
  ])
  const res = await fetch(`${endpoint.replace(/\/$/, '')}/v1/blob/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  })
  if (!res.ok) throw new Error(`Backup failed (${res.status})`)
}

export async function restoreBackup(endpoint: string, recoveryCode: string): Promise<number> {
  const id = await blobIdFromCode(recoveryCode)
  const res = await fetch(`${endpoint.replace(/\/$/, '')}/v1/blob/${id}`)
  if (res.status === 404) throw new Error('No backup found for that recovery code.')
  if (!res.ok) throw new Error(`Restore failed (${res.status})`)
  const envelope = (await res.json()) as Envelope
  const payload = await decryptJSON<ExportPayload>(envelope, recoveryCode).catch(() => {
    throw new Error('Could not decrypt — is the recovery code correct?')
  })
  return applyImport(payload)
}
