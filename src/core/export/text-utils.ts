// ============================================================
// Utilidades de texto para PDF — puras, sin dependencias de
// Electron, para poder testearlas en Node.
// ============================================================

/** Quita caracteres de control y, si la fuente no es Unicode, todo lo no-ASCII. */
export function sanitizePdfText(value: string, unicode: boolean): string {
  if (!value) return ''
  let out = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  if (!unicode) {
    // Helvetica solo cubre WinAnsi: cualquier otro carácter rompería drawText.
    out = out.replace(/[^\x20-\x7E\n]/g, '?')
  } else {
    out = out.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
  }
  return out
}

/** Markdown → texto plano (para el PDF). */
export function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*\*|\*\*|\*|__|_|~~)/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
}

export interface WidthMeasurer {
  (text: string, size: number): number
}

/** Corta un texto en líneas que caben en `maxWidth`. */
export function wrapText(
  value: string,
  size: number,
  maxWidth: number,
  measure: WidthMeasurer
): string[] {
  const words = value.split(/\s+/)
  const lines: string[] = []
  let current = ''

  const widthOf = (s: string): number => {
    try {
      return measure(s, size)
    } catch {
      return s.length * size * 0.5
    }
  }

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (widthOf(candidate) <= maxWidth) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    if (widthOf(word) > maxWidth) {
      let chunk = ''
      for (const char of word) {
        if (widthOf(chunk + char) > maxWidth) {
          lines.push(chunk)
          chunk = char
        } else {
          chunk += char
        }
      }
      current = chunk
    } else {
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}
