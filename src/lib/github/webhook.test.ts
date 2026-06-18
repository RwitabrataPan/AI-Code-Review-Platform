import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { validateWebhookSignature } from './webhook'

const SECRET = 'test-secret'

function sign(body: Buffer): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
}

describe('validateWebhookSignature', () => {
  it('accepts a valid signature', () => {
    const body = Buffer.from('{"action":"opened"}')
    expect(validateWebhookSignature(body, sign(body), SECRET)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    const body = Buffer.from('{"action":"opened"}')
    expect(validateWebhookSignature(body, 'sha256=deadbeef', SECRET)).toBe(false)
  })

  it('rejects a missing sha256= prefix', () => {
    const body = Buffer.from('payload')
    expect(validateWebhookSignature(body, 'badhash', SECRET)).toBe(false)
  })

  it('rejects a tampered body', () => {
    const body = Buffer.from('original')
    const sig = sign(body)
    const tampered = Buffer.from('modified')
    expect(validateWebhookSignature(tampered, sig, SECRET)).toBe(false)
  })
})
