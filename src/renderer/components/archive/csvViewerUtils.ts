// ============================================================
// Utilidades puras para inspección de CSV y JSON archivados.
// Sin dependencias de DOM ni evaluación dinámica de código.
// ============================================================

export interface CsvTableData {
  headers: string[]
  rows: string[][]
  totalRows: number
  truncated: boolean
}

export interface ArchiveJsonSummary {
  kind: 'thread-export' | 'generic'
  messageCount?: number
  authorCount?: number
  attachmentCount?: number
  reactionCount?: number
  wordCount?: number
  topKeys: string[]
}

export interface JsonThreadMessageCard {
  id: string
  author: string
  timestamp: string
  content: string
  attachmentNames: string[]
  reactionSummary: string[]
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Parsea texto CSV completo según RFC 4180 (soporta BOM UTF-8, comillas
 * `"..."`, comillas escapadas `""`, comas y saltos de línea dentro de campos
 * entrecomillados). Limita las filas devueltas a `maxRows` conservando `totalRows`.
 */
export function parseCsvTable(content: string, maxRows = 5000): CsvTableData {
  const raw = content.startsWith('\uFEFF') ? content.slice(1) : content
  if (!raw) {
    return { headers: [], rows: [], totalRows: 0, truncated: false }
  }

  const limit = Number.isFinite(maxRows) ? Math.max(0, Math.floor(maxRows)) : 5000
  let headers: string[] | null = null
  const rows: string[][] = []
  let totalRows = 0

  let currentRow: string[] = []
  let field = ''
  let inQuotes = false
  let fieldQuoted = false
  let fieldTouched = false
  let rowHasQuotes = false
  let pendingEmptyLines = 0

  const emitRecord = (row: string[], wasQuotedLine: boolean): void => {
    const isBlankUnquoted = !wasQuotedLine && row.length === 1 && row[0] === ''
    if (isBlankUnquoted) {
      pendingEmptyLines++
      return
    }

    if (pendingEmptyLines > 0) {
      for (let k = 0; k < pendingEmptyLines; k++) {
        if (headers === null) {
          headers = ['']
        } else {
          totalRows++
          if (rows.length < limit) rows.push([''])
        }
      }
      pendingEmptyLines = 0
    }

    if (headers === null) {
      headers = row
    } else {
      totalRows++
      if (rows.length < limit) rows.push(row)
    }
  }

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]

    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"' && !fieldTouched) {
      inQuotes = true
      fieldQuoted = true
      fieldTouched = true
      rowHasQuotes = true
      continue
    }

    if (ch === ',') {
      currentRow.push(field)
      field = ''
      fieldQuoted = false
      fieldTouched = false
      continue
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && raw[i + 1] === '\n') {
        i++
      }
      currentRow.push(field)
      emitRecord(currentRow, rowHasQuotes || fieldQuoted)
      currentRow = []
      field = ''
      fieldQuoted = false
      fieldTouched = false
      rowHasQuotes = false
      continue
    }

    field += ch
    fieldTouched = true
  }

  if (inQuotes || fieldTouched || currentRow.length > 0) {
    currentRow.push(field)
    emitRecord(currentRow, rowHasQuotes || fieldQuoted)
  }

  if (!headers) {
    return { headers: [], rows: [], totalRows: 0, truncated: false }
  }

  return {
    headers,
    rows,
    totalRows,
    truncated: totalRows > rows.length
  }
}

/**
 * Filtra filas CSV ignorando acentos/mayúsculas en todas las celdas y ordena
 * por la columna indicada (numéricamente cuando ambos valores son finitos, o
 * alfabéticamente con `localeCompare('es', { numeric: true, sensitivity: 'base' })`).
 */
export function filterAndSortCsvRows(
  rows: string[][],
  query: string,
  sortCol: number | null,
  sortDir: 'asc' | 'desc'
): string[][] {
  const needle = normalizeSearchText(query.trim())
  const filtered = needle
    ? rows.filter((row) => row.some((cell) => normalizeSearchText(cell ?? '').includes(needle)))
    : [...rows]

  if (sortCol === null || sortCol < 0) {
    return filtered
  }

  const direction = sortDir === 'desc' ? -1 : 1
  return filtered.sort((a, b) => {
    const aVal = a[sortCol] ?? ''
    const bVal = b[sortCol] ?? ''
    const aTrim = aVal.trim()
    const bTrim = bVal.trim()

    let cmp: number
    if (aTrim !== '' && bTrim !== '') {
      const aNum = Number(aTrim)
      const bNum = Number(bTrim)
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
        cmp = aNum - bNum
      } else {
        cmp = aVal.localeCompare(bVal, 'es', { numeric: true, sensitivity: 'base' })
      }
    } else {
      cmp = aVal.localeCompare(bVal, 'es', { numeric: true, sensitivity: 'base' })
    }

    return cmp * direction
  })
}

/**
 * Resume un JSON parseado: si sigue el esquema de exportación de hilo
 * (`messages: Array`) calcula mensajes, autores únicos, adjuntos, reacciones
 * y palabras; para cualquier otro JSON devuelve sus claves de nivel superior.
 */
export function summarizeArchiveJson(parsed: unknown): ArchiveJsonSummary {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'generic', topKeys: [] }
  }

  const obj = parsed as Record<string, unknown>
  const topKeys = Object.keys(obj)

  if (!Array.isArray(obj.messages)) {
    return { kind: 'generic', topKeys }
  }

  const authors = new Set<string>()
  let attachmentCount = 0
  let reactionCount = 0
  let wordCount = 0

  for (const item of obj.messages) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const msg = item as Record<string, unknown>

    if (msg.author && typeof msg.author === 'object' && !Array.isArray(msg.author)) {
      const authorObj = msg.author as Record<string, unknown>
      const idOrName = authorObj.id ?? authorObj.username ?? authorObj.global_name
      if (typeof idOrName === 'string' || typeof idOrName === 'number') {
        const key = String(idOrName)
        if (key) authors.add(key)
      }
    } else if (typeof msg.author === 'string' && msg.author) {
      authors.add(msg.author)
    }

    if (Array.isArray(msg.attachments)) {
      attachmentCount += msg.attachments.length
    }

    if (Array.isArray(msg.reactions)) {
      for (const reaction of msg.reactions) {
        if (
          reaction &&
          typeof reaction === 'object' &&
          !Array.isArray(reaction) &&
          typeof (reaction as Record<string, unknown>).count === 'number'
        ) {
          const count = (reaction as { count: number }).count
          if (Number.isFinite(count) && count > 0) reactionCount += count
        } else {
          reactionCount += 1
        }
      }
    }

    if (typeof msg.content === 'string') {
      const trimmed = msg.content.trim()
      if (trimmed) {
        wordCount += trimmed.split(/\s+/).length
      }
    }
  }

  return {
    kind: 'thread-export',
    messageCount: obj.messages.length,
    authorCount: authors.size,
    attachmentCount,
    reactionCount,
    wordCount,
    topKeys
  }
}

function escapeCsvCell(value: string): string {
  const cell = value ?? ''
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`
  }
  return cell
}

/**
 * Serializa encabezados y filas en formato CSV compatible con RFC 4180.
 */
export function formatCsvRows(headers: string[], rows: string[][]): string {
  if (headers.length === 0 && rows.length === 0) return ''
  const allRows = headers.length > 0 ? [headers, ...rows] : rows
  return allRows.map((row) => row.map((cell) => escapeCsvCell(cell ?? '')).join(',')).join('\n')
}

/**
 * Extrae tarjetas legibles de mensajes desde un objeto JSON exportado (`messages: Array`)
 * y las filtra opcionalmente por autor, contenido o nombres de adjuntos (insensible a tildes y mayúsculas).
 */
export function extractJsonThreadMessages(
  parsed: unknown,
  query?: string
): JsonThreadMessageCard[] {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return []
  }

  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.messages)) {
    return []
  }

  const needle = normalizeSearchText((query ?? '').trim())
  const cards: JsonThreadMessageCard[] = []

  for (let i = 0; i < obj.messages.length; i++) {
    const item = obj.messages[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const msg = item as Record<string, unknown>

    const id =
      typeof msg.id === 'string' && msg.id
        ? msg.id
        : typeof msg.id === 'number'
          ? String(msg.id)
          : `msg-${i + 1}`

    let author = 'Autor desconocido'
    if (msg.author && typeof msg.author === 'object' && !Array.isArray(msg.author)) {
      const authorObj = msg.author as Record<string, unknown>
      const rawName =
        authorObj.global_name ??
        authorObj.display_name ??
        authorObj.username ??
        authorObj.name ??
        authorObj.id
      if (typeof rawName === 'string' && rawName.trim()) {
        author = rawName.trim()
      } else if (typeof rawName === 'number') {
        author = String(rawName)
      }
    } else if (typeof msg.author === 'string' && msg.author.trim()) {
      author = msg.author.trim()
    }

    const timestamp =
      typeof msg.timestamp === 'string'
        ? msg.timestamp
        : typeof msg.created_at === 'string'
          ? msg.created_at
          : ''

    const content = typeof msg.content === 'string' ? msg.content : ''

    const attachmentNames: string[] = []
    if (Array.isArray(msg.attachments)) {
      for (const att of msg.attachments) {
        if (typeof att === 'string' && att.trim()) {
          attachmentNames.push(att.trim())
        } else if (att && typeof att === 'object' && !Array.isArray(att)) {
          const attObj = att as Record<string, unknown>
          const rawAtt = attObj.filename ?? attObj.name ?? attObj.url ?? attObj.id
          if (typeof rawAtt === 'string' && rawAtt.trim()) {
            attachmentNames.push(rawAtt.trim())
          } else if (typeof rawAtt === 'number') {
            attachmentNames.push(String(rawAtt))
          }
        }
      }
    }

    const reactionSummary: string[] = []
    if (Array.isArray(msg.reactions)) {
      for (const reaction of msg.reactions) {
        if (typeof reaction === 'string' && reaction.trim()) {
          reactionSummary.push(reaction.trim())
        } else if (reaction && typeof reaction === 'object' && !Array.isArray(reaction)) {
          const rObj = reaction as Record<string, unknown>
          const emojiField = rObj.emoji
          let emojiLabel = '👍'
          if (typeof emojiField === 'string' && emojiField.trim()) {
            emojiLabel = emojiField.trim()
          } else if (emojiField && typeof emojiField === 'object' && !Array.isArray(emojiField)) {
            const eObj = emojiField as Record<string, unknown>
            const rawEmoji = eObj.name ?? eObj.id
            if (typeof rawEmoji === 'string' && rawEmoji.trim()) {
              emojiLabel = rawEmoji.trim()
            }
          }
          const count =
            typeof rObj.count === 'number' && Number.isFinite(rObj.count) && rObj.count > 0
              ? rObj.count
              : 1
          reactionSummary.push(`${emojiLabel} ${count}`)
        }
      }
    }

    if (needle) {
      const searchable = normalizeSearchText(
        `${author} ${content} ${attachmentNames.join(' ')}`
      )
      if (!searchable.includes(needle)) continue
    }

    cards.push({
      id,
      author,
      timestamp,
      content,
      attachmentNames,
      reactionSummary
    })
  }

  return cards
}
