import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { JsonExporter, sanitizeCsvFormula } from './json-exporter'
import { ChannelType, MessageType } from '../discord/types'
import type { DiscordMessage, DiscordThread } from '../discord/types'

function parseRfc4180Csv(raw: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' && raw[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else {
      cell += ch
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function makeThread(): DiscordThread {
  return {
    id: 'thread-99',
    guild_id: 'guild-1',
    parent_id: 'chan-42',
    owner_id: 'user-1',
    name: 'Discusión técnica',
    type: ChannelType.PUBLIC_THREAD,
    last_message_id: 'msg-2',
    message_count: 2,
    member_count: 2,
    total_message_sent: 2,
    applied_tags: ['tag-a', 'tag-b'],
    thread_metadata: {
      archived: true,
      auto_archive_duration: 4320,
      archive_timestamp: '2026-02-01T12:00:00.000Z',
      locked: false
    },
    created_timestamp: '2026-01-15T08:30:00.000Z'
  }
}

let tempDir = ''

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-json-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('JsonExporter', () => {
  it('exportThread genera post.json con estructura, mensajes y estadísticas válidas', async () => {
    const exporter = new JsonExporter()
    const thread = makeThread()

    const messages: DiscordMessage[] = [
      {
        id: 'msg-1',
        channel_id: thread.id,
        author: {
          id: 'user-1',
          username: 'mateo',
          discriminator: '0',
          global_name: 'Mateo',
          avatar: 'av1'
        },
        content: 'Mensaje inicial con @ana',
        timestamp: '2026-01-15T08:30:00.000Z',
        edited_timestamp: null,
        pinned: true,
        type: MessageType.DEFAULT,
        attachments: [
          {
            id: 'att-1',
            filename: 'diagrama.png',
            content_type: 'image/png',
            size: 1234,
            url: 'https://cdn.discordapp.com/attachments/1/diagrama.png',
            proxy_url: 'https://media.discordapp.net/attachments/1/diagrama.png',
            width: 800,
            height: 600
          }
        ],
        embeds: [{ title: 'Resumen', description: 'Detalle del embed' }],
        reactions: [
          { emoji: { id: null, name: '👍', animated: false }, count: 3 },
          { emoji: { id: 'e1', name: 'ok', animated: true }, count: 2 }
        ],
        sticker_items: [{ id: 's1', name: 'Saludo', format_type: 1 }],
        mentions: [
          {
            id: 'user-2',
            username: 'ana',
            discriminator: '0',
            global_name: 'Ana',
            avatar: null
          }
        ]
      },
      {
        id: 'msg-2',
        channel_id: thread.id,
        author: {
          id: 'user-2',
          username: 'ana',
          discriminator: '0',
          global_name: null,
          avatar: null
        },
        content: 'Respuesta citada',
        timestamp: '2026-01-15T09:00:00.000Z',
        edited_timestamp: '2026-01-15T09:05:00.000Z',
        pinned: false,
        type: MessageType.REPLY,
        attachments: [],
        embeds: [],
        referenced_message: {
          id: 'msg-1',
          channel_id: thread.id,
          author: {
            id: 'user-1',
            username: 'mateo',
            discriminator: '0',
            global_name: 'Mateo',
            avatar: 'av1'
          },
          content: 'Mensaje inicial con @ana',
          timestamp: '2026-01-15T08:30:00.000Z',
          edited_timestamp: null,
          attachments: [],
          embeds: [],
          pinned: false,
          type: MessageType.DEFAULT
        }
      }
    ]

    const outPath = await exporter.exportThread(thread, messages, tempDir)
    expect(outPath).toBe(path.join(tempDir, 'post.json'))
    expect(fs.existsSync(outPath)).toBe(true)

    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8'))

    expect(parsed._export.tool).toBe('Estrato')
    expect(parsed._export.format_version).toBe(1)
    expect(Number.isNaN(Date.parse(parsed._export.exported_at))).toBe(false)

    expect(parsed.thread).toEqual({
      id: 'thread-99',
      guild_id: 'guild-1',
      channel_id: 'chan-42',
      name: 'Discusión técnica',
      owner_id: 'user-1',
      created_at: '2026-01-15T08:30:00.000Z',
      message_count: 2,
      applied_tags: ['tag-a', 'tag-b'],
      metadata: {
        archived: true,
        locked: false,
        auto_archive_duration: 4320
      }
    })

    expect(parsed.messages).toHaveLength(2)
    expect('local_path' in parsed.messages[0].attachments[0]).toBe(false)
    expect(parsed.messages[0].referenced_message_id).toBeNull()
    expect(parsed.messages[0].mentions).toEqual([{ id: 'user-2', username: 'ana' }])
    expect(parsed.messages[0].sticker_items).toEqual([{ id: 's1', name: 'Saludo', format_type: 1 }])
    expect(parsed.messages[1].referenced_message_id).toBe('msg-1')

    expect(parsed.statistics).toEqual({
      total_messages: 2,
      total_attachments: 1,
      total_embeds: 1,
      total_reactions: 2,
      unique_authors: 2,
      date_range: {
        first: '2026-01-15T08:30:00.000Z',
        last: '2026-01-15T09:00:00.000Z'
      }
    })
  })

  it('exportCsv genera messages.csv con BOM UTF-8, CRLF y escape RFC 4180 completo', async () => {
    const exporter = new JsonExporter()
    const thread = makeThread()

    const messages: DiscordMessage[] = [
      {
        id: 'm1',
        channel_id: thread.id,
        author: {
          id: 'u1',
          username: 'alice',
          discriminator: '0',
          global_name: 'Alice "A", Dev',
          avatar: null
        },
        content: 'Texto con "comillas", comas, y\nsalto de línea\r\ny otra línea',
        timestamp: '2026-01-15T10:00:00.000Z',
        edited_timestamp: null,
        pinned: false,
        type: MessageType.DEFAULT,
        attachments: [
          {
            id: 'a1',
            filename: 'f1.txt',
            size: 10,
            url: 'https://example.com/1',
            proxy_url: 'https://example.com/p1'
          },
          {
            id: 'a2',
            filename: 'f2.txt',
            size: 20,
            url: 'https://example.com/2',
            proxy_url: 'https://example.com/p2'
          }
        ],
        embeds: [],
        reactions: [
          { emoji: { id: null, name: '🔥' }, count: 4 },
          { emoji: { id: null, name: '🎉' }, count: 3 }
        ]
      },
      {
        id: 'm2',
        channel_id: thread.id,
        author: {
          id: 'u2',
          username: 'bob',
          discriminator: '0',
          global_name: null,
          avatar: null
        },
        content: 'Mensaje simple sin caracteres especiales',
        timestamp: '2026-01-15T10:05:00.000Z',
        edited_timestamp: null,
        pinned: false,
        type: MessageType.DEFAULT,
        attachments: [],
        embeds: []
      }
    ]

    const csvPath = await exporter.exportCsv(thread, messages, tempDir)
    expect(csvPath).toBe(path.join(tempDir, 'messages.csv'))

    const rawBytes = fs.readFileSync(csvPath)
    expect(Array.from(rawBytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf])

    const text = rawBytes.toString('utf-8')
    expect(text.startsWith('\uFEFF')).toBe(true)

    const body = text.slice(1)
    expect(body.startsWith('message_id,thread_id,timestamp,author_id,author_name,content,attachments,reactions\r\n')).toBe(true)
    expect(body).toContain('"Alice ""A"", Dev"')
    expect(body).toContain('"Texto con ""comillas"", comas, y\nsalto de línea\r\ny otra línea"')
    expect(body).toContain('\r\nm2,thread-99,2026-01-15T10:05:00.000Z,u2,bob,Mensaje simple sin caracteres especiales,0,0')

    const parsedRows = parseRfc4180Csv(body)
    expect(parsedRows).toHaveLength(3)
    expect(parsedRows[0]).toEqual([
      'message_id',
      'thread_id',
      'timestamp',
      'author_id',
      'author_name',
      'content',
      'attachments',
      'reactions'
    ])
    expect(parsedRows[1]).toEqual([
      'm1',
      'thread-99',
      '2026-01-15T10:00:00.000Z',
      'u1',
      'Alice "A", Dev',
      'Texto con "comillas", comas, y\nsalto de línea\r\ny otra línea',
      '2',
      '7'
    ])
    expect(parsedRows[2]).toEqual([
      'm2',
      'thread-99',
      '2026-01-15T10:05:00.000Z',
      'u2',
      'bob',
      'Mensaje simple sin caracteres especiales',
      '0',
      '0'
    ])

    const postCsvPath = path.join(tempDir, 'post.csv')
    expect(fs.existsSync(postCsvPath)).toBe(true)
    expect(fs.readFileSync(postCsvPath)).toEqual(rawBytes)
  })

  it('exportThread incluye local_path solo cuando assetMap coincide por url o proxy_url', async () => {
    const exporter = new JsonExporter()
    const thread = makeThread()
    const messages: DiscordMessage[] = [
      {
        id: 'm1',
        channel_id: thread.id,
        author: {
          id: 'u1',
          username: 'mateo',
          discriminator: '0',
          global_name: 'Mateo',
          avatar: null
        },
        content: 'Adjuntos',
        timestamp: '2026-01-15T08:30:00.000Z',
        edited_timestamp: null,
        pinned: false,
        type: MessageType.DEFAULT,
        attachments: [
          {
            id: 'a-url',
            filename: 'uno.png',
            size: 100,
            url: 'https://cdn.discordapp.com/1/uno.png',
            proxy_url: 'https://media.discordapp.net/1/uno.png'
          },
          {
            id: 'a-proxy',
            filename: 'dos.pdf',
            size: 200,
            url: 'https://cdn.discordapp.com/2/dos.pdf',
            proxy_url: 'https://media.discordapp.net/2/dos.pdf'
          },
          {
            id: 'a-miss',
            filename: 'tres.txt',
            size: 50,
            url: 'https://cdn.discordapp.com/3/tres.txt',
            proxy_url: 'https://media.discordapp.net/3/tres.txt'
          }
        ],
        embeds: []
      }
    ]

    const assetMap = new Map<string, string>([
      ['https://cdn.discordapp.com/1/uno.png', 'assets/images/uno.png'],
      ['https://media.discordapp.net/2/dos.pdf', 'assets/files/dos.pdf']
    ])

    const outPath = await exporter.exportThread(thread, messages, tempDir, assetMap)
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8'))

    expect(parsed.messages[0].attachments[0].local_path).toBe('assets/images/uno.png')
    expect(parsed.messages[0].attachments[1].local_path).toBe('assets/files/dos.pdf')
    expect('local_path' in parsed.messages[0].attachments[2]).toBe(false)
  })

  it('sanitizeCsvFormula neutraliza fórmulas CSV/DDE y conserva números negativos y texto normal', () => {
    expect(sanitizeCsvFormula('=CMD("calc")')).toBe('\'=CMD("calc")')
    expect(sanitizeCsvFormula('+SUM(A1:A2)')).toBe('\'+SUM(A1:A2)')
    expect(sanitizeCsvFormula('@SUM(1,2)')).toBe('\'@SUM(1,2)')
    expect(sanitizeCsvFormula('-cmd')).toBe('\'-cmd')
    expect(sanitizeCsvFormula('\t=CMD()')).toBe('\'\t=CMD()')
    expect(sanitizeCsvFormula('\tnota')).toBe('\'\tnota')
    expect(sanitizeCsvFormula('-42')).toBe('-42')
    expect(sanitizeCsvFormula('-3.14')).toBe('-3.14')
    expect(sanitizeCsvFormula('foo-bar')).toBe('foo-bar')
    expect(sanitizeCsvFormula('')).toBe('')
  })

  it('exportCsv neutraliza fórmulas en autor/contenido y escribe messages.csv y post.csv idénticos', async () => {
    const exporter = new JsonExporter()
    const thread = makeThread()
    const messages: DiscordMessage[] = [
      {
        id: 'm1',
        channel_id: thread.id,
        author: { id: 'u1', username: 'attacker', discriminator: '0', global_name: '=CMD()', avatar: null },
        content: '=CMD("calc", 1)',
        timestamp: '2026-01-15T10:00:00.000Z',
        edited_timestamp: null,
        pinned: false,
        type: MessageType.DEFAULT,
        attachments: [],
        embeds: []
      },
      {
        id: 'm2',
        channel_id: thread.id,
        author: { id: 'u2', username: 'plus', discriminator: '0', global_name: '+SUM(1)', avatar: null },
        content: '@SUM(A1:A5)',
        timestamp: '2026-01-15T10:01:00.000Z',
        edited_timestamp: null,
        pinned: false,
        type: MessageType.DEFAULT,
        attachments: [],
        embeds: []
      },
      {
        id: 'm3',
        channel_id: thread.id,
        author: { id: 'u3', username: 'dash', discriminator: '0', global_name: '-cmd', avatar: null },
        content: '-42',
        timestamp: '2026-01-15T10:02:00.000Z',
        edited_timestamp: null,
        pinned: false,
        type: MessageType.DEFAULT,
        attachments: [],
        embeds: []
      },
      {
        id: 'm4',
        channel_id: thread.id,
        author: { id: 'u4', username: 'normal', discriminator: '0', global_name: 'Ana-María', avatar: null },
        content: 'texto-normal sin fórmula',
        timestamp: '2026-01-15T10:03:00.000Z',
        edited_timestamp: null,
        pinned: false,
        type: MessageType.DEFAULT,
        attachments: [],
        embeds: []
      }
    ]

    const messagesCsvPath = await exporter.exportCsv(thread, messages, tempDir)
    const postCsvPath = path.join(tempDir, 'post.csv')

    expect(messagesCsvPath).toBe(path.join(tempDir, 'messages.csv'))
    expect(fs.existsSync(messagesCsvPath)).toBe(true)
    expect(fs.existsSync(postCsvPath)).toBe(true)

    const messagesBytes = fs.readFileSync(messagesCsvPath)
    const postBytes = fs.readFileSync(postCsvPath)
    expect(postBytes).toEqual(messagesBytes)

    const parsed = parseRfc4180Csv(messagesBytes.toString('utf-8').slice(1))
    expect(parsed).toHaveLength(5)
    expect(parsed[1][4]).toBe('\'=CMD()')
    expect(parsed[1][5]).toBe('\'=CMD("calc", 1)')
    expect(parsed[2][4]).toBe('\'+SUM(1)')
    expect(parsed[2][5]).toBe('\'@SUM(A1:A5)')
    expect(parsed[3][4]).toBe('\'-cmd')
    expect(parsed[3][5]).toBe('-42')
    expect(parsed[4][4]).toBe('Ana-María')
    expect(parsed[4][5]).toBe('texto-normal sin fórmula')
  })
})
