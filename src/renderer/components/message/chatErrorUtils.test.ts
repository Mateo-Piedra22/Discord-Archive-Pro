import { describe, expect, it } from 'vitest'
import { MessageType } from '../../../core/discord/types'
import type { DiscordMessage } from '../../../core/discord/types'
import {
  esErrorLimiteDiscord,
  filtrarMensajesEnVivo,
  formatearTranscripcionMarkdown,
  mensajeDeErrorDiscord,
  resumirEstadisticasChat
} from './chatErrorUtils'

function crearMensaje(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: overrides.id ?? '1',
    channel_id: overrides.channel_id ?? '100',
    author: overrides.author ?? {
      id: 'u1',
      username: 'usuario',
      discriminator: '0',
      global_name: 'Usuario Demo',
      avatar: null
    },
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? '2026-03-10T14:25:00.000Z',
    edited_timestamp: overrides.edited_timestamp ?? null,
    attachments: overrides.attachments ?? [],
    embeds: overrides.embeds ?? [],
    pinned: overrides.pinned ?? false,
    type: overrides.type ?? MessageType.DEFAULT,
    referenced_message: overrides.referenced_message,
    reactions: overrides.reactions
  }
}

describe('esErrorLimiteDiscord', () => {
  it('detecta errores 429 o rate limited sin distinguir mayúsculas', () => {
    expect(esErrorLimiteDiscord(new Error('DiscordApiError: 429 Too Many Requests'))).toBe(true)
    expect(esErrorLimiteDiscord(new Error('You are being RATE LIMITED'))).toBe(true)
    expect(esErrorLimiteDiscord('HTTP 429')).toBe(true)
  })

  it('devuelve false para otros errores', () => {
    expect(esErrorLimiteDiscord(new Error('403 Forbidden'))).toBe(false)
    expect(esErrorLimiteDiscord(new Error('Network timeout'))).toBe(false)
    expect(esErrorLimiteDiscord(null)).toBe(false)
  })
})

describe('mensajeDeErrorDiscord', () => {
  it('traduce errores 429/rate limit de manera uniforme para canal e hilo', () => {
    const esperado = 'Discord limitó las peticiones. Espera unos segundos y reinténtalo.'
    expect(mensajeDeErrorDiscord(new Error('429'), 'canal')).toBe(esperado)
    expect(mensajeDeErrorDiscord(new Error('rate limited'), 'hilo')).toBe(esperado)
  })

  it('adapta el texto de permiso 403 / access denied al contexto', () => {
    expect(mensajeDeErrorDiscord(new Error('403 Forbidden'), 'canal')).toBe(
      'Esta cuenta no tiene permiso para leer este canal.'
    )
    expect(mensajeDeErrorDiscord(new Error('Access Denied'), 'hilo')).toBe(
      'Esta cuenta no tiene permiso para leer este hilo.'
    )
  })

  it('traduce errores 401 / unauthorized', () => {
    const esperado = 'La sesión ya no es válida. Vuelve a conectar tu cuenta en Ajustes.'
    expect(mensajeDeErrorDiscord(new Error('401 Unauthorized'), 'canal')).toBe(esperado)
    expect(mensajeDeErrorDiscord('unauthorized', 'hilo')).toBe(esperado)
  })

  it('adapta errores 404 / unknown channel o message al contexto', () => {
    expect(mensajeDeErrorDiscord(new Error('404 Not Found'), 'canal')).toBe(
      'Este canal ya no existe o fue borrado.'
    )
    expect(mensajeDeErrorDiscord(new Error('Unknown Channel'), 'hilo')).toBe(
      'Este hilo ya no existe o fue borrado.'
    )
    expect(mensajeDeErrorDiscord(new Error('Unknown Message'), 'hilo')).toBe(
      'Este hilo ya no existe o fue borrado.'
    )
  })

  it('devuelve un mensaje genérico contextualizado ante errores desconocidos', () => {
    expect(mensajeDeErrorDiscord(new Error('ECONNRESET'), 'canal')).toBe(
      'No se pudo cargar el canal. Revisa la conexión e inténtalo de nuevo.'
    )
    expect(mensajeDeErrorDiscord('Fallo inesperado', 'hilo')).toBe(
      'No se pudo cargar el hilo. Revisa la conexión e inténtalo de nuevo.'
    )
  })
})

describe('filtrarMensajesEnVivo', () => {
  const mensajes: DiscordMessage[] = [
    crearMensaje({
      id: 'm1',
      author: { id: 'u1', username: 'ana_dev', discriminator: '0', global_name: 'Sofía Álvarez', avatar: null },
      content: 'Revisión del diseño gráfico inicial',
      attachments: [
        {
          id: 'a1',
          filename: 'boceto-final.png',
          size: 1200,
          url: 'https://cdn.discordapp.com/1/boceto-final.png',
          proxy_url: 'https://media.discordapp.net/1/boceto-final.png'
        }
      ]
    }),
    crearMensaje({
      id: 'm2',
      author: { id: 'u2', username: 'carlos_m', discriminator: '0', global_name: null, avatar: null },
      content: 'Mira la documentación en https://estrato.app/guia',
      embeds: []
    }),
    crearMensaje({
      id: 'm3',
      author: { id: 'u3', username: 'lucia', discriminator: '0', global_name: 'Lucía Pérez', avatar: null },
      content: 'Comparto enlace con adjunto',
      attachments: [
        {
          id: 'a2',
          filename: 'especificación-técnica.pdf',
          size: 4500,
          url: 'https://cdn.discordapp.com/2/espec.pdf',
          proxy_url: 'https://media.discordapp.net/2/espec.pdf'
        }
      ],
      embeds: [
        {
          title: 'Referencia técnica',
          url: 'https://docs.ejemplo.org/spec'
        }
      ]
    }),
    crearMensaje({
      id: 'm4',
      author: { id: 'u4', username: 'mateo', discriminator: '0', global_name: 'Mateo', avatar: null },
      content: 'Solo un saludo sin adjuntos ni enlaces',
      embeds: [
        {
          title: 'Tarjeta sin URL',
          description: 'Texto descriptivo plano'
        }
      ]
    })
  ]

  it('devuelve todos los mensajes cuando no hay filtros activos', () => {
    const res = filtrarMensajesEnVivo(mensajes, {
      consulta: '   ',
      soloAdjuntos: false,
      soloEnlaces: false
    })
    expect(res).toHaveLength(4)
    expect(res.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('filtra por contenido sin distinguir tildes ni mayúsculas', () => {
    const res = filtrarMensajesEnVivo(mensajes, {
      consulta: 'DISENO GRAFICO',
      soloAdjuntos: false,
      soloEnlaces: false
    })
    expect(res.map((m) => m.id)).toEqual(['m1'])
  })

  it('filtra por author.global_name, author.username y attachments[].filename', () => {
    expect(
      filtrarMensajesEnVivo(mensajes, {
        consulta: 'sofia alvarez',
        soloAdjuntos: false,
        soloEnlaces: false
      }).map((m) => m.id)
    ).toEqual(['m1'])

    expect(
      filtrarMensajesEnVivo(mensajes, {
        consulta: 'carlos_m',
        soloAdjuntos: false,
        soloEnlaces: false
      }).map((m) => m.id)
    ).toEqual(['m2'])

    expect(
      filtrarMensajesEnVivo(mensajes, {
        consulta: 'especificacion-tecnica',
        soloAdjuntos: false,
        soloEnlaces: false
      }).map((m) => m.id)
    ).toEqual(['m3'])
  })

  it('filtra por soloAdjuntos exigiendo attachments.length > 0', () => {
    const res = filtrarMensajesEnVivo(mensajes, {
      consulta: '',
      soloAdjuntos: true,
      soloEnlaces: false
    })
    expect(res.map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('filtra por soloEnlaces detectando URLs http/https en contenido o embeds', () => {
    const res = filtrarMensajesEnVivo(mensajes, {
      consulta: '',
      soloAdjuntos: false,
      soloEnlaces: true
    })
    expect(res.map((m) => m.id)).toEqual(['m2', 'm3'])
  })

  it('detecta enlaces en descripción o campos de embeds', () => {
    const conEmbedCampo = crearMensaje({
      id: 'm5',
      content: 'Sin link directo',
      embeds: [
        {
          fields: [{ name: 'Repositorio', value: 'Ver en http://localhost:3000/repo' }]
        }
      ]
    })
    const res = filtrarMensajesEnVivo([conEmbedCampo], {
      consulta: '',
      soloAdjuntos: false,
      soloEnlaces: true
    })
    expect(res).toHaveLength(1)
  })

  it('combina consulta, soloAdjuntos y soloEnlaces simultáneamente', () => {
    const res = filtrarMensajesEnVivo(mensajes, {
      consulta: 'lucia',
      soloAdjuntos: true,
      soloEnlaces: true
    })
    expect(res.map((m) => m.id)).toEqual(['m3'])

    const vacio = filtrarMensajesEnVivo(mensajes, {
      consulta: 'sofia',
      soloAdjuntos: true,
      soloEnlaces: true
    })
    expect(vacio).toHaveLength(0)
  })

  it('filtra por soloFijados exigiendo message.pinned === true', () => {
    const listaConFijados: DiscordMessage[] = [
      crearMensaje({ id: 'p1', content: 'Normal', pinned: false }),
      crearMensaje({ id: 'p2', content: 'Anuncio fijado', pinned: true }),
      crearMensaje({ id: 'p3', content: 'Reglas fijadas', pinned: true })
    ]

    const res = filtrarMensajesEnVivo(listaConFijados, {
      consulta: '',
      soloAdjuntos: false,
      soloEnlaces: false,
      soloFijados: true
    })
    expect(res.map((m) => m.id)).toEqual(['p2', 'p3'])
  })

  it('soporta operadores from:<autor> y de:<autor> combinados con texto libre', () => {
    const lista = [
      ...mensajes,
      crearMensaje({
        id: 'm5',
        author: { id: 'u2', username: 'carlos_m', discriminator: '0', global_name: null, avatar: null },
        content: 'Mensaje mencionando a Sofía Álvarez en el cuerpo'
      })
    ]

    // Filtra por global_name sin tildes ni mayúsculas y excluye menciones en el texto
    expect(
      filtrarMensajesEnVivo(lista, {
        consulta: 'de:SOFIA',
        soloAdjuntos: false,
        soloEnlaces: false
      }).map((m) => m.id)
    ).toEqual(['m1'])

    // Filtra por username y texto libre restante
    expect(
      filtrarMensajesEnVivo(lista, {
        consulta: 'from:carlos_m documentacion',
        soloAdjuntos: false,
        soloEnlaces: false
      }).map((m) => m.id)
    ).toEqual(['m2'])

    // Soporta autor entre comillas
    expect(
      filtrarMensajesEnVivo(lista, {
        consulta: 'de:"Lucia Perez" enlace',
        soloAdjuntos: false,
        soloEnlaces: false
      }).map((m) => m.id)
    ).toEqual(['m3'])
  })

  it('soporta operadores has:embed, has:pinned y pinned:true', () => {
    const lista: DiscordMessage[] = [
      ...mensajes,
      crearMensaje({
        id: 'm5',
        author: { id: 'u3', username: 'lucia', discriminator: '0', global_name: 'Lucía Pérez', avatar: null },
        content: 'Aviso fijado con embed',
        pinned: true,
        embeds: [{ title: 'Resumen' }]
      })
    ]

    expect(
      filtrarMensajesEnVivo(lista, {
        consulta: 'has:embed',
        soloAdjuntos: false,
        soloEnlaces: false
      }).map((m) => m.id)
    ).toEqual(['m3', 'm4', 'm5'])

    expect(
      filtrarMensajesEnVivo(lista, {
        consulta: 'has:pinned',
        soloAdjuntos: false,
        soloEnlaces: false
      }).map((m) => m.id)
    ).toEqual(['m5'])

    expect(
      filtrarMensajesEnVivo(lista, {
        consulta: 'from:lucia pinned:true has:embed aviso',
        soloAdjuntos: false,
        soloEnlaces: false
      }).map((m) => m.id)
    ).toEqual(['m5'])
  })

  it('mantiene compatibilidad de 3 propiedades en OpcionesFiltroEnVivo y distingue has:embed de soloEnlaces', () => {
    const sinUrl = filtrarMensajesEnVivo(mensajes, {
      consulta: 'has:embed',
      soloAdjuntos: false,
      soloEnlaces: false
    })
    expect(sinUrl.map((m) => m.id)).toEqual(['m3', 'm4'])

    const conUrl = filtrarMensajesEnVivo(mensajes, {
      consulta: 'has:embed',
      soloAdjuntos: false,
      soloEnlaces: true
    })
    expect(conUrl.map((m) => m.id)).toEqual(['m3'])
  })
})

describe('resumirEstadisticasChat', () => {
  it('calcula total, autores únicos, adjuntos, enlaces y fijados en una sola pasada', () => {
    const lista: DiscordMessage[] = [
      crearMensaje({
        id: '1',
        author: { id: 'u1', username: 'ana', discriminator: '0', global_name: 'Ana', avatar: null },
        content: 'Mira https://estrato.app',
        pinned: true,
        attachments: [
          {
            id: 'a1',
            filename: 'uno.png',
            size: 100,
            url: 'https://cdn.discordapp.com/1.png',
            proxy_url: 'https://media.discordapp.net/1.png'
          },
          {
            id: 'a2',
            filename: 'dos.png',
            size: 200,
            url: 'https://cdn.discordapp.com/2.png',
            proxy_url: 'https://media.discordapp.net/2.png'
          }
        ]
      }),
      crearMensaje({
        id: '2',
        author: { id: 'u1', username: 'ana', discriminator: '0', global_name: 'Ana', avatar: null },
        content: 'Segundo mensaje de Ana sin enlace',
        pinned: false,
        attachments: []
      }),
      crearMensaje({
        id: '3',
        author: { id: 'u2', username: 'luis', discriminator: '0', global_name: null, avatar: null },
        content: 'Embed con enlace',
        pinned: true,
        embeds: [{ title: 'Doc', url: 'https://docs.estrato.app' }],
        attachments: [
          {
            id: 'a3',
            filename: 'tres.pdf',
            size: 500,
            url: 'https://cdn.discordapp.com/3.pdf',
            proxy_url: 'https://media.discordapp.net/3.pdf'
          }
        ]
      })
    ]

    expect(resumirEstadisticasChat(lista)).toEqual({
      total: 3,
      autores: 2,
      adjuntos: 3,
      enlaces: 2,
      fijados: 2
    })
  })

  it('devuelve ceros para una lista vacía', () => {
    expect(resumirEstadisticasChat([])).toEqual({
      total: 0,
      autores: 0,
      adjuntos: 0,
      enlaces: 0,
      fijados: 0
    })
  })
})

describe('formatearTranscripcionMarkdown', () => {
  it('genera encabezado, fecha legible, autor, contenido y listado de adjuntos', () => {
    const lista: DiscordMessage[] = [
      crearMensaje({
        id: '1',
        author: { id: 'u1', username: 'ana', discriminator: '0', global_name: 'Ana', avatar: null },
        timestamp: '2026-03-10T14:25:00.000Z',
        content: 'Primer mensaje con **negrita**.',
        attachments: [
          {
            id: 'a1',
            filename: 'diagrama.png',
            size: 1024,
            url: 'https://cdn.discordapp.com/diagrama.png',
            proxy_url: 'https://media.discordapp.net/diagrama.png'
          }
        ]
      }),
      crearMensaje({
        id: '2',
        author: { id: 'u2', username: 'luis_dev', discriminator: '0', global_name: null, avatar: null },
        timestamp: '2026-03-10T15:02:00.000Z',
        content: '',
        attachments: []
      })
    ]

    const md = formatearTranscripcionMarkdown('#general', lista)

    expect(md.startsWith('# #general\n')).toBe(true)
    expect(md).toContain('### Ana · 2026-03-10 14:25 UTC')
    expect(md).toContain('Primer mensaje con **negrita**.')
    expect(md).toContain('- [diagrama.png](https://cdn.discordapp.com/diagrama.png)')
    expect(md).toContain('### luis_dev · 2026-03-10 15:02 UTC')
    expect(md).toContain('_Sin contenido de texto_')
  })

  it('incluye indicadores de fijado, editado, mensaje citado y reacciones', () => {
    const original = crearMensaje({
      id: '10',
      author: { id: 'u2', username: 'carlos', discriminator: '0', global_name: 'Carlos', avatar: null },
      content: '¿Cuándo publicamos la versión final?'
    })

    const respuesta = crearMensaje({
      id: '11',
      author: { id: 'u1', username: 'ana', discriminator: '0', global_name: 'Ana', avatar: null },
      timestamp: '2026-03-10T16:10:00.000Z',
      edited_timestamp: '2026-03-10T16:12:00.000Z',
      pinned: true,
      content: 'Sale mañana mismo.',
      referenced_message: original,
      reactions: [
        { count: 4, emoji: { id: null, name: '🚀' } },
        { count: 2, emoji: { id: '9001', name: 'estrato', animated: false } }
      ]
    })

    const md = formatearTranscripcionMarkdown('Anuncios', [respuesta])

    expect(md).toContain('### 📌 Ana · 2026-03-10 16:10 UTC *(editado)*')
    expect(md).toContain('> ↳ Respondiendo a **Carlos**: ¿Cuándo publicamos la versión final?')
    expect(md).toContain('Sale mañana mismo.')
    expect(md).toContain('Reacciones: 🚀 4 · :estrato: 2')
  })

  it('maneja una lista vacía de mensajes manteniendo el título', () => {
    const md = formatearTranscripcionMarkdown('Hilo vacío', [])
    expect(md).toBe('# Hilo vacío\n\n_Sin mensajes._')
  })
})
