// ============================================================
// Consistent JSON errors for API handlers (Supabase + thrown).
// ============================================================

/** Shape PostgREST / GoTrue errors for clients without leaking internals. */
export function shapeSupabaseError(err) {
  if (!err || typeof err !== 'object') return null
  const out = {
    message: err.message || String(err),
    code: err.code ?? undefined,
    details: err.details ?? undefined,
    hint: err.hint ?? undefined,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
}

/**
 * Respond with a structured error body; logs full error server-side.
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {string} message Short user-facing summary
 * @param {{ cause?: unknown, context?: string, supabase?: object }} [extra]
 */
export function jsonApiError(res, status, message, extra = {}) {
  const { cause, context, supabase } = extra
  const payload = { error: message }

  if (context) payload.context = context

  const shaped = supabase ? shapeSupabaseError(supabase) : null
  if (shaped && Object.keys(shaped).length) payload.details = shaped

  if (cause != null) {
    if (cause instanceof Error) {
      payload.reason = cause.message
      if (cause.code) payload.code = cause.code
      if (cause.supabase) payload.details = shapeSupabaseError(cause.supabase) ?? payload.details
    } else if (typeof cause === 'object' && cause.message) {
      payload.reason = cause.message
    } else {
      payload.reason = String(cause)
    }
  }

  console.error('[api]', context || 'handler', message, cause || '')
  return res.status(status).json(payload)
}
