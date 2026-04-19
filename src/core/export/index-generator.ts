// ============================================================
// Index Generator — Creates _INDEX.md files with table of
// contents, links, and statistics for each forum.
// ============================================================

import fs from 'fs'
import path from 'path'
import type { CachedPostRecord } from '../discord/types'

export class IndexGenerator {
  static generateIndex(
    forumDir: string,
    channelName: string,
    posts: CachedPostRecord[]
  ): string {
    const lines: string[] = []

    // Premium Header Banner
    lines.push('<h1 align="center">📚 Índice de Contenidos</h1>')
    lines.push(`<p align="center"><b>Canal:</b> ${channelName}</p>`)
    lines.push('<div align="center">')
    lines.push('')
    lines.push(`> 🚀 **Discord Archive Pro** | 📅 **Reporte:** ${new Date().toLocaleTimeString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`)
    lines.push('')
    lines.push('</div>')
    lines.push('')
    lines.push('---')
    lines.push('')

    // Stats Section with stylized box
    const totalSize = posts.reduce((sum, p) => sum + (p.total_size || 0), 0)
    const totalFiles = posts.reduce((sum, p) => sum + (p.file_count || 0), 0)
    const synced = posts.filter(p => p.sync_status === 'synced').length
    const outdated = posts.filter(p => p.sync_status === 'outdated').length

    lines.push('## 📊 Resumen Ejecutivo')
    lines.push('')
    lines.push('```text')
    lines.push('┌─────────────────────────────────────────────────────────────┐')
    lines.push(`│  📂 Posts Archivados:   ${posts.length.toString().padEnd(35)} │`)
    lines.push(`│  📎 Archivos Totales:   ${totalFiles.toString().padEnd(35)} │`)
    lines.push(`│  ⚖️  Tamaño en Disco:    ${IndexGenerator.formatSize(totalSize).padEnd(35)} │`)
    lines.push(`│  ✅ Sincronizados:      ${synced.toString().padEnd(35)} │`)
    lines.push(`│  🔄 Desactualizados:   ${outdated.toString().padEnd(35)} │`)
    lines.push('└─────────────────────────────────────────────────────────────┘')
    lines.push('```')
    lines.push('')
    lines.push('---')
    lines.push('')

    // Table of contents
    lines.push('## 📑 Directorio de Publicaciones')
    lines.push('')
    lines.push('| ID | Título del Post | Autor | Fecha | Archivos | Estado |')
    lines.push('|:---|:----------------|:------|:------|:---------|:------:|')

    const sorted = [...posts].sort((a, b) => {
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    })

    for (let i = 0; i < sorted.length; i++) {
      const post = sorted[i]
      const num = (i + 1).toString().padStart(3, '0')
      
      const cleanTitle = (post.title || 'Sin título')
        .replace(/[\[\]]/g, '')
        .replace(/\|/g, '\\|')
        .trim()

      const author = post.author_name || (post.author_id ? `ID: ${post.author_id}` : 'Sistema')
      
      // Fallback dating for robust indexes
      const dateValue = post.created_at || post.first_synced || post.last_synced
      const date = dateValue ? new Date(dateValue).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'
      
      const linkPath = post.download_path 
        ? path.relative(forumDir, post.download_path).replace(/\\/g, '/') 
        : '#'
      
      const safeLink = encodeURI(`${linkPath}/post.md`)
      const statusIcon = post.sync_status === 'synced' ? '✅' :
                         post.sync_status === 'outdated' ? '🔄' :
                         post.sync_status === 'error' ? '❌' : '🗑️'

      lines.push(`| ${num} | [${cleanTitle}](${safeLink}) | **${author}** | ${date} | ${post.file_count || 0} | ${statusIcon} |`)
    }

    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('<p align="center"><i>Haz clic en el título de cualquier post para visualizar el hilo completo.</i></p>')
    lines.push('<p align="center"><b>Discord Archive Pro</b> — Sistema de Resuapldo Premium</p>')

    const content = lines.join('\n')
    const indexPath = path.join(forumDir, '_INDEX.md')
    fs.writeFileSync(indexPath, content, 'utf-8')
    return indexPath
  }

  private static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
    return `${(bytes / 1073741824).toFixed(1)} GB`
  }
}
