import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { MarkdownGenerator } from './markdown-generator'
import { DiscordMarkdownParser } from '../discord/markdown-parser'
import { ENDPOINTS } from '../discord/endpoints'
import { ChannelType } from '../discord/types'
import type { DiscordMessage, DiscordThread, ForumTag } from '../discord/types'

const AUTHOR = {
  id: 'u1',
  username: 'alice',
  discriminator: '0',
  global_name: 'Alice',
  avatar: null
}

const ATTACHMENT = {
  id: 'a1',
  filename: 'foto.png',
  content_type: 'image/png',
  size: 1024,
  url: 'https://cdn.discordapp.com/attachments/1/foto.png',
  proxy_url: 'https://media.discordapp.net/attachments/1/foto.png'
}

function makeMessage(id: string, content: string, withAttachment = false): DiscordMessage {
  return {
    id,
    channel_id: 't1',
    author: AUTHOR,
    content,
    timestamp: '2026-01-01T10:00:00.000Z',
    edited_timestamp: null,
    attachments: withAttachment ? [ATTACHMENT] : [],
    embeds: [],
    pinned: false,
    type: 0
  }
}

const thread: DiscordThread = {
  id: 't1',
  guild_id: 'g1',
  parent_id: 'c1',
  owner_id: 'u1',
  name: 'Mi post',
  type: ChannelType.PUBLIC_THREAD,
  last_message_id: 'm2',
  message_count: 2,
  member_count: 1,
  total_message_sent: 2,
  applied_tags: ['tag1'],
  thread_metadata: {
    archived: false,
    auto_archive_duration: 1440,
    archive_timestamp: '2026-01-01T00:00:00.000Z',
    locked: false
  },
  created_timestamp: '2026-01-01T09:00:00.000Z'
}

const tags: ForumTag[] = [{ id: 'tag1', name: 'Soporte' }]

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dap-md-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function generator(
  mode: 'single' | 'separate' | 'both',
  includeToc = false,
  extraAssets: [string, string][] = []
): MarkdownGenerator {
  const assetMap = new Map<string, string>([
    [ATTACHMENT.url, 'assets/images/foto.png'],
    [ATTACHMENT.proxy_url, 'assets/images/foto.png'],
    ...extraAssets
  ])
  return new MarkdownGenerator(new DiscordMarkdownParser(), assetMap, mode, includeToc)
}

describe('MarkdownGenerator', () => {
  it('escribe el nombre del tag, no su ID', async () => {
    const gen = generator('both')
    const file = await gen.generatePostMarkdown(
      thread,
      [makeMessage('m1', 'Hola', true), makeMessage('m2', 'Respuesta')],
      'Servidor',
      'foro',
      root,
      tags
    )
    const content = fs.readFileSync(file, 'utf-8')
    expect(content).toContain('Soporte')
    expect(content).not.toContain('"tag1"')
  })

  it('usa rutas relativas sin ./ en el post', async () => {
    const gen = generator('both')
    const file = await gen.generatePostMarkdown(
      thread,
      [makeMessage('m1', 'Hola', true)],
      'Servidor',
      'foro',
      root,
      tags
    )
    const content = fs.readFileSync(file, 'utf-8')
    expect(content).toContain('assets/images/foto.png')
    expect(content).not.toContain('./assets/')
  })

  it('prefija ../ en los adjuntos de replies/', async () => {
    const gen = generator('both')
    await gen.generateThreadMarkdown(
      thread,
      [makeMessage('m1', 'Hola'), makeMessage('m2', 'Con foto', true)],
      'Servidor',
      'foro',
      root,
      tags
    )
    const replyDir = path.join(root, 'replies')
    const replies = fs.readdirSync(replyDir)
    expect(replies.length).toBe(1)
    const reply = fs.readFileSync(path.join(replyDir, replies[0]), 'utf-8')
    expect(reply).toContain('../assets/images/foto.png')
  })

  it('threadMode=single no genera replies/', async () => {
    const gen = generator('single')
    await gen.generateThreadMarkdown(
      thread,
      [makeMessage('m1', 'Hola'), makeMessage('m2', 'Respuesta')],
      'Servidor',
      'foro',
      root,
      tags
    )
    expect(fs.existsSync(path.join(root, 'thread.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'replies'))).toBe(false)
  })

  it('threadMode=separate no genera thread.md', async () => {
    const gen = generator('separate')
    await gen.generateThreadMarkdown(
      thread,
      [makeMessage('m1', 'Hola'), makeMessage('m2', 'Respuesta')],
      'Servidor',
      'foro',
      root,
      tags
    )
    expect(fs.existsSync(path.join(root, 'thread.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'replies'))).toBe(true)
  })

  it('omite el cuerpo cuando text=false', async () => {
    const gen = generator('both')
    const file = await gen.generatePostMarkdown(
      thread,
      [makeMessage('m1', 'CONTENIDO_SECRETO')],
      'Servidor',
      'foro',
      root,
      tags,
      { text: false, embeds: true, metadata: true, stickers: true }
    )
    const content = fs.readFileSync(file, 'utf-8')
    expect(content).not.toContain('CONTENIDO_SECRETO')
  })

  it('inserta Tabla de Contenidos en thread.md cuando includeToc=true y hay más de 1 mensaje', async () => {
    const genWithToc = generator('single', true)
    const replyMsg: DiscordMessage = {
      ...makeMessage('m2', 'Primera respuesta'),
      author: {
        id: 'u2',
        username: 'bob',
        discriminator: '0',
        global_name: 'Bob',
        avatar: null
      }
    }

    const threadFile = await genWithToc.generateThreadMarkdown(
      thread,
      [makeMessage('m1', 'Post inicial'), replyMsg],
      'Servidor',
      'foro',
      root,
      tags
    )
    const content = fs.readFileSync(threadFile, 'utf-8')

    expect(content).toContain('## Tabla de Contenidos')
    expect(content).toContain('- [Post Original — Alice](#post-original)')
    expect(content).toContain('- [Respuesta #1 — Bob](#respuesta-1)')
    expect(content.indexOf('## Tabla de Contenidos')).toBeLessThan(
      content.indexOf('## Post Original — Alice')
    )

    // Con 1 mensaje o includeToc=false no debe generarse
    const singleDir = path.join(root, 'single-msg')
    fs.mkdirSync(singleDir)
    const singleFile = await genWithToc.generateThreadMarkdown(
      thread,
      [makeMessage('m1', 'Solo OP')],
      'Servidor',
      'foro',
      singleDir,
      tags
    )
    expect(fs.readFileSync(singleFile, 'utf-8')).not.toContain('## Tabla de Contenidos')

    const noTocDir = path.join(root, 'no-toc')
    fs.mkdirSync(noTocDir)
    const noTocFile = await generator('single', false).generateThreadMarkdown(
      thread,
      [makeMessage('m1', 'Post inicial'), replyMsg],
      'Servidor',
      'foro',
      noTocDir,
      tags
    )
    expect(fs.readFileSync(noTocFile, 'utf-8')).not.toContain('## Tabla de Contenidos')
  })

  it('incluye embeds, reacciones y stickers en replies/ con rutas ../assets/ y respeta selection', async () => {
    const embedImgUrl = 'https://cdn.discordapp.com/attachments/1/embed.png'
    const customEmojiUrl = ENDPOINTS.CUSTOM_EMOJI('999', false)
    const stickerUrl = ENDPOINTS.STICKER('777', 'png')

    const gen = generator('separate', false, [
      [embedImgUrl, 'assets/images/embed.png'],
      [customEmojiUrl, 'assets/emojis/999.png'],
      [stickerUrl, 'assets/stickers/777.png']
    ])

    const replyWithExtras: DiscordMessage = {
      ...makeMessage('m2', 'Respuesta enriquecida'),
      embeds: [
        {
          title: 'Doc API',
          description: 'Descripción del embed',
          image: { url: embedImgUrl }
        }
      ],
      reactions: [
        { emoji: { id: '999', name: 'check', animated: false }, count: 4 },
        { emoji: { id: null, name: '🔥', animated: false }, count: 2 }
      ],
      sticker_items: [{ id: '777', name: 'Saludo', format_type: 1 }]
    }

    await gen.generateThreadMarkdown(
      thread,
      [makeMessage('m1', 'OP'), replyWithExtras],
      'Servidor',
      'foro',
      root,
      tags
    )

    const replyDir = path.join(root, 'replies')
    const [replyFilename] = fs.readdirSync(replyDir)
    const replyContent = fs.readFileSync(path.join(replyDir, replyFilename), 'utf-8')

    expect(replyContent).toContain('> ### Doc API')
    expect(replyContent).toContain('![embed image](../assets/images/embed.png)')
    expect(replyContent).toContain('> ![check](../assets/emojis/999.png) 4 · 🔥 2')
    expect(replyContent).toContain('![Sticker: Saludo](../assets/stickers/777.png)')

    // Respeta selection cuando embeds=false, metadata=false, stickers=false
    const filteredDir = path.join(root, 'filtered')
    fs.mkdirSync(filteredDir)
    await gen.generateThreadMarkdown(
      thread,
      [makeMessage('m1', 'OP'), replyWithExtras],
      'Servidor',
      'foro',
      filteredDir,
      tags,
      { text: true, embeds: false, metadata: false, stickers: false }
    )
    const filteredReplyDir = path.join(filteredDir, 'replies')
    const [filteredFilename] = fs.readdirSync(filteredReplyDir)
    const filteredContent = fs.readFileSync(path.join(filteredReplyDir, filteredFilename), 'utf-8')

    expect(filteredContent).toContain('Respuesta enriquecida')
    expect(filteredContent).not.toContain('Doc API')
    expect(filteredContent).not.toContain('999.png')
    expect(filteredContent).not.toContain('Sticker: Saludo')
  })

  it('escapa caracteres | en nombres de archivo dentro de la tabla Archivos Adjuntos de post.md', async () => {
    const gen = generator('both')
    const pipeMsg: DiscordMessage = {
      ...makeMessage('m1', 'Con pipe'),
      attachments: [
        {
          id: 'a-pipe',
          filename: 'tabla|v1|final.pdf',
          content_type: 'application/pdf',
          size: 2048,
          url: 'https://cdn.discordapp.com/attachments/1/tabla.pdf',
          proxy_url: 'https://media.discordapp.net/attachments/1/tabla.pdf'
        }
      ]
    }

    const file = await gen.generatePostMarkdown(
      thread,
      [pipeMsg],
      'Servidor',
      'foro',
      root,
      tags
    )
    const content = fs.readFileSync(file, 'utf-8')

    expect(content).toContain('## Archivos Adjuntos')
    expect(content).toContain('[tabla\\|v1\\|final.pdf](https://cdn.discordapp.com/attachments/1/tabla.pdf)')
  })
})
