import { createHmac, timingSafeEqual } from 'crypto'

export function validateWebhookSignature(
  body: Buffer,
  signature: string,
  secret: string
): boolean {
  if (!signature.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}
