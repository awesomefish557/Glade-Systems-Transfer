/** Rough average glyph width for Latin system UI fonts at `fontSizePx`. */
export function approxCharPx(fontSizePx: number): number {
  /** Slightly conservative so wrapped lines stay inside narrow boxes (was 0.58 → overflow). */
  return fontSizePx * 0.62
}

/**
 * Break `text` into lines so each line fits within `maxPixels` (estimated by character count).
 */
export function wrapTextToPixelWidth(
  text: string,
  maxPixels: number,
  fontSizePx: number,
): string[] {
  const charPx = approxCharPx(fontSizePx)
  const maxChars = Math.max(8, Math.floor(maxPixels / charPx))
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''

  for (let word of words) {
    while (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ''
      }
      lines.push(word.slice(0, maxChars))
      word = word.slice(maxChars)
    }
    if (!word) continue
    const trial = current ? `${current} ${word}` : word
    if (trial.length <= maxChars) {
      current = trial
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}
