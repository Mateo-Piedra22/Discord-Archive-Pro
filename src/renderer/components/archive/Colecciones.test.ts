import { describe, expect, it } from 'vitest'
import type { ArchiveFileEntry } from '../../../shared/api'
import {
  EXT_AUDIO,
  EXT_VIDEO,
  detectarColecciones,
  etiquetaCanal,
  formatearBytes,
  normalizar,
  textoFecha
} from './Colecciones'

function archivo(name: string, path: string, size = 100): ArchiveFileEntry {
  return { name, path, type: 'file', size }
}

function carpeta(name: string, path: string, children: ArchiveFileEntry[] = []): ArchiveFileEntry {
  return { name, path, type: 'dir', children }
}

describe('Colecciones helpers', () => {
  it('normalizar elimina acentos, diacríticos y convierte a minúsculas', () => {
    expect(normalizar('Diseño Gráfico Ágil')).toBe('diseno grafico agil')
    expect(normalizar('CRÈME BRÛLÉE Ñandú')).toBe('creme brulee nandu')
    expect(normalizar('')).toBe('')
  })

  it('formatearBytes formatea B, KB, MB y GB correctamente', () => {
    expect(formatearBytes(0)).toBe('0 B')
    expect(formatearBytes(512)).toBe('512 B')
    expect(formatearBytes(1024)).toBe('1 KB')
    expect(formatearBytes(1536)).toBe('2 KB')
    expect(formatearBytes(1048576)).toBe('1.0 MB')
    expect(formatearBytes(2.5 * 1048576)).toBe('2.5 MB')
    expect(formatearBytes(1073741824)).toBe('1.0 GB')
  })

  it('textoFecha devuelve "Sin fecha" para <= 0 y formatea marcas de tiempo válidas', () => {
    expect(textoFecha(0)).toBe('Sin fecha')
    expect(textoFecha(-500)).toBe('Sin fecha')

    const ms = new Date(2026, 2, 15).getTime()
    const formateado = textoFecha(ms)
    expect(formateado).not.toBe('Sin fecha')
    expect(formateado).toContain('15')
    expect(formateado).toContain('2026')
  })

  it('etiquetaCanal antepone # salvo para carpetas mensuales YYYY-MM y cadenas vacías', () => {
    expect(etiquetaCanal('')).toBe('')
    expect(etiquetaCanal('2026-03')).toBe('2026-03')
    expect(etiquetaCanal('general')).toBe('#general')
    expect(etiquetaCanal('foro-guias')).toBe('#foro-guias')
  })
})

describe('detectarColecciones', () => {
  it('detecta colecciones Markdown y calcula metadatos, portada, respuestas y orden', () => {
    const raiz = '/archivo'
    const arbol: ArchiveFileEntry[] = [
      carpeta('MiServidor', '/archivo/MiServidor', [
        carpeta('foro-ayuda', '/archivo/MiServidor/foro-ayuda', [
          carpeta('001_2026-01-10_Guia_inicial', '/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial', [
            archivo('thread.md', '/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial/thread.md', 400),
            archivo('index.md', '/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial/index.md', 200),
            archivo('portada-suelta.png', '/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial/portada-suelta.png', 1000),
            carpeta('assets', '/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial/assets', [
              archivo('captura.webp', '/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial/assets/captura.webp', 2400)
            ]),
            carpeta('replies', '/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial/replies', [
              archivo('001_ana.md', '/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial/replies/001_ana.md', 150),
              archivo('002_luis.md', '/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial/replies/002_luis.md', 250)
            ])
          ]),
          carpeta('002_2026-04-02_Novedades', '/archivo/MiServidor/foro-ayuda/002_2026-04-02_Novedades', [
            archivo('post.md', '/archivo/MiServidor/foro-ayuda/002_2026-04-02_Novedades/post.md', 500),
            archivo('thread.md', '/archivo/MiServidor/foro-ayuda/002_2026-04-02_Novedades/thread.md', 800)
          ])
        ])
      ])
    ]

    const resultado = detectarColecciones(arbol, raiz)
    expect(resultado).toHaveLength(2)

    // Ordenado de más reciente a más antigua.
    expect(resultado[0].titulo).toBe('Novedades')
    expect(resultado[0].principal?.name).toBe('post.md')
    expect(resultado[0].documentos).toBe(2)
    expect(resultado[0].mensajes).toBe(1)

    const antigua = resultado[1]
    expect(antigua.titulo).toBe('Guia inicial')
    expect(antigua.servidor).toBe('MiServidor')
    expect(antigua.canal).toBe('foro-ayuda')
    expect(antigua.principal?.name).toBe('thread.md')
    expect(antigua.documentos).toBe(2)
    expect(antigua.mensajes).toBe(3)
    expect(antigua.respuestasArchivos.map((r) => r.name)).toEqual(['001_ana.md', '002_luis.md'])
    expect(antigua.imagenes).toHaveLength(2)
    expect(antigua.bytes).toBe(4400)
    expect(antigua.portada).toBe('/archivo/MiServidor/foro-ayuda/001_2026-01-10_Guia_inicial/assets/captura.webp')
    expect(antigua.fecha).toBe(new Date(2026, 0, 10).getTime())
  })

  it('ordena numéricamente respuestasArchivos dentro de replies/ e ignora archivos no .md', () => {
    const raiz = '/archivo'
    const arbol: ArchiveFileEntry[] = [
      carpeta('Srv', '/archivo/Srv', [
        carpeta('foro', '/archivo/Srv/foro', [
          carpeta('001_2026-06-01_ConRespuestas', '/archivo/Srv/foro/001_2026-06-01_ConRespuestas', [
            archivo('post.md', '/archivo/Srv/foro/001_2026-06-01_ConRespuestas/post.md', 300),
            carpeta('replies', '/archivo/Srv/foro/001_2026-06-01_ConRespuestas/replies', [
              archivo('010_diez.md', '/archivo/Srv/foro/001_2026-06-01_ConRespuestas/replies/010_diez.md', 120),
              archivo('002_dos.md', '/archivo/Srv/foro/001_2026-06-01_ConRespuestas/replies/002_dos.md', 110),
              archivo('nota.txt', '/archivo/Srv/foro/001_2026-06-01_ConRespuestas/replies/nota.txt', 40),
              archivo('001_uno.md', '/archivo/Srv/foro/001_2026-06-01_ConRespuestas/replies/001_uno.md', 100),
              archivo('20_veinte.md', '/archivo/Srv/foro/001_2026-06-01_ConRespuestas/replies/20_veinte.md', 130)
            ])
          ])
        ])
      ])
    ]

    const resultado = detectarColecciones(arbol, raiz)
    expect(resultado).toHaveLength(1)
    expect(resultado[0].respuestasArchivos.map((r) => r.name)).toEqual([
      '001_uno.md',
      '002_dos.md',
      '010_diez.md',
      '20_veinte.md'
    ])
    expect(resultado[0].mensajes).toBe(5)
  })

  it('detecta colecciones solo con post.html, post.json, post.csv, export.pdf o export.epub', () => {
    const raiz = '/archivo'
    const formatos = ['post.html', 'post.json', 'post.csv', 'export.pdf', 'export.epub'] as const

    const carpetas = formatos.map((nombreArchivo, idx) =>
      carpeta(`00${idx + 1}_2026-02-0${idx + 1}_Solo_${idx}`, `/archivo/Srv/canal/00${idx + 1}_2026-02-0${idx + 1}_Solo_${idx}`, [
        archivo(nombreArchivo, `/archivo/Srv/canal/00${idx + 1}_2026-02-0${idx + 1}_Solo_${idx}/${nombreArchivo}`, 320)
      ])
    )

    const arbol = [carpeta('Srv', '/archivo/Srv', [carpeta('canal', '/archivo/Srv/canal', carpetas)])]
    const resultado = detectarColecciones(arbol, raiz)

    expect(resultado).toHaveLength(5)
    // Ordenado de más nueva (2026-02-05 -> export.epub) a más vieja (2026-02-01 -> post.html)
    expect(resultado.map((c) => c.principal?.name)).toEqual([
      'export.epub',
      'export.pdf',
      'post.csv',
      'post.json',
      'post.html'
    ])
    for (const c of resultado) {
      expect(c.documentos).toBe(1)
      expect(c.mensajes).toBe(1)
      expect(c.servidor).toBe('Srv')
      expect(c.canal).toBe('canal')
    }
  })

  it('respeta la prioridad de ORDEN_DOCUMENTO, ignora mayúsculas y omite carpetas sin marcas', () => {
    const raiz = 'C:\\Archivo'
    const arbol: ArchiveFileEntry[] = [
      carpeta('2026-03', 'C:\\Archivo\\2026-03', [
        carpeta('001_15-03-2026_Solo_HTML_Mayus', 'C:\\Archivo\\2026-03\\001_15-03-2026_Solo_HTML_Mayus', [
          archivo('POST.HTML', 'C:\\Archivo\\2026-03\\001_15-03-2026_Solo_HTML_Mayus\\POST.HTML', 600),
          archivo('export.pdf', 'C:\\Archivo\\2026-03\\001_15-03-2026_Solo_HTML_Mayus\\export.pdf', 900)
        ]),
        carpeta('002_20260320_Mixta', 'C:\\Archivo\\2026-03\\002_20260320_Mixta', [
          archivo('export.epub', 'C:\\Archivo\\2026-03\\002_20260320_Mixta\\export.epub', 1200),
          archivo('post.json', 'C:\\Archivo\\2026-03\\002_20260320_Mixta\\post.json', 500),
          archivo('index.md', 'C:\\Archivo\\2026-03\\002_20260320_Mixta\\index.md', 300)
        ]),
        carpeta('carpeta_vacia_sin_marca', 'C:\\Archivo\\2026-03\\carpeta_vacia_sin_marca', [
          archivo('notas.txt', 'C:\\Archivo\\2026-03\\carpeta_vacia_sin_marca\\notas.txt', 50),
          archivo('foto.png', 'C:\\Archivo\\2026-03\\carpeta_vacia_sin_marca\\foto.png', 120)
        ])
      ])
    ]

    const resultado = detectarColecciones(arbol, raiz)
    expect(resultado).toHaveLength(2)

    expect(resultado[0].titulo).toBe('Mixta')
    expect(resultado[0].principal?.name).toBe('index.md')
    expect(resultado[0].canal).toBe('2026-03')
    expect(resultado[0].servidor).toBe('')
    expect(resultado[0].fecha).toBe(new Date(2026, 2, 20).getTime())

    expect(resultado[1].titulo).toBe('Solo HTML Mayus')
    expect(resultado[1].principal?.name).toBe('POST.HTML')
    expect(resultado[1].documentos).toBe(2)
    expect(resultado[1].fecha).toBe(new Date(2026, 2, 15).getTime())
  })

  it('desempata alfabéticamente colecciones sin fecha y usa la primera imagen si no hay assets/', () => {
    const raiz = '/archivo'
    const arbol: ArchiveFileEntry[] = [
      carpeta('Zeta', '/archivo/Zeta', [
        archivo('post.json', '/archivo/Zeta/post.json', 100),
        archivo('foto.jpg', '/archivo/Zeta/foto.jpg', 200)
      ]),
      carpeta('Árbol', '/archivo/Árbol', [
        archivo('post.csv', '/archivo/Árbol/post.csv', 100)
      ])
    ]

    const resultado = detectarColecciones(arbol, raiz)
    expect(resultado.map((c) => c.titulo)).toEqual(['Árbol', 'Zeta'])
    expect(resultado[0].fecha).toBe(0)
    expect(resultado[0].portada).toBeNull()
    expect(resultado[1].portada).toBe('/archivo/Zeta/foto.jpg')
  })

  it('detecta messages.csv, ordena formatos según ORDEN_DOCUMENTO y recopila multimedia recursiva', () => {
    expect(EXT_VIDEO).toEqual(['mp4', 'webm', 'mov', 'mkv', 'ogv'])
    expect(EXT_AUDIO).toEqual(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'])

    const raiz = '/archivo'
    const arbol: ArchiveFileEntry[] = [
      carpeta('Srv', '/archivo/Srv', [
        carpeta('foro', '/archivo/Srv/foro', [
          carpeta('001_2026-05-01_SoloMessagesCsv', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv', [
            archivo('messages.csv', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv/messages.csv', 420),
            carpeta('assets', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv/assets', [
              carpeta('videos', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv/assets/videos', [
                archivo('demo.mp4', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv/assets/videos/demo.mp4', 1024),
                archivo('clip.WEBM', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv/assets/videos/clip.WEBM', 512)
              ]),
              carpeta('files', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv/assets/files', [
                archivo('nota.ogg', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv/assets/files/nota.ogg', 300),
                archivo('pista.m4a', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv/assets/files/pista.m4a', 250),
                archivo('readme.txt', '/archivo/Srv/foro/001_2026-05-01_SoloMessagesCsv/assets/files/readme.txt', 50)
              ])
            ])
          ]),
          carpeta('002_2026-05-02_MultiFormato', '/archivo/Srv/foro/002_2026-05-02_MultiFormato', [
            archivo('export.epub', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/export.epub', 900),
            archivo('messages.csv', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/messages.csv', 300),
            archivo('post.html', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/post.html', 400),
            archivo('post.md', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/post.md', 500),
            archivo('post.csv', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/post.csv', 300),
            archivo('post.json', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/post.json', 700),
            archivo('export.pdf', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/export.pdf', 800),
            archivo('banner.png', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/banner.png', 200),
            carpeta('sub', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/sub', [
              // Un post.md en subcarpeta NO debe entrar en `formatos` de la raíz.
              archivo('post.md', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/sub/post.md', 100),
              archivo('audio.flac', '/archivo/Srv/foro/002_2026-05-02_MultiFormato/sub/audio.flac', 600)
            ])
          ])
        ])
      ])
    ]

    const resultado = detectarColecciones(arbol, raiz)
    expect(resultado).toHaveLength(3)

    const multi = resultado.find((c) => c.titulo === 'MultiFormato')!
    expect(multi).toBeDefined()
    expect(multi.principal?.name).toBe('post.md')
    expect(multi.formatos.every((f) => !f.path.includes('/sub/'))).toBe(true)
    expect(multi.formatos.map((f) => f.name)).toEqual([
      'post.md',
      'post.html',
      'post.json',
      'post.csv',
      'messages.csv',
      'export.pdf',
      'export.epub'
    ])
    expect(multi.imagenes.map((i) => i.name)).toEqual(['banner.png'])
    expect(multi.multimedia.map((m) => m.name)).toEqual(['banner.png', 'audio.flac'])

    const soloCsv = resultado.find((c) => c.titulo === 'SoloMessagesCsv')!
    expect(soloCsv).toBeDefined()
    expect(soloCsv.titulo).toBe('SoloMessagesCsv')
    expect(soloCsv.principal?.name).toBe('messages.csv')
    expect(soloCsv.formatos.map((f) => f.name)).toEqual(['messages.csv'])
    expect(soloCsv.imagenes).toHaveLength(0)
    expect(soloCsv.multimedia.map((m) => m.name)).toEqual([
      'demo.mp4',
      'clip.WEBM',
      'nota.ogg',
      'pista.m4a'
    ])
  })
})
