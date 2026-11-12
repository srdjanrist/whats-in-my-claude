import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

/** Validates query params with zod; a bad request gets a 400 with the issues. */
export const query = <T extends z.ZodType>(schema: T) =>
  zValidator('query', schema, (result, c) => {
    if (!result.success) return c.json({ error: 'bad-request' as const, issues: result.error.issues.length }, 400)
  })

export const int = (fallback: number, min: number, max: number) =>
  z.coerce
    .number()
    .int()
    .catch(fallback)
    .transform(n => Math.min(max, Math.max(min, n)))
    .default(fallback)

export { z }
