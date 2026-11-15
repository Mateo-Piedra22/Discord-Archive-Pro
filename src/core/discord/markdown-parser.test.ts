import { describe, expect, it, vi } from 'vitest'
import { DiscordMarkdownParser } from './markdown-parser'
import { ENDPOINTS } from './endpoints'

describe('DiscordMarkdownParser', () => {
  it('resuelve menciones de usuario (caché y asíncrona), roles y canales', async () => {
    const resolveUser = vi.fn(async (id: string) =>
      id === '222'
        ? { id: '222', username: 'remoto', discriminator: '0', global_name: 'Ana Remota', avatar: null }
        : null
    )

    const parser = new DiscordMarkdownParser({
      users: new Map([
        ['111', { id: '111', username: 'mateo', discriminator: '0', global_name: 'Mateo', avatar: null }]
      ]),
      roles: new Map([
        ['333', { id: '333', name: 'Moderación', color: 0, position: 1, permissions: '0' }]
      ]),
      channels: new Map([['444', 'anuncios']]),
      resolveUser
    })

    const out = await parser.parse('Hola <@!111>, <@222> y <@999> en <#444> con <@&333> (<@&000>)')
    expect(out).toBe('Hola **@Mateo**, **@Ana Remota** y **@unknown-user** en **#anuncios** con **@Moderación** (**@unknown-role**)')
    expect(resolveUser).toHaveBeenCalledTimes(2)

    // El usuario 222 ya quedó cacheado: segunda llamada no vuelve a invocar resolveUser('222')
    await parser.parse('Otra vez <@222>')
    expect(resolveUser).toHaveBeenCalledTimes(2)
  })

  it('resuelve emojis personalizados, spoilers y timestamps', async () => {
    const parser = new DiscordMarkdownParser()
    const emojiUrl = ENDPOINTS.CUSTOM_EMOJI('987654', false)
    const gifUrl = ENDPOINTS.CUSTOM_EMOJI('123456', true)
    const assetMap = new Map([[emojiUrl, 'assets/party.png']])

    const out = await parser.parse(
      'Mira <:party:987654> <a:dance:123456> ||texto oculto|| fecha <t:1700000000:d>',
      assetMap
    )

    expect(out).toContain('![party](assets/party.png)')
    expect(out).toContain(`![dance](${gifUrl})`)
    expect(out).toContain('<details><summary>Spoiler</summary>\n\ntexto oculto\n\n</details>')
    expect(out).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('convierte embeds, reacciones y stickers a markdown', () => {
    const parser = new DiscordMarkdownParser()
    const embedMd = parser.embedToMarkdown({
      author: { name: 'Estrato Bot', url: 'https://example.com' },
      title: 'Notas de versión',
      url: 'https://example.com/release',
      description: 'Línea 1\nLínea 2',
      fields: [{ name: 'Novedad', value: 'Búsqueda 2.0' }],
      image: { url: 'https://cdn.example.com/img.png' },
      footer: { text: 'Archivo' }
    }, new Map([['https://cdn.example.com/img.png', 'assets/img.png']]))

    expect(embedMd).toContain('> **[Estrato Bot](https://example.com)**')
    expect(embedMd).toContain('> ### [Notas de versión](https://example.com/release)')
    expect(embedMd).toContain('> **Novedad**')
    expect(embedMd).toContain('> ![embed image](assets/img.png)')
    expect(embedMd).toContain('> *Archivo*')

    const reactMd = parser.reactionsToMarkdown([
      { emoji: { id: null, name: '🔥' }, count: 3, me: false },
      { emoji: { id: '55', name: 'check', animated: false }, count: 2, me: false }
    ], new Map([[ENDPOINTS.CUSTOM_EMOJI('55', false), 'assets/check.png']]))
    expect(reactMd).toBe('🔥 3 · ![check](assets/check.png) 2')

    expect(parser.stickerToMarkdown({ id: '7', name: 'Saludo', format_type: 3 })).toBe('*[Sticker: Saludo]*')
    expect(parser.stickerToMarkdown({ id: '8', name: 'Logo', format_type: 4 })).toContain('.gif)')
  })

  it('deduplica resolveUser cuando una mención aparece repetida y reemplaza todas sus apariciones', async () => {
    const resolveUser = vi.fn(async (id: string) =>
      id === '555'
        ? { id: '555', username: 'elena', discriminator: '0', global_name: 'Elena', avatar: null }
        : null
    )
    const parser = new DiscordMarkdownParser({ resolveUser })

    const out = await parser.parse('Hola <@555>, repite <@!555> y <@555>; desconocido <@888> y <@!888>')
    expect(out).toBe('Hola **@Elena**, repite **@Elena** y **@Elena**; desconocido **@unknown-user** y **@unknown-user**')
    // Aunque 555 aparece 3 veces y 888 aparece 2 veces (devolviendo null), solo se consulta 1 vez por ID único
    expect(resolveUser).toHaveBeenCalledTimes(2)
    expect(resolveUser).toHaveBeenCalledWith('555')
    expect(resolveUser).toHaveBeenCalledWith('888')
  })

  it('soporta emojis personalizados con guiones y timestamps t, T, R, negativos e inválidos', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'))
      const parser = new DiscordMarkdownParser()

      const emojiGuionUrl = ENDPOINTS.CUSTOM_EMOJI('777', false)
      const gifGuionUrl = ENDPOINTS.CUSTOM_EMOJI('888', true)
      const assetMap = new Map([[emojiGuionUrl, 'assets/mi-emoji-1.png']])

      const outEmojis = await parser.parse('<:mi-emoji-1:777> <a:anim-emoji~2:888>', assetMap)
      expect(outEmojis).toBe(`![mi-emoji-1](assets/mi-emoji-1.png) ![anim-emoji~2](${gifGuionUrl})`)

      const ts = 1700000000
      const date = new Date(ts * 1000)
      const expectedT = new Intl.DateTimeFormat('es-ES', { hour: 'numeric', minute: '2-digit' }).format(date)
      const expectedTT = new Intl.DateTimeFormat('es-ES', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      }).format(date)

      const twoHoursAgoSec = Math.floor((Date.now() - 2 * 3600 * 1000) / 1000)
      const inFiveMinSec = Math.floor((Date.now() + 5 * 60 * 1000) / 1000)

      const outTimes = await parser.parse(
        `<t:${ts}:t> | <t:${ts}:T> | <t:${twoHoursAgoSec}:R> | <t:${inFiveMinSec}:R> | <t:-86400:d> | <t:99999999999999999999:f>`
      )
      const parts = outTimes.split(' | ')
      expect(parts[0]).toBe(expectedT)
      expect(parts[0]).toMatch(/^\d{1,2}:\d{2}/)
      expect(parts[0]).not.toContain('/')
      expect(parts[1]).toBe(expectedTT)
      expect(parts[1]).toMatch(/^\d{1,2}:\d{2}:\d{2}/)
      expect(parts[1]).not.toContain('/')
      expect(parts[2]).toBe('hace 2 horas')
      expect(parts[3]).toBe('en 5 minutos')
      expect(parts[4]).toMatch(/\d{2}\/\d{2}\/1969/)
      expect(parts[5]).toBe('<t:99999999999999999999:f>')
    } finally {
      vi.useRealTimers()
    }
  })
})
