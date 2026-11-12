import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { MarkdownGenerator } from './markdown-generator'
import { DiscordMarkdownParser } from '../discord/markdown-parser'
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

function generator(mode: 'single' | 'separate' | 'both'): MarkdownGenerator {
  const assetMap = new Map<string, string>([
    [ATTACHMENT.url, 'assets/images/foto.png'],
    [ATTACHMENT.proxy_url, 'assets/images/foto.png']
  ])
  return new MarkdownGenerator(new DiscordMarkdownParser(), assetMap, mode)
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
})
