/**
 * Messages API URL. With Vite `base: '/delphi/'`, defaults to same-origin
 * `/delphi/anthropic-api/v1/messages` (glade-router + dev proxy forward to Anthropic).
 */
export function anthropicMessagesUrl(): string {
  const base = import.meta.env.VITE_ANTHROPIC_API_BASE?.trim()
  if (base) {
    return `${base.replace(/\/$/, '')}/v1/messages`
  }
  const appBase = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? ''
  return `${appBase}/anthropic-api/v1/messages`
}
