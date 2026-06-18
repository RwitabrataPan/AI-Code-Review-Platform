import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt, decrypt } from './crypto'

beforeAll(() => {
  // 32-byte hex key for tests
  process.env.ENCRYPTION_KEY = 'a'.repeat(64)
})

describe('encrypt / decrypt', () => {
  it('roundtrips a string', () => {
    const original = 'github_pat_abc123'
    expect(decrypt(encrypt(original))).toBe(original)
  })

  it('produces different ciphertext on each call', () => {
    const a = encrypt('same')
    const b = encrypt('same')
    expect(a).not.toBe(b)
  })

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('secret')
    const tampered = encrypted.slice(0, -4) + 'xxxx'
    expect(() => decrypt(tampered)).toThrow()
  })

  it('roundtrips an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('')
  })

  it('roundtrips a unicode string', () => {
    const unicode = '日本語テスト 🔐'
    expect(decrypt(encrypt(unicode))).toBe(unicode)
  })
})
