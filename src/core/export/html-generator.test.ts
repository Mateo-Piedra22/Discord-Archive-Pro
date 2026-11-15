import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { HtmlGenerator } from './html-generator'
import { ENDPOINTS } from '../discord/endpoints'
import { ChannelType, MessageType } from '../discord/types'
import type { DiscordMessage, DiscordThread } from '../discord/types'

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

function makeMessage(
  id: string,
  content: string,
  overrides: Partial<DiscordMessage> = {}
): DiscordMessage {
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

let tempDir = ''

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-html-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('HtmlGenerator', () => {
  it('genera post.html con metadatos, estilos autocontenidos, avatar local y etiqueta (editado)', async () => {
    const emptyResult = await new HtmlGenerator(new Map()).generatePostHtml(
      makeThread(),
      [],
      'Servidor',
      'foro',
      tempDir
    )
    expect(emptyResult).toBe('')
    expect(fs.existsSync(path.join(tempDir, 'post.html'))).toBe(false)

    const avatarUrl = 'https://cdn.discordapp.com/avatars/u1/hash1.png'
    const assetMap = new Map<string, string>([
      [`${avatarUrl}?size=80`, 'assets/images/avatar-alice.png']
    ])

    const msg = makeMessage('m1', 'Contenido inicial', {
      author: {
        id: 'u1',
        username: 'alice',
        discriminator: '0',
        global_name: 'Alice',
        avatar: 'hash1'
      },
      edited_timestamp: '2026-01-01T10:05:00.000Z'
    })

    const outPath = await new HtmlGenerator(assetMap).generatePostHtml(
      makeThread('Guía de Estrato'),
      [msg],
      'Comunidad ES',
      'soporte',
      tempDir
    )

    expect(outPath).toBe(path.join(tempDir, 'post.html'))
    expect(fs.existsSync(outPath)).toBe(true)

    const html = fs.readFileSync(outPath, 'utf-8')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<title>Guía de Estrato — Estrato</title>')
    expect(html).toContain('Comunidad ES')
    expect(html).toContain('# soporte')
    expect(html).toContain('assets/images/avatar-alice.png')
    expect(html).toContain('<span class="timestamp-label">(editado)</span>')
    expect(html).toContain('.embed-card')
    expect(html).toContain('.spoiler')
    expect(html).toContain('.attachment-video')
    expect(html).toContain('.attachment-audio')
  })

  it('agrupa mensajes consecutivos del mismo autor en ventana de 5 minutos y rompe grupo fuera de límite o con respuesta', async () => {
    const baseMs = Date.parse('2026-01-01T10:00:00.000Z')
    const isoAt = (offsetMs: number): string => new Date(baseMs + offsetMs).toISOString()

    const bob = {
      id: 'u2',
      username: 'bob',
      discriminator: '0',
      global_name: 'Bob',
      avatar: null
    }

    const m1 = makeMessage('m1', 'Primero del grupo', { timestamp: isoAt(0) })
    const m2 = makeMessage('m2', 'Segundo dentro de 2 min', { timestamp: isoAt(2 * 60 * 1000) })
    const m3 = makeMessage('m3', 'Tercero justo a los 5 min exactos', { timestamp: isoAt(7 * 60 * 1000) })
    const m4 = makeMessage('m4', 'Cuarto tras más de 5 min', { timestamp: isoAt(12 * 60 * 1000 + 1) })
    const m5 = makeMessage('m5', 'Quinto con respuesta citada rompe grupo', {
      timestamp: isoAt(12 * 60 * 1000 + 5000),
      type: MessageType.REPLY,
      referenced_message: m1
    })
    const m6 = makeMessage('m6', 'Sexto de otro autor', {
      author: bob,
      timestamp: isoAt(12 * 60 * 1000 + 10000)
    })

    const outPath = await new HtmlGenerator(new Map()).generatePostHtml(
      makeThread('Agrupación'),
      [m1, m2, m3, m4, m5, m6],
      'Guild',
      'canal',
      tempDir
    )
    const html = fs.readFileSync(outPath, 'utf-8')

    const blockFor = (id: string, nextId?: string): string => {
      const start = html.indexOf(`id="msg-${id}"`)
      const end = nextId ? html.indexOf(`id="msg-${nextId}"`) : html.indexOf('<div id="end">')
      return html.slice(start, end)
    }

    // m1: primero del grupo (OP)
    expect(html).toContain('class="message-group first-in-group op" id="msg-m1"')
    expect(blockFor('m1', 'm2')).toContain('<div class="avatar"')
    expect(blockFor('m1', 'm2')).toContain('<div class="message-header-row">')

    // m2 y m3: agrupados -> sin first-in-group, con avatar-spacer, sin message-header-row
    expect(html).toContain('class="message-group" id="msg-m2"')
    expect(blockFor('m2', 'm3')).toContain('<div class="avatar-spacer"></div>')
    expect(blockFor('m2', 'm3')).not.toContain('<div class="message-header-row">')

    expect(html).toContain('class="message-group" id="msg-m3"')
    expect(blockFor('m3', 'm4')).toContain('<div class="avatar-spacer"></div>')
    expect(blockFor('m3', 'm4')).not.toContain('<div class="message-header-row">')

    // m4: >5 min respecto a m3 -> nuevo grupo
    expect(html).toContain('class="message-group first-in-group" id="msg-m4"')
    expect(blockFor('m4', 'm5')).toContain('<div class="message-header-row">')

    // m5: mismo autor dentro de ventana pero con referenced_message -> nuevo grupo
    expect(html).toContain('class="message-group first-in-group" id="msg-m5"')
    expect(blockFor('m5', 'm6')).toContain('<div class="message-header-row">')

    // m6: distinto autor -> nuevo grupo
    expect(html).toContain('class="message-group first-in-group" id="msg-m6"')
    expect(blockFor('m6')).toContain('<div class="message-header-row">')
  })

  it('renderiza anclas #msg-... y cita referenced_message antes de .message-header-row acotada a 90 caracteres', async () => {
    const longText = 'A'.repeat(130)
    const refMsg = makeMessage('ref-42', longText, {
      author: {
        id: 'u2',
        username: 'carlos',
        discriminator: '0',
        global_name: 'Carlos Dev',
        avatar: null
      }
    })
    const replyMsg = makeMessage('m-reply', 'De acuerdo con eso', {
      type: MessageType.REPLY,
      referenced_message: refMsg
    })

    const outPath = await new HtmlGenerator(new Map()).generatePostHtml(
      makeThread('Citas'),
      [refMsg, replyMsg],
      'Guild',
      'general',
      tempDir
    )
    const html = fs.readFileSync(outPath, 'utf-8')

    expect(html).toContain('id="msg-ref-42"')
    expect(html).toContain('id="msg-m-reply"')

    const expectedSnippet = `${'A'.repeat(87)}...`
    const expectedAnchor = `<a class="reply-preview" href="#msg-ref-42"><span class="reply-preview-author">↳ @Carlos Dev</span> <span>${expectedSnippet}</span></a>`
    expect(html).toContain(expectedAnchor)

    // La cita aparece antes que .message-header-row dentro del mensaje citado
    const msgBlock = html.slice(html.indexOf('id="msg-m-reply"'))
    expect(msgBlock.indexOf('class="reply-preview"')).toBeLessThan(msgBlock.indexOf('class="message-header-row"'))
  })

  it('renderiza adjuntos de imagen, vídeo, audio, archivos, embeds completos y stickers', async () => {
    const imgUrl = 'https://cdn.discordapp.com/attachments/1/foto.png'
    const vidUrl = 'https://cdn.discordapp.com/attachments/1/demo.mp4'
    const mkvUrl = 'https://cdn.discordapp.com/attachments/1/clip.mkv'
    const audUrl = 'https://cdn.discordapp.com/attachments/1/tema.mp3'
    const opusUrl = 'https://cdn.discordapp.com/attachments/1/nota.opus'
    const docUrl = 'https://cdn.discordapp.com/attachments/1/manual.pdf'
    const embedImgUrl = 'https://cdn.discordapp.com/embed/banner.png'
    const embedThumbUrl = 'https://cdn.discordapp.com/embed/thumb.png'
    const stickerUrl = ENDPOINTS.STICKER('st-1', 'png')

    const assetMap = new Map<string, string>([
      [imgUrl, 'assets/images/foto.png'],
      [vidUrl, 'assets/videos/demo.mp4'],
      [mkvUrl, 'assets/videos/clip.mkv'],
      [audUrl, 'assets/files/tema.mp3'],
      [opusUrl, 'assets/files/nota.opus'],
      [docUrl, 'assets/files/manual.pdf'],
      [embedImgUrl, 'assets/images/banner.png'],
      [embedThumbUrl, 'assets/images/thumb.png'],
      [stickerUrl, 'assets/images/st-1.png']
    ])

    const msg = makeMessage('m-media', 'Mira los archivos:', {
      attachments: [
        { id: 'a1', filename: 'foto.png', content_type: 'image/png', size: 100, url: imgUrl, proxy_url: imgUrl },
        { id: 'a2', filename: 'demo.mp4', content_type: 'video/mp4', size: 200, url: vidUrl, proxy_url: vidUrl },
        { id: 'a3', filename: 'clip.mkv', size: 300, url: mkvUrl, proxy_url: mkvUrl },
        { id: 'a4', filename: 'tema.mp3', content_type: 'audio/mpeg', size: 400, url: audUrl, proxy_url: audUrl },
        { id: 'a5', filename: 'nota.opus', size: 500, url: opusUrl, proxy_url: opusUrl },
        { id: 'a6', filename: 'manual.pdf', content_type: 'application/pdf', size: 2048, url: docUrl, proxy_url: docUrl }
      ],
      embeds: [
        {
          author: { name: 'Bot', url: 'https://example.com/bot' },
          title: 'Ficha Técnica',
          url: 'https://example.com/ficha',
          color: 0x5865f2,
          description: 'Descripción con **negrita** y __subrayado__',
          fields: [
            { name: 'Versión', value: '2.2.0', inline: true },
            { name: 'Estado', value: 'Estable', inline: true }
          ],
          image: { url: embedImgUrl },
          thumbnail: { url: embedThumbUrl },
          footer: { text: 'Pie del embed' }
        }
      ],
      sticker_items: [
        { id: 'st-1', name: 'Saludo', format_type: 1 },
        { id: 'st-lottie', name: 'Celebración', format_type: 3 }
      ]
    })

    const outPath = await new HtmlGenerator(assetMap).generatePostHtml(
      makeThread('Multimedia'),
      [msg],
      'Guild',
      'media',
      tempDir
    )
    const html = fs.readFileSync(outPath, 'utf-8')

    // Adjuntos multimedia
    expect(html).toContain('<img class="attachment-image" src="assets/images/foto.png"')
    expect(html).toContain('<video class="attachment-video" src="assets/videos/demo.mp4" controls preload="metadata"></video>')
    expect(html).toContain('<video class="attachment-video" src="assets/videos/clip.mkv" controls preload="metadata"></video>')
    expect(html).toContain('<audio class="attachment-audio" src="assets/files/tema.mp3" controls preload="metadata"></audio>')
    expect(html).toContain('<audio class="attachment-audio" src="assets/files/nota.opus" controls preload="metadata"></audio>')
    expect(html).toContain('class="attachment-file" href="assets/files/manual.pdf"')

    // Embed
    expect(html).toContain('class="embed-card"')
    expect(html).toContain('href="https://example.com/ficha"')
    expect(html).toContain('Ficha Técnica')
    expect(html).toContain('<strong>negrita</strong>')
    expect(html).toContain('<u>subrayado</u>')
    expect(html).toContain('Versión')
    expect(html).toContain('2.2.0')
    expect(html).toContain('assets/images/banner.png')
    expect(html).toContain('assets/images/thumb.png')
    expect(html).toContain('Pie del embed')

    // Stickers
    expect(html).toContain('src="assets/images/st-1.png"')
    expect(html).toContain('Sticker: Celebración')
  })

  it('soporta spoilers, subrayado y marcas de tiempo en español sin interpretar dentro de código', async () => {
    const body = [
      'Texto con ||secreto oculto|| y __frase subrayada__.',
      'Fechas: <t:1700000000>, <t:1700000000:d>, <t:1700000000:D>, <t:1700000000:t>, <t:1700000000:R>.',
      'Enlace con guiones bajos: https://example.com/ruta__con__guiones',
      '`||no spoiler|| __no subrayado__ <t:1700000000>`',
      '```ts',
      'const x = "||tampoco|| __tampoco__ <t:1700000000:d>"',
      '```'
    ].join('\n')

    const outPath = await new HtmlGenerator(new Map()).generatePostHtml(
      makeThread('Markdown enriquecido'),
      [makeMessage('m-md', body)],
      'Guild',
      'general',
      tempDir
    )
    const html = fs.readFileSync(outPath, 'utf-8')

    expect(html).toContain('<span class="spoiler" tabindex="0">secreto oculto</span>')
    expect(html).toContain('<u>frase subrayada</u>')
    expect(html).toContain('14/11/2023')
    expect(html).toContain('noviembre')
    expect(html).toMatch(/(?:hace|en)\s+(?:\d+|unos)\s+(?:año|años|mes|meses|día|días|hora|horas|minuto|minutos|segundos)/)
    expect(html).toContain('href="https://example.com/ruta__con__guiones"')
    expect(html).not.toContain('<u>con</u>')

    // Código protegido sin convertir
    expect(html).toContain('<code>||no spoiler|| __no subrayado__ &lt;t:1700000000&gt;</code>')
    expect(html).toContain('const x = &quot;||tampoco|| __tampoco__ &lt;t:1700000000:d&gt;&quot;')
  })

  it('escapa payloads XSS en título, autores, contenido, citas, embeds, adjuntos y stickers', async () => {
    const xss = '<script>alert("xss")</script>'
    const imgOnError = '<img src=x onerror=alert(1)>'

    const refMsg = makeMessage('ref-"xss"', `Cita con ${xss}`, {
      author: {
        id: 'u2',
        username: 'evil',
        discriminator: '0',
        global_name: `Evil ${xss}`,
        avatar: null
      }
    })

    const msg = makeMessage('msg-"xss"', `Texto ||${xss}|| __${imgOnError}__ [clic](javascript:alert(1))`, {
      author: {
        id: 'u1',
        username: 'attacker',
        discriminator: '0',
        global_name: `<b>Attacker</b>`,
        avatar: null
      },
      referenced_message: refMsg,
      attachments: [
        {
          id: 'att-xss',
          filename: 'file"><script>alert(1)</script>.txt',
          size: 10,
          url: 'javascript:alert(1)',
          proxy_url: 'javascript:alert(1)'
        }
      ],
      embeds: [
        {
          title: `Título ${xss}`,
          url: 'javascript:alert(1)',
          description: `Desc ${imgOnError}`,
          fields: [{ name: `Campo ${xss}`, value: `Valor ${xss}` }],
          footer: { text: `Pie ${xss}` }
        }
      ],
      sticker_items: [{ id: 's-xss', name: `Sticker ${xss}`, format_type: 3 }]
    })

    const outPath = await new HtmlGenerator(new Map()).generatePostHtml(
      makeThread(`Hilo ${xss}`),
      [msg],
      `Guild ${xss}`,
      `chan ${xss}`,
      tempDir
    )
    const html = fs.readFileSync(outPath, 'utf-8')

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('src="javascript:')
    expect(html).not.toContain('<img src=x onerror=')
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('id="msg-msg-&quot;xss&quot;"')
  })

  it('renderiza reacciones locales/Unicode y cede con setImmediate en hilos de más de 100 mensajes', async () => {
    const emojiUrl = 'https://cdn.discordapp.com/emojis/999.png'
    const assetMap = new Map<string, string>([[emojiUrl, 'assets/images/999.png']])

    const messages: DiscordMessage[] = Array.from({ length: 205 }, (_, i) =>
      makeMessage(`m-${i}`, `Mensaje ${i}`, {
        reactions: i === 0
          ? [
              { emoji: { id: null, name: '🔥' }, count: 5 },
              { emoji: { id: '999', name: 'estrato', animated: false }, count: 2 }
            ]
          : undefined
      })
    )

    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate')
    try {
      const outPath = await new HtmlGenerator(assetMap).generatePostHtml(
        makeThread('Hilo largo'),
        messages,
        'Guild',
        'general',
        tempDir
      )
      const html = fs.readFileSync(outPath, 'utf-8')
      expect(html).toContain('🔥')
      expect(html).toContain('assets/images/999.png')
      expect(setImmediateSpy).toHaveBeenCalledTimes(2)
    } finally {
      setImmediateSpy.mockRestore()
    }
  })
})
