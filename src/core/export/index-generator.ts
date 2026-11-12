// ============================================================
// Generador de índices — Crea archivos _INDEX.md con índice de
// contenidos, enlaces y estadísticas para cada foro.
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

    // Banner de cabecera premium
    lines.push('<h1 align="center">📚 Índice de Contenidos</h1>')
    lines.push(`<p align="center"><b>Canal:</b> ${channelName}</p>`)
    lines.push('<div align="center">')
    lines.push('')
    lines.push(`> 🚀 **Estrato** | 📅 **Reporte:** ${new Date().toLocaleTimeString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`)
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

    // Índice de contenidos
    lines.push('## 📑 Directorio de Publicaciones')
    lines.push('')
    lines.push('| ID | Título del Post | Autor | Fecha | Archivos | Estado |')
    lines.push('|:---|:----------------|:------|:------|:---------|:------:|')

    const sorted = [...posts].sort((a, b) => {
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    })

    let fallbackId = 0
    for (const post of posts) {
      const folderName = post.download_path ? path.basename(post.download_path) : ''
      const match = /^(\d{3})_/.exec(folderName)
      if (match) fallbackId = Math.max(fallbackId, parseInt(match[1], 10))
    }

    for (const post of sorted) {
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

      const cleanTitle = (post.title || 'Sin título')
        .replace(/[\[\]]/g, '')
        .replace(/\|/g, '\\|')
        .trim()

      const author = post.author_name || (post.author_id ? `ID: ${post.author_id}` : 'Sistema')
      
      // Fecha de respaldo para índices robustos
      const dateValue = post.created_at || post.first_synced || post.last_synced
      const date = dateValue ? new Date(dateValue).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'

      const linkPath = post.download_path
        ? path.relative(forumDir, post.download_path).replace(/\\/g, '/')
        : ''

      // Enlazar al primer archivo que realmente exista (el formato elegido varía)
      let target = '#'
      if (linkPath && post.download_path) {
        for (const candidate of IndexGenerator.LINK_CANDIDATES) {
          if (fs.existsSync(path.join(post.download_path, candidate))) {
            target = encodeURI(`${linkPath}/${candidate}`)
            break
          }
        }
      }

      const statusIcon = post.sync_status === 'synced' ? '✅' :
                         post.sync_status === 'outdated' ? '🔄' :
                         post.sync_status === 'error' ? '❌' : '🗑️'

      lines.push(`| ${num} | [${cleanTitle}](${target}) | **${author}** | ${date} | ${post.file_count || 0} | ${statusIcon} |`)
    }

    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('<p align="center"><i>Haz clic en el título de cualquier post para visualizar el hilo completo.</i></p>')
    lines.push('<p align="center"><b>Estrato</b> — Archivo vivo de comunidades</p>')

    const content = lines.join('\n')
    const indexPath = path.join(forumDir, '_INDEX.md')
    const tmpPath = `${indexPath}.tmp`

    // Escritura atómica: un _INDEX.md a medio escribir rompería el índice
    fs.writeFileSync(tmpPath, content, 'utf-8')
    fs.renameSync(tmpPath, indexPath)

    return indexPath
  }

  /** Formatos que puede haber exportado un post, en orden de preferencia. */
  private static readonly LINK_CANDIDATES = [
    'post.md',
    'thread.md',
    'post.html',
    'post.json',
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
