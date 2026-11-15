import { describe, expect, it, vi } from 'vitest'
import zlib from 'zlib'
import { buildEpub, buildEpubChapters } from './epub-generator'
import { ENDPOINTS } from '../discord/endpoints'
import { ChannelType, MessageType } from '../discord/types'
import type { DiscordMessage, DiscordThread } from '../discord/types'

function extractZipEntries(zipBuffer: Buffer): Map<string, string> {
  let eocdOffset = -1
  const minOffset = Math.max(0, zipBuffer.length - 65557)
  for (let i = zipBuffer.length - 22; i >= minOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) {
    throw new Error('ZIP sin End of Central Directory')
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10)
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16)
  const entries = new Map<string, string>()

  let pos = cdOffset
  for (let i = 0; i < totalEntries; i++) {
    expect(zipBuffer.readUInt32LE(pos)).toBe(0x02014b50)
    const compressionMethod = zipBuffer.readUInt16LE(pos + 10)
    const compressedSize = zipBuffer.readUInt32LE(pos + 20)
    const nameLen = zipBuffer.readUInt16LE(pos + 28)
    const extraLen = zipBuffer.readUInt16LE(pos + 30)
    const commentLen = zipBuffer.readUInt16LE(pos + 32)
    const localHeaderOffset = zipBuffer.readUInt32LE(pos + 42)

    const filename = zipBuffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8')
    pos += 46 + nameLen + extraLen + commentLen

    expect(zipBuffer.readUInt32LE(localHeaderOffset)).toBe(0x04034b50)
    const lhNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26)
    const lhExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen
    const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize)

    const content =
      compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? zlib.inflateRawSync(compressed)
          : Buffer.alloc(0)

    entries.set(filename, content.toString('utf8'))
  }

  return entries
}

/** Decodifica entidades numéricas XML emitidas por dom-serializer (&#x...; / &#...;) conservando etiquetas y &lt;/&gt;. */
function decodeNumericEntities(xhtml: string): string {
  return xhtml
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
}

function makeThread(name = 'Hilo de prueba'): DiscordThread {
  return {
    id: 't1',
    guild_id: 'g1',
    parent_id: 'c1',
    owner_id: 'u1',
    name,
    type: ChannelType.PUBLIC_THREAD,
    last_message_id: 'm1',
    message_count: 1,
    member_count: 1,
    total_message_sent: 1,
    applied_tags: [],
    thread_metadata: {
      archived: false,
      auto_archive_duration: 1440,
      archive_timestamp: '2026-01-01T00:00:00.000Z',
      locked: false
    },
    created_timestamp: '2026-01-01T09:00:00.000Z'
  }
}

function makeMessage(id: string, content: string, overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id,
    channel_id: 't1',
    author: {
      id: 'u1',
      username: 'alice',
      discriminator: '0',
      global_name: 'Alice',
      avatar: null
    },
    content,
    timestamp: '2026-01-01T10:00:00.000Z',
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    pinned: false,
    type: MessageType.DEFAULT,
    ...overrides
  }
}

describe('epub-generator', () => {
  it('genera un EPUB válido con formato completo, embeds, stickers, respuestas y protección XSS offline', async () => {
    const attMappedUrl = 'https://cdn.discordapp.com/attachments/1/captura.png'
    const attUnmappedUrl = 'https://cdn.discordapp.com/attachments/1/manual.pdf'
    const stickerMappedUrl = ENDPOINTS.STICKER('st-100', 'png')
    const stickerGifUrl = ENDPOINTS.STICKER('st-300', 'gif')

    const assetMap = new Map<string, string>([
      [attMappedUrl, 'assets/images/captura.png'],
      [stickerMappedUrl, 'assets/images/saludo.png'],
      [stickerGifUrl, 'assets/images/baile.gif']
    ])

    const richBody = [
      '# Encabezado Uno',
      '## Encabezado Dos',
      '### Encabezado Tres',
      '> Primera línea citada',
      '> Segunda línea con **negrita**',
      '```ts',
      'const a = "**no negrita**"',
      '# no es encabezado',
      '> no es cita',
      '||no es spoiler||',
      '<t:1700000000>',
      '<script>alert("xss-code")</script>',
      '```',
      '```',
      'bloque sin lenguaje',
      '```',
      'Texto con ||spoiler en línea||, defecto <t:1700000000>, corta <t:1700000000:d>, hora <t:1700000000:t>, larga <t:1700000000:F> y relativa <t:1700000000:R>.',
      '||Spoiler de bloque completo||',
      'Payload XSS: <script>alert(1)</script> <img src="https://evil.example/a.png" onerror="alert(1)"> [malicioso](javascript:alert(1))'
    ].join('\n')

    const refSource = makeMessage(
      'm0',
      'Mensaje original citado con suficiente texto para verificar que se muestra el extracto en el bloque de respuesta y evita <script>xss</script>.',
      {
        author: {
          id: 'u2',
          username: 'bob',
          discriminator: '0',
          global_name: 'Bob',
          avatar: null
        }
      }
    )

    const messages: DiscordMessage[] = [
      makeMessage('m1', richBody, {
        type: MessageType.REPLY,
        referenced_message: refSource,
        attachments: [
          {
            id: 'att1',
            filename: 'captura.png',
            content_type: 'image/png',
            size: 2048,
            url: attMappedUrl,
            proxy_url: 'https://media.discordapp.net/attachments/1/captura.png'
          },
          {
            id: 'att2',
            filename: 'manual.pdf',
            content_type: 'application/pdf',
            size: 4096,
            url: attUnmappedUrl,
            proxy_url: 'https://media.discordapp.net/attachments/1/manual.pdf'
          }
        ],
        embeds: [
          {
            author: { name: 'Estrato Bot', url: 'https://example.com/bot' },
            title: 'Guía de archivo',
            url: 'https://example.com/guia',
            description: 'Resumen **enriquecido** con <t:1700000000:D>',
            fields: [
              { name: 'Estado', value: 'Operativo' },
              { name: 'Notas', value: 'Sin conexión' }
            ],
            footer: { text: 'Pie del embed' }
          }
        ],
        sticker_items: [
          { id: 'st-100', name: 'Saludo', format_type: 1 },
          { id: 'st-200', name: 'Animado', format_type: 3 },
          { id: 'st-300', name: 'Baile', format_type: 4 }
        ],
        reactions: [{ emoji: { id: null, name: '🔥' }, count: 4 }]
      }),
      makeMessage('m2', '>>> Cita multilínea\nLínea final citada')
    ]

    const buffer = await buildEpub(makeThread('Hilo <Seguro>'), messages, assetMap)

    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK')

    const entries = extractZipEntries(buffer)
    expect(entries.get('mimetype')).toBe('application/epub+zip')

    const chapterEntry = Array.from(entries.entries()).find(([name]) =>
      /^OEBPS\/0_.*\.xhtml$/.test(name)
    )
    expect(chapterEntry).toBeDefined()
    const rawXhtml = chapterEntry![1]
    const xhtml = decodeNumericEntities(rawXhtml)

    // Encabezados
    expect(xhtml).toContain('<h1>Encabezado Uno</h1>')
    expect(xhtml).toContain('<h2>Encabezado Dos</h2>')
    expect(xhtml).toContain('<h3>Encabezado Tres</h3>')

    // Citas > y >>>
    expect(xhtml).toContain('<blockquote>')
    expect(xhtml).toContain('Primera línea citada')
    expect(xhtml).toContain('<strong>negrita</strong>')
    expect(xhtml).toContain('Cita multilínea')
    expect(xhtml).toContain('Línea final citada')

    // Bloques de código multilínea sin interpretar Markdown interno
    expect(xhtml).toContain('<pre><code class="language-ts">')
    expect(xhtml).toContain('const a = &quot;**no negrita**&quot;')
    expect(xhtml).toContain('# no es encabezado')
    expect(xhtml).toContain('&gt; no es cita')
    expect(xhtml).toContain('||no es spoiler||')
    expect(xhtml).toContain('&lt;t:1700000000&gt;')
    expect(xhtml).toContain('&lt;script&gt;alert(&quot;xss-code&quot;)&lt;/script&gt;')
    expect(xhtml).toContain('<pre><code>bloque sin lenguaje</code></pre>')
    expect(xhtml).not.toContain('<strong>no negrita</strong>')

    // Spoilers legibles
    expect(xhtml).toContain('class="spoiler"')
    expect(xhtml).toContain('[Spoiler: spoiler en línea]')
    expect(xhtml).toContain('[Spoiler: Spoiler de bloque completo]')

    // Timestamps formateados en español (sin tokens crudos fuera del bloque de código)
    expect(xhtml).not.toContain('<t:1700000000:d>')
    expect(xhtml).not.toContain('<t:1700000000:t>')
    expect(xhtml).not.toContain('<t:1700000000:F>')
    expect(xhtml).not.toContain('<t:1700000000:R>')
    expect(xhtml).toContain('14/11/2023')
    expect(xhtml).toContain('noviembre')
    expect(xhtml).toMatch(/hace \d+/)

    // Respuesta citada
    expect(xhtml).toContain('En respuesta a')
    expect(xhtml).toContain('@Bob')
    expect(xhtml).toContain('Mensaje original citado')

    // Embed completo
    expect(xhtml).toContain('Estrato Bot')
    expect(xhtml).toContain('https://example.com/guia')
    expect(xhtml).toContain('Guía de archivo')
    expect(xhtml).toContain('Resumen <strong>enriquecido</strong>')
    expect(xhtml).toContain('Estado')
    expect(xhtml).toContain('Operativo')
    expect(xhtml).toContain('Pie del embed')

    // Adjuntos y stickers offline con ruta local cuando existe en assetMap
    expect(xhtml).toContain('Adjunto: captura.png')
    expect(xhtml).toContain('assets/images/captura.png')
    expect(xhtml).toContain('Adjunto: manual.pdf')
    expect(xhtml).toContain('Sticker: Saludo')
    expect(xhtml).toContain('assets/images/saludo.png')
    expect(xhtml).toContain('Sticker: Animado')
    expect(xhtml).toContain('Sticker: Baile')
    expect(xhtml).toContain('assets/images/baile.gif')

    // Seguridad XSS y modo offline (sin etiquetas ejecutables ni <img>)
    expect(xhtml).not.toMatch(/<(?:script|img)\b/i)
    expect(xhtml).not.toContain('href="javascript:')
    expect(xhtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(xhtml).toContain('&lt;img src=&quot;')
  })

  it('divide hilos con más de 250 mensajes en múltiples capítulos XHTML y cede el event loop cada 100 mensajes', async () => {
    const totalMessages = 520
    const messages = Array.from({ length: totalMessages }, (_, idx) =>
      makeMessage(`msg-${idx + 1}`, `Contenido del mensaje número ${idx + 1}`)
    )

    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate')
    try {
      const chapters = await buildEpubChapters(makeThread('Hilo Masivo'), messages, new Map())
      expect(chapters).toHaveLength(3)
      expect(chapters.map((c) => c.title)).toEqual(['Parte 1', 'Parte 2', 'Parte 3'])
      expect(chapters[0].content).toContain('número 1<')
      expect(chapters[0].content).toContain('número 250<')
      expect(chapters[0].content).not.toContain('número 251<')
      expect(chapters[1].content).toContain('número 251<')
      expect(chapters[1].content).toContain('número 500<')
      expect(chapters[2].content).toContain('número 501<')
      expect(chapters[2].content).toContain('número 520<')
      expect(setImmediateSpy).toHaveBeenCalledTimes(5)

      const buffer = await buildEpub(makeThread('Hilo Masivo'), messages, new Map())
      expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK')

      const entries = extractZipEntries(buffer)
      const toc = decodeNumericEntities(entries.get('OEBPS/toc.xhtml') || '')
      expect(toc).toContain('Parte 1')
      expect(toc).toContain('Parte 2')
      expect(toc).toContain('Parte 3')

      const chapterFiles = Array.from(entries.keys()).filter((name) =>
        /^OEBPS\/\d+_Parte-\d+\.xhtml$/.test(name)
      )
      expect(chapterFiles).toHaveLength(3)
    } finally {
      setImmediateSpy.mockRestore()
    }
  })

  it('mantiene un único capítulo para hilos de 250 mensajes o menos y maneja hilos vacíos', async () => {
    const exactly250 = Array.from({ length: 250 }, (_, idx) =>
      makeMessage(`m-${idx + 1}`, `Mensaje ${idx + 1}`)
    )
    const chapters250 = await buildEpubChapters(makeThread('Límite 250'), exactly250, new Map())
    expect(chapters250).toHaveLength(1)
    expect(chapters250[0].title).toBe('Conversación')

    const emptyBuffer = await buildEpub(makeThread('Hilo Vacío'), [], new Map())
    expect(emptyBuffer.subarray(0, 2).toString('ascii')).toBe('PK')
  })
})
