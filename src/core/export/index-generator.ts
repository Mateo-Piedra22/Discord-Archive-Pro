// ============================================================
// Generador de índices — Crea archivos _INDEX.md con índice de
// contenidos, enlaces y estadísticas para cada foro.
// ============================================================

import fs from 'fs'
import path from 'path'
import type { CachedPostRecord } from '../discord/types'

export class IndexGenerator {
  static async generateIndexAsync(
    forumDir: string,
    channelName: string,
    posts: CachedPostRecord[]
  ): Promise<string> {
    const content = await IndexGenerator.buildIndexContentAsync(forumDir, channelName, posts)
    const indexPath = path.join(forumDir, '_INDEX.md')
    const tmpPath = `${indexPath}.tmp`

    await fs.promises.mkdir(forumDir, { recursive: true })
    await fs.promises.writeFile(tmpPath, content, 'utf-8')
    await fs.promises.rename(tmpPath, indexPath)

    return indexPath
  }

  static generateIndex(
    forumDir: string,
    channelName: string,
    posts: CachedPostRecord[]
  ): string {
    const content = IndexGenerator.buildIndexContent(forumDir, channelName, posts)
    const indexPath = path.join(forumDir, '_INDEX.md')
    const tmpPath = `${indexPath}.tmp`

    // Escritura atómica: un _INDEX.md a medio escribir rompería el índice
    if (!fs.existsSync(forumDir)) fs.mkdirSync(forumDir, { recursive: true })
    fs.writeFileSync(tmpPath, content, 'utf-8')
    fs.renameSync(tmpPath, indexPath)

    return indexPath
  }

  private static buildIndexContent(
    forumDir: string,
    channelName: string,
    posts: CachedPostRecord[]
  ): string {
    const lines = IndexGenerator.buildHeaderLines(channelName, posts)
    const entries = IndexGenerator.preparePostEntries(posts)

    for (const { post, num } of entries) {
      const target = IndexGenerator.resolveLinkTargetSync(forumDir, post)
      lines.push(IndexGenerator.formatPostRow(post, num, target))
    }

    lines.push(...IndexGenerator.buildFooterLines())
    return lines.join('\n')
  }

  private static async buildIndexContentAsync(
    forumDir: string,
    channelName: string,
    posts: CachedPostRecord[]
  ): Promise<string> {
    const lines = IndexGenerator.buildHeaderLines(channelName, posts)
    const entries = IndexGenerator.preparePostEntries(posts)

    for (let i = 0; i < entries.length; i++) {
      const { post, num } = entries[i]
      const target = await IndexGenerator.resolveLinkTargetAsync(forumDir, post)
      lines.push(IndexGenerator.formatPostRow(post, num, target))
      if ((i + 1) % 100 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    lines.push(...IndexGenerator.buildFooterLines())
    return lines.join('\n')
  }

  private static buildHeaderLines(channelName: string, posts: CachedPostRecord[]): string[] {
    const lines: string[] = []
    const reportDate = new Date().toLocaleString('es-ES', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })

    // Banner de cabecera premium
    lines.push('<h1 align="center">📚 Índice de Contenidos</h1>')
    lines.push(`<p align="center"><b>Canal:</b> ${channelName}</p>`)
    lines.push('<div align="center">')
    lines.push('')
    lines.push(`> 🚀 **Estrato** | 📅 **Reporte:** ${reportDate}`)
    lines.push('')
    lines.push('</div>')
    lines.push('')
    lines.push('---')
    lines.push('')

    // Sección de estadísticas con caja estilizada
    const totalSize = posts.reduce((sum, p) => sum + (p.total_size || 0), 0)
    const totalFiles = posts.reduce((sum, p) => sum + (p.file_count || 0), 0)
    const synced = posts.filter(p => p.sync_status === 'synced').length
    const outdated = posts.filter(p => p.sync_status === 'outdated').length
    const missing = posts.filter(p => (p.sync_status as string) === 'missing').length

    lines.push('## 📊 Resumen Ejecutivo')
    lines.push('')
    lines.push('```text')
    lines.push('┌─────────────────────────────────────────────────────────────┐')
    lines.push(`│  📂 Posts Archivados:   ${posts.length.toString().padEnd(35)} │`)
    lines.push(`│  📎 Archivos Totales:   ${totalFiles.toString().padEnd(35)} │`)
    lines.push(`│  ⚖️  Tamaño en Disco:    ${IndexGenerator.formatSize(totalSize).padEnd(35)} │`)
    lines.push(`│  ✅ Sincronizados:      ${synced.toString().padEnd(35)} │`)
    lines.push(`│  🔄 Desactualizados:   ${outdated.toString().padEnd(35)} │`)
    lines.push(`│  ⚠️ Ausentes:           ${missing.toString().padEnd(35)} │`)
    lines.push('└─────────────────────────────────────────────────────────────┘')
    lines.push('```')
    lines.push('')
    lines.push('---')
    lines.push('')

    // Índice de contenidos
    lines.push('## 📑 Directorio de Publicaciones')
    lines.push('')
    lines.push('| ID | Título del Post | Autor | Fecha | Archivos | Estado |')
    lines.push('|:---|:----------------|:------|:------|:---------|:------:|')

    return lines
  }

  private static buildFooterLines(): string[] {
    return [
      '',
      '---',
      '',
      '<p align="center"><i>Haz clic en el título de cualquier post para visualizar el hilo completo.</i></p>',
      '<p align="center"><b>Estrato</b> — Archivo vivo de comunidades</p>'
    ]
  }

  private static preparePostEntries(
    posts: CachedPostRecord[]
  ): { post: CachedPostRecord; num: string }[] {
    const sorted = [...posts].sort((a, b) => {
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    })

    let fallbackId = 0
    for (const post of posts) {
      const folderName = post.download_path ? path.basename(post.download_path) : ''
      const match = /^(\d{3})_/.exec(folderName)
      if (match) fallbackId = Math.max(fallbackId, parseInt(match[1], 10))
    }

    return sorted.map((post) => {
      // El ID mostrado debe coincidir con el prefijo real de la carpeta (001_...)
      const folderName = post.download_path ? path.basename(post.download_path) : ''
      const prefixMatch = /^(\d{3})_/.exec(folderName)
      let num: string
      if (prefixMatch) {
        num = prefixMatch[1]
      } else {
        fallbackId++
        num = fallbackId.toString().padStart(3, '0')
      }
      return { post, num }
    })
  }

  private static resolveLinkTargetSync(forumDir: string, post: CachedPostRecord): string {
    const linkPath = post.download_path
      ? path.relative(forumDir, post.download_path).replace(/\\/g, '/')
      : ''

    // Enlazar al primer archivo que realmente exista (el formato elegido varía)
    if (linkPath && post.download_path) {
      for (const candidate of IndexGenerator.LINK_CANDIDATES) {
        if (fs.existsSync(path.join(post.download_path, candidate))) {
          return encodeURI(`${linkPath}/${candidate}`)
        }
      }
    }
    return '#'
  }

  private static async resolveLinkTargetAsync(forumDir: string, post: CachedPostRecord): Promise<string> {
    const linkPath = post.download_path
      ? path.relative(forumDir, post.download_path).replace(/\\/g, '/')
      : ''

    if (linkPath && post.download_path) {
      for (const candidate of IndexGenerator.LINK_CANDIDATES) {
        try {
          await fs.promises.access(path.join(post.download_path, candidate))
          return encodeURI(`${linkPath}/${candidate}`)
        } catch {
          // Probar el siguiente formato candidato
        }
      }
    }
    return '#'
  }

  private static formatPostRow(post: CachedPostRecord, num: string, target: string): string {
    const cleanTitle = (post.title || 'Sin título')
      .replace(/[\[\]]/g, '')
      .replace(/\|/g, '\\|')
      .trim()

    const author = post.author_name || (post.author_id ? `ID: ${post.author_id}` : 'Sistema')

    // Fecha de respaldo para índices robustos
    const dateValue = post.created_at || post.first_synced || post.last_synced
    const date = dateValue
      ? new Date(dateValue).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'N/A'

    const status = post.sync_status as string
    const statusIcon = status === 'synced' ? '✅' :
                       status === 'outdated' ? '🔄' :
                       status === 'missing' ? '⚠️' :
                       status === 'error' ? '❌' : '🗑️'

    return `| ${num} | [${cleanTitle}](${target}) | **${author}** | ${date} | ${post.file_count || 0} | ${statusIcon} |`
  }

  /** Formatos que puede haber exportado un post, en orden de preferencia. */
  private static readonly LINK_CANDIDATES = [
    'post.md',
    'thread.md',
    'post.html',
    'post.json',
    'post.csv',
    'export.pdf',
    'export.epub'
  ]

  private static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
    return `${(bytes / 1073741824).toFixed(1)} GB`
  }
}
