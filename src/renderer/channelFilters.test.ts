import { describe, expect, it } from 'vitest'

import { filterBrowseChannels, type ChannelTypeFilters } from './channelFilters'

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
})
