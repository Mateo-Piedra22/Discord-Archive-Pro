import { describe, expect, it } from 'vitest'

import {
  filterBrowseChannels,
  foldChannelText,
  sortBrowseChannels,
  type BrowseChannel,
  type ChannelTypeFilters
} from './channelFilters'

const ALL_TYPE_FILTERS: ChannelTypeFilters = {
  text: true,
  forum: true,
  voice: true,
  dm: true,
  thread: true,
  announcement: true,
  media: true,
  other: true,
}

describe('filterBrowseChannels', () => {
  it('keeps category channels needed by visible children and uses query filtering', () => {
    const channels = [
      { id: 'cat1', type: 4, name: 'General', position: 0 },
      { id: 'cat2', type: 4, name: 'Offtopic', position: 1 },
      { id: 'c1', type: 0, name: 'chat', parent_id: 'cat1', position: 0 },
      { id: 'c2', type: 15, name: 'foro', parent_id: 'cat2', position: 0 },
      { id: 'c3', type: 2, name: 'voz', parent_id: 'cat1', position: 1 },
    ]

    const typeFilters: ChannelTypeFilters = {
      text: true,
      forum: true,
      voice: true,
      dm: true,
      thread: true,
      announcement: true,
      media: true,
      other: true,
    }

    const result = filterBrowseChannels(channels as any[], {
      query: 'chat',
      typeFilters,
      showStandardChannels: true,
    })

    const ids = result.map(c => c.id)

    expect(ids).toContain('cat1')
    expect(ids).toContain('c1')

    expect(ids).not.toContain('cat2')
    expect(ids).not.toContain('c2')
    expect(ids).not.toContain('c3')
  })

  it('respects type toggles', () => {
    const channels = [
      { id: 'cat1', type: 4, name: 'General', position: 0 },
      { id: 'c1', type: 0, name: 'chat', parent_id: 'cat1', position: 0 },
      { id: 'c2', type: 15, name: 'foro', parent_id: 'cat1', position: 1 },
    ]

    const typeFilters: ChannelTypeFilters = {
      text: false,
      forum: true,
      voice: true,
      dm: true,
      thread: true,
      announcement: true,
      media: true,
      other: true,
    }

    const result = filterBrowseChannels(channels as any[], {
      query: '',
      typeFilters,
      showStandardChannels: true,
    })

    const ids = result.map(c => c.id)

    expect(ids).toContain('cat1')
    expect(ids).toContain('c2')
    expect(ids).not.toContain('c1')
  })

  it('only hides closed tickets, and only when strict privacy is enabled', () => {
    const channels = [
      { id: 'closed', type: 0, name: 'ticket-0421' },
      { id: 'open', type: 0, name: 'ticket-general' },
      { id: 'admin', type: 0, name: 'admin-chat' },
      { id: 'staff', type: 0, name: 'staff-room' },
      { id: 'test', type: 0, name: 'test-channel' },
      { id: 'logs', type: 0, name: 'mod-logs' },
    ]

    const typeFilters: ChannelTypeFilters = {
      text: true,
      forum: true,
      voice: true,
      dm: true,
      thread: true,
      announcement: true,
      media: true,
      other: true,
    }

    // Opt-in: con strictPrivacy apagado no se oculta nada.
    const relaxed = filterBrowseChannels(channels as any[], {
      query: '',
      typeFilters,
      showStandardChannels: true,
      strictPrivacy: false,
    })
    expect(relaxed.map(c => c.id)).toEqual(['closed', 'open', 'admin', 'staff', 'test', 'logs'])

    // Encendido: sólo desaparece "ticket-<dígitos>".
    const strict = filterBrowseChannels(channels as any[], {
      query: '',
      typeFilters,
      showStandardChannels: true,
      strictPrivacy: true,
    })
    expect(strict.map(c => c.id)).toEqual(['open', 'admin', 'staff', 'test', 'logs'])
  })

  it('groups stage channels under the voice filter', () => {
    const channels = [
      { id: 'stage', type: 13, name: 'Escenario' },
      { id: 'voice', type: 2, name: 'Sala' },
    ]

    const result = filterBrowseChannels(channels as any[], {
      query: '',
      typeFilters: {
        text: true,
        forum: true,
        voice: false,
        dm: true,
        thread: true,
        announcement: true,
        media: true,
        other: true,
      },
      showStandardChannels: true,
    })

    expect(result).toHaveLength(0)
  })

  it('folds diacritics and case in query, channel name, and parent category name', () => {
    const channels: BrowseChannel[] = [
      { id: 'cat1', type: 4, name: 'Información Útil', position: 0 },
      { id: 'cat2', type: 4, name: 'General', position: 1 },
      { id: 'c1', type: 0, name: 'Música Clásica', parent_id: 'cat2', position: 0 },
      { id: 'c2', type: 0, name: 'aviso', parent_id: 'cat1', position: 1 },
    ]

    expect(foldChannelText('Canción Épica')).toBe('cancion epica')

    const byChannel = filterBrowseChannels(channels, {
      query: 'musica',
      typeFilters: ALL_TYPE_FILTERS,
      showStandardChannels: true,
    })
    expect(byChannel.map(c => c.id)).toEqual(['cat2', 'c1'])

    const byAccentQuery = filterBrowseChannels(channels, {
      query: 'AVÍSO',
      typeFilters: ALL_TYPE_FILTERS,
      showStandardChannels: true,
    })
    expect(byAccentQuery.map(c => c.id)).toEqual(['cat1', 'c2'])

    const byParentCategory = filterBrowseChannels(channels, {
      query: 'informacion util',
      typeFilters: ALL_TYPE_FILTERS,
      showStandardChannels: true,
    })
    expect(byParentCategory.map(c => c.id)).toEqual(['cat1', 'c2'])
  })

  it('matches channels by topic (case and accent insensitive)', () => {
    const channels: BrowseChannel[] = [
      { id: 'c1', type: 0, name: 'general', topic: 'Debates de programación y TypeScript' },
      { id: 'c2', type: 0, name: 'offtopic', topic: null },
      { id: 'c3', type: 0, name: 'memes' },
    ]

    const result = filterBrowseChannels(channels, {
      query: 'programacion',
      typeFilters: ALL_TYPE_FILTERS,
      showStandardChannels: true,
    })

    expect(result.map(c => c.id)).toEqual(['c1'])
  })

  it('matches forum channels by available_tags names', () => {
    const channels: BrowseChannel[] = [
      {
        id: 'f1',
        type: 15,
        name: 'soporte',
        available_tags: [
          { id: 't1', name: 'Resolución' },
          { id: 't2', name: 'Guía rápida' },
        ],
      },
      {
        id: 'f2',
        type: 15,
        name: 'showcase',
        available_tags: [{ id: 't3', name: 'Arte' }],
      },
    ]

    const result = filterBrowseChannels(channels, {
      query: 'guia',
      typeFilters: ALL_TYPE_FILTERS,
      showStandardChannels: true,
    })

    expect(result.map(c => c.id)).toEqual(['f1'])
  })
})

describe('sortBrowseChannels', () => {
  it('sorts immutably by position defaulting undefined to 0', () => {
    const original: BrowseChannel[] = [
      { id: 'c3', type: 0, name: 'tercero', position: 3 },
      { id: 'c1', type: 0, name: 'primero', position: 1 },
      { id: 'c0', type: 0, name: 'sin-posicion' },
    ]
    const snapshot = [...original]

    const sorted = sortBrowseChannels(original, 'position')

    expect(sorted.map(c => c.id)).toEqual(['c0', 'c1', 'c3'])
    expect(sorted).not.toBe(original)
    expect(original).toEqual(snapshot)
  })

  it('sorts immutably by display name including DMs and optional ChannelNameMap', () => {
    const original: BrowseChannel[] = [
      { id: 'c1', type: 0, name: 'zapato' },
      { id: 'c2', type: 0, name: 'Árbol' },
      {
        id: 'dm1',
        type: 1,
        recipients: [{ id: 'u1', username: 'user', global_name: 'Carlos', avatar: null }],
      },
      { id: 'dm2', type: 1 },
    ]

    const byDisplayName = sortBrowseChannels(original, 'name')
    expect(byDisplayName.map(c => c.id)).toEqual(['c2', 'dm1', 'dm2', 'c1'])
    expect(original.map(c => c.id)).toEqual(['c1', 'c2', 'dm1', 'dm2'])

    const withRecord = sortBrowseChannels(original, 'name', { c1: 'Alfa', dm2: 'Beta' })
    expect(withRecord.map(c => c.id)).toEqual(['c1', 'c2', 'dm2', 'dm1'])

    const withMap = sortBrowseChannels(original, 'name', new Map([['c1', 'Alfa']]))
    expect(withMap.map(c => c.id)).toEqual(['c1', 'c2', 'dm1', 'dm2'])
  })
})
