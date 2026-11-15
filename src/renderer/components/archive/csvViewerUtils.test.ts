import { describe, expect, it } from 'vitest'
import {
  extractJsonThreadMessages,
  filterAndSortCsvRows,
  formatCsvRows,
  parseCsvTable,
  summarizeArchiveJson
} from './csvViewerUtils'

describe('parseCsvTable', () => {
  it('elimina el BOM UTF-8 e ignora líneas finales vacías', () => {
    const csv = '\uFEFFid,autor,mensaje\r\n1,Ana,Hola\r\n2,Luis,Adiós\r\n\r\n'
    const res = parseCsvTable(csv)

    expect(res.headers).toEqual(['id', 'autor', 'mensaje'])
    expect(res.rows).toEqual([
      ['1', 'Ana', 'Hola'],
      ['2', 'Luis', 'Adiós']
    ])
    expect(res.totalRows).toBe(2)
    expect(res.truncated).toBe(false)
  })

  it('soporta comillas RFC 4180, comillas escapadas, comas y saltos de línea internos', () => {
    const csv =
      'id,autor,"nota, extra"\r\n' +
      '10,"María ""Mar""", "texto con, coma"\n'.replace(', "', ',"') +
      '11,"Pepe","primera línea\nsegunda línea\r\ntercera línea"\r\n'

    const res = parseCsvTable(csv)
    expect(res.headers).toEqual(['id', 'autor', 'nota, extra'])
    expect(res.rows).toEqual([
      ['10', 'María "Mar"', 'texto con, coma'],
      ['11', 'Pepe', 'primera línea\nsegunda línea\r\ntercera línea']
    ])
    expect(res.totalRows).toBe(2)
    expect(res.truncated).toBe(false)
  })

  it('acota las filas hasta maxRows conservando totalRows y marcando truncated', () => {
    const lines = ['n,texto']
    for (let i = 1; i <= 10; i++) {
      lines.push(`${i},fila-${i}`)
    }

    const res = parseCsvTable(lines.join('\n'), 4)
    expect(res.headers).toEqual(['n', 'texto'])
    expect(res.rows).toHaveLength(4)
    expect(res.rows[0]).toEqual(['1', 'fila-1'])
    expect(res.rows[3]).toEqual(['4', 'fila-4'])
    expect(res.totalRows).toBe(10)
    expect(res.truncated).toBe(true)
  })

  it('maneja entradas vacías y celdas vacías entrecomilladas', () => {
    expect(parseCsvTable('')).toEqual({
      headers: [],
      rows: [],
      totalRows: 0,
      truncated: false
    })
    expect(parseCsvTable('\uFEFF\r\n')).toEqual({
      headers: [],
      rows: [],
      totalRows: 0,
      truncated: false
    })

    const quotedEmpty = parseCsvTable('col\n""\n')
    expect(quotedEmpty.headers).toEqual(['col'])
    expect(quotedEmpty.rows).toEqual([['']])
    expect(quotedEmpty.totalRows).toBe(1)
  })
})

describe('filterAndSortCsvRows', () => {
  const sampleRows: string[][] = [
    ['10', 'Ángel', 'Diseño gráfico'],
    ['2', 'beatriz', 'Arquitectura'],
    ['100', 'Carlos', 'Crème brûlée'],
    ['', 'Zoe', 'Notas']
  ]

  it('filtra ignorando acentos y mayúsculas en cualquier columna', () => {
    const byAccent = filterAndSortCsvRows(sampleRows, 'diseno', null, 'asc')
    expect(byAccent).toEqual([['10', 'Ángel', 'Diseño gráfico']])

    const byDiacritic = filterAndSortCsvRows(sampleRows, 'CREME BRULEE', null, 'asc')
    expect(byDiacritic).toEqual([['100', 'Carlos', 'Crème brûlée']])

    const emptyQuery = filterAndSortCsvRows(sampleRows, '   ', null, 'asc')
    expect(emptyQuery).toEqual(sampleRows)
    expect(emptyQuery).not.toBe(sampleRows)
  })

  it('ordena numéricamente cuando los valores son números finitos y respeta asc/desc', () => {
    const onlyNums = sampleRows.slice(0, 3)

    const asc = filterAndSortCsvRows(onlyNums, '', 0, 'asc')
    expect(asc.map((r) => r[0])).toEqual(['2', '10', '100'])

    const desc = filterAndSortCsvRows(onlyNums, '', 0, 'desc')
    expect(desc.map((r) => r[0])).toEqual(['100', '10', '2'])
  })

  it('ordena alfabéticamente en español cuando no son números y mezcla vacíos con localeCompare', () => {
    const ascNames = filterAndSortCsvRows(sampleRows, '', 1, 'asc')
    expect(ascNames.map((r) => r[1])).toEqual(['Ángel', 'beatriz', 'Carlos', 'Zoe'])

    const descNames = filterAndSortCsvRows(sampleRows, '', 1, 'desc')
    expect(descNames.map((r) => r[1])).toEqual(['Zoe', 'Carlos', 'beatriz', 'Ángel'])

    const ascMixedEmpty = filterAndSortCsvRows(sampleRows, '', 0, 'asc')
    expect(ascMixedEmpty.map((r) => r[0])).toEqual(['', '2', '10', '100'])
  })
})

describe('summarizeArchiveJson', () => {
  it('calcula métricas completas de un post.json exportado', () => {
    const postJson = {
      _export: { tool: 'Estrato', version: '2.3.0' },
      thread: { id: 'th-1', name: 'Guía completa' },
      messages: [
        {
          id: 'm-1',
          author: { id: 'u-1', username: 'ana' },
          content: 'Hola mundo desde Estrato',
          attachments: [{ id: 'a-1', filename: 'portada.png' }],
          reactions: [
            { emoji: { name: '👍' }, count: 3 },
            { emoji: { name: '🔥' }, count: 2 }
          ]
        },
        {
          id: 'm-2',
          author: { id: 'u-2', username: 'luis' },
          content: 'Excelente guía práctica',
          attachments: [],
          reactions: [{ emoji: { name: '❤️' }, count: 1 }]
        },
        {
          id: 'm-3',
          author: { id: 'u-1', username: 'ana' },
          content: 'Gracias por leer',
          attachments: [{ id: 'a-2' }, { id: 'a-3' }],
          reactions: []
        }
      ],
      statistics: { total_messages: 3 }
    }

    const summary = summarizeArchiveJson(postJson)
    expect(summary).toEqual({
      kind: 'thread-export',
      messageCount: 3,
      authorCount: 2,
      attachmentCount: 3,
      reactionCount: 6,
      wordCount: 10,
      topKeys: ['_export', 'thread', 'messages', 'statistics']
    })
  })

  it('devuelve kind generic y topKeys para objetos y primitivos no exportados', () => {
    expect(summarizeArchiveJson({ nombre: 'config', version: 2, activo: true })).toEqual({
      kind: 'generic',
      topKeys: ['nombre', 'version', 'activo']
    })

    expect(summarizeArchiveJson([1, 2, 3])).toEqual({
      kind: 'generic',
      topKeys: []
    })

    expect(summarizeArchiveJson(null)).toEqual({
      kind: 'generic',
      topKeys: []
    })
  })
})

describe('formatCsvRows', () => {
  it('serializa encabezados y filas escapando comas, comillas y saltos de línea según RFC 4180', () => {
    const headers = ['id', 'autor', 'nota, extra']
    const rows = [
      ['1', 'Ana', 'Texto simple'],
      ['2', 'María "Mar"', 'Contiene, coma'],
      ['3', 'Pepe', 'Línea 1\nLínea 2']
    ]

    const csv = formatCsvRows(headers, rows)
    expect(csv).toBe(
      'id,autor,"nota, extra"\n' +
        '1,Ana,Texto simple\n' +
        '2,"María ""Mar""","Contiene, coma"\n' +
        '3,Pepe,"Línea 1\nLínea 2"'
    )

    const reparsed = parseCsvTable(csv)
    expect(reparsed.headers).toEqual(headers)
    expect(reparsed.rows).toEqual(rows)
  })

  it('devuelve cadena vacía si no hay encabezados ni filas', () => {
    expect(formatCsvRows([], [])).toBe('')
  })
})

describe('extractJsonThreadMessages', () => {
  const sampleExport = {
    thread: { id: 't-1', name: 'Hilo de prueba' },
    messages: [
      {
        id: '101',
        author: { id: 'u1', username: 'ana_dev', global_name: 'Ana García' },
        timestamp: '2026-03-10T12:00:00.000Z',
        content: 'Aquí está el diseño preliminar del módulo.',
        attachments: [{ filename: 'esquema_v1.png' }, { name: 'notas.pdf' }],
        reactions: [{ emoji: { name: '🔥' }, count: 4 }]
      },
      {
        id: '102',
        author: { id: 'u2', username: 'carlos' },
        timestamp: '2026-03-10T12:05:00.000Z',
        content: 'Revisión completada sin errores.',
        attachments: [],
        reactions: [{ emoji: { name: '✅' }, count: 2 }]
      }
    ]
  }

  it('extrae tarjetas legibles con autor, fecha, contenido, adjuntos y reacciones', () => {
    const cards = extractJsonThreadMessages(sampleExport)
    expect(cards).toEqual([
      {
        id: '101',
        author: 'Ana García',
        timestamp: '2026-03-10T12:00:00.000Z',
        content: 'Aquí está el diseño preliminar del módulo.',
        attachmentNames: ['esquema_v1.png', 'notas.pdf'],
        reactionSummary: ['🔥 4']
      },
      {
        id: '102',
        author: 'carlos',
        timestamp: '2026-03-10T12:05:00.000Z',
        content: 'Revisión completada sin errores.',
        attachmentNames: [],
        reactionSummary: ['✅ 2']
      }
    ])
  })

  it('filtra por consulta ignorando tildes y mayúsculas en autor, contenido o adjuntos', () => {
    expect(extractJsonThreadMessages(sampleExport, 'garcia')).toHaveLength(1)
    expect(extractJsonThreadMessages(sampleExport, 'DISENO')).toHaveLength(1)
    expect(extractJsonThreadMessages(sampleExport, 'ESQUEMA_V1')).toHaveLength(1)
    expect(extractJsonThreadMessages(sampleExport, 'revision')).toHaveLength(1)
    expect(extractJsonThreadMessages(sampleExport, 'inexistente')).toHaveLength(0)
  })

  it('devuelve arreglo vacío para JSON sin messages', () => {
    expect(extractJsonThreadMessages(null)).toEqual([])
    expect(extractJsonThreadMessages({ foo: 'bar' })).toEqual([])
    expect(extractJsonThreadMessages([1, 2])).toEqual([])
  })
})
