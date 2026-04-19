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
})
