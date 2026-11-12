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
      const bytes = fs.readFileSync(PdfGenerator.fontPath())
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

    const drawWrapped = (value: string, size: number, indent = 0): void => {
      const maxWidth = PAGE_WIDTH - MARGIN * 2 - indent
      for (const paragraph of text(value).split('\n')) {
        if (!paragraph.trim()) {
          y -= size * 0.6
          continue
        }
        for (const line of wrapText(paragraph, size, maxWidth, (t, s) => font.widthOfTextAtSize(t, s))) {
          ensureSpace(size + 4)
          page.drawText(line, { x: MARGIN + indent, y, size, font, color: rgb(0.15, 0.15, 0.17) })
          y -= LINE_HEIGHT
        }
      }
    }

    const drawImage = async (relativePath: string): Promise<void> => {
      const filePath = path.join(outputDir, relativePath.split('/').join(path.sep))
      if (!fs.existsSync(filePath)) return
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

      y -= 6
      if (i > 0 && i % YIELD_EVERY === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    const bytes = await doc.save()
    const filePath = path.join(outputDir, 'export.pdf')
    fs.writeFileSync(filePath, bytes)
    return filePath
  }
}
