// ============================================================
// Generador de PDF — documento paginado, sin bloquear el proceso.
// Cede el event loop cada N mensajes para que la UI siga viva.
// ============================================================

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { sanitizePdfText, stripMarkdown, wrapText } from './text-utils'
import type { DiscordThread, DiscordMessage } from '../discord/types'

const MARGIN = 48
const FONT_SIZE = 10.5
const LINE_HEIGHT = 15
const YIELD_EVERY = 20
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89

export interface PdfOptions {
  thread: DiscordThread
  messages: DiscordMessage[]
  outputDir: string
  /** url -> ruta relativa (assets/...) */
  assetMap: Map<string, string>
}

export class PdfGenerator {
  /** Ruta de la fuente Unicode empaquetada. */
  static fontPath(): string {
    const base = app.isPackaged
      ? process.resourcesPath
      : path.join(app.getAppPath(), 'resources')
    return path.join(base, 'fonts', 'Roboto-Regular.ttf')
  }

  static async generate(opts: PdfOptions): Promise<string> {
    const { thread, messages, outputDir, assetMap } = opts

    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)

    let font: PDFFont
    let unicode = false
    try {
      const bytes = await fs.promises.readFile(PdfGenerator.fontPath())
      font = await doc.embedFont(new Uint8Array(bytes), { subset: true })
      unicode = true
    } catch {
      font = await doc.embedFont(StandardFonts.Helvetica)
      unicode = false
    }

    let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    let y = PAGE_HEIGHT - MARGIN

    const text = (value: string): string => sanitizePdfText(value, unicode)

    const ensureSpace = (needed: number): void => {
      if (y - needed >= MARGIN) return
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - MARGIN
    }

    const drawLine = (
      value: string,
      size: number,
      color = rgb(0.15, 0.15, 0.17),
      indent = 0
    ): void => {
      const safe = text(value)
      if (!safe) return
      ensureSpace(size + 4)
      page.drawText(safe, { x: MARGIN + indent, y, size, font, color })
      y -= size + 4
    }

    const drawWrapped = (
      value: string,
      size: number,
      indent = 0,
      color = rgb(0.15, 0.15, 0.17)
    ): void => {
      const maxWidth = PAGE_WIDTH - MARGIN * 2 - indent
      for (const paragraph of text(value).split('\n')) {
        if (!paragraph.trim()) {
          y -= size * 0.6
          continue
        }
        for (const line of wrapText(paragraph, size, maxWidth, (t, s) => font.widthOfTextAtSize(t, s))) {
          ensureSpace(size + 4)
          page.drawText(line, { x: MARGIN + indent, y, size, font, color })
          y -= LINE_HEIGHT
        }
      }
    }

    const drawImage = async (relativePath: string): Promise<void> => {
      const filePath = path.join(outputDir, relativePath.split('/').join(path.sep))
      const exists = await fs.promises.access(filePath).then(() => true, () => false)
      if (!exists) return
      try {
        const buffer = await sharp(filePath)
          .resize({ width: 420, withoutEnlargement: true })
          .png()
          .toBuffer()
        const image = await doc.embedPng(buffer)
        const maxWidth = PAGE_WIDTH - MARGIN * 2
        const ratio = Math.min(maxWidth / image.width, 320 / image.height, 1)
        const width = image.width * ratio
        const height = image.height * ratio
        ensureSpace(height + 10)
        page.drawImage(image, { x: MARGIN, y: y - height, width, height })
        y -= height + 10
      } catch {
        // Imagen corrupta o formato no soportado: se omite sin romper el PDF.
      }
    }

    // Cabecera
    drawLine(thread.name || 'Hilo', 18, rgb(0.05, 0.05, 0.08))
    y -= 4
    const created = messages[0]?.timestamp
      ? new Date(messages[0].timestamp).toLocaleString('es-ES')
      : ''
    drawLine(`${messages.length} mensajes${created ? ` · ${created}` : ''}`, 9, rgb(0.45, 0.45, 0.5))
    y -= 10

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const author = msg.author.global_name || msg.author.username
      const when = new Date(msg.timestamp).toLocaleString('es-ES')

      ensureSpace(40)
      drawLine(`${author} · ${when}`, 9, rgb(0.36, 0.4, 0.55))

      if (msg.referenced_message) {
        const ref = msg.referenced_message
        const refAuthor = ref.author?.global_name || ref.author?.username || 'Usuario'
        const rawRef = stripMarkdown(ref.content || '').replace(/\s+/g, ' ').trim()
        const refSnippet = rawRef.length > 90
          ? `${rawRef.slice(0, 87)}...`
          : rawRef || (ref.attachments?.length ? `[${ref.attachments.length} adjunto(s)]` : '(sin texto)')
        drawLine(`↳ Respondiendo a ${refAuthor}: ${refSnippet}`, 8.5, rgb(0.45, 0.48, 0.54), 10)
      }

      drawWrapped(stripMarkdown(msg.content || ''), FONT_SIZE)

      for (const attachment of msg.attachments) {
        const rel = assetMap.get(attachment.url)
        const isImage = (attachment.content_type || '').startsWith('image/')
        if (rel && isImage) {
          await drawImage(rel)
        } else {
          drawLine(`Adjunto: ${attachment.filename}`, 9, rgb(0.4, 0.4, 0.45), 10)
        }
      }

      if (msg.embeds && msg.embeds.length > 0) {
        for (const embed of msg.embeds) {
          const title = (embed.title || embed.author?.name || '').trim()
          const rawDesc = stripMarkdown(embed.description || '').replace(/\s+/g, ' ').trim()
          const desc = rawDesc.length > 220 ? `${rawDesc.slice(0, 217)}...` : rawDesc
          if (title) {
            drawLine(`[Embed] ${title}`, 9, rgb(0.3, 0.35, 0.65), 10)
          }
          if (desc) {
            drawWrapped(desc, 9, 10, rgb(0.35, 0.37, 0.42))
          }
          if (!title && !desc && embed.url) {
            drawLine(`[Embed] ${embed.url}`, 9, rgb(0.3, 0.35, 0.65), 10)
          }
        }
      }

      if (msg.reactions && msg.reactions.length > 0) {
        const summary = msg.reactions
          .map((r) => `${r.emoji.name || 'emoji'} (${r.count})`)
          .join(' · ')
        drawWrapped(`Reacciones: ${summary}`, 8.5, 10, rgb(0.4, 0.4, 0.45))
      }

      y -= 6
      if (i > 0 && i % YIELD_EVERY === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    const pages = doc.getPages()
    const totalPages = pages.length
    const footerSize = 8
    for (let idx = 0; idx < totalPages; idx++) {
      const p = pages[idx]
      const footerText = text(`Página ${idx + 1} de ${totalPages} · Estrato`)
      let footerWidth: number
      try {
        footerWidth = font.widthOfTextAtSize(footerText, footerSize)
      } catch {
        footerWidth = footerText.length * footerSize * 0.5
      }
      const { width: pageWidth } = p.getSize()
      p.drawText(footerText, {
        x: Math.max(MARGIN, pageWidth - MARGIN - footerWidth),
        y: 24,
        size: footerSize,
        font,
        color: rgb(0.5, 0.5, 0.55)
      })
    }

    const bytes = await doc.save()
    const filePath = path.join(outputDir, 'export.pdf')
    await fs.promises.writeFile(filePath, bytes)
    return filePath
  }
}
