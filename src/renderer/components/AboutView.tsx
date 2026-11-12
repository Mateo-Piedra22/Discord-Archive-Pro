// AboutView.tsx — Vista legal de producto de Estrato.
// Siete secciones navegables con estado local: resumen, licencia de uso,
// licencias de terceros, privacidad, permisos, términos de Discord y
// soporte. Cada afirmación se corresponde con el código de la aplicación.

import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  BookOpen,
  CircleCheck,
  Database,
  HardDrive,
  KeyRound,
  LifeBuoy,
  Lock,
  MessagesSquare,
  Package,
  Scale,
  ShieldCheck,
  TriangleAlert
} from 'lucide-react'

/** Versión del producto inyectada por Vite desde package.json. */
const VERSION = __APP_VERSION__

/** Año de la primera publicación, usado en los avisos de titularidad. */
const ANIO = 2026

// ============================================================
// Navegación
// ============================================================

type SeccionId =
  | 'resumen'
  | 'licencia'
  | 'terceros'
  | 'privacidad'
  | 'permisos'
  | 'discord'
  | 'contacto'

interface EntradaNav {
  id: SeccionId
  nombre: string
  numero: string
  icono: typeof BookOpen
}

const SECCIONES: EntradaNav[] = [
  { id: 'resumen', nombre: 'Resumen', numero: '01', icono: BookOpen },
  { id: 'licencia', nombre: 'Licencia de uso', numero: '02', icono: Scale },
  { id: 'terceros', nombre: 'Licencias de terceros', numero: '03', icono: Package },
  { id: 'privacidad', nombre: 'Privacidad y datos', numero: '04', icono: Lock },
  { id: 'permisos', nombre: 'Permisos y seguridad', numero: '05', icono: ShieldCheck },
  { id: 'discord', nombre: 'Términos de Discord', numero: '06', icono: MessagesSquare },
  { id: 'contacto', nombre: 'Contacto y soporte', numero: '07', icono: LifeBuoy }
]

// ============================================================
// Piezas de composición
// ============================================================

/** Párrafo de cuerpo con la medida de lectura del resto de la vista. */
function Parrafo({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 'var(--text-md)', lineHeight: 1.7, color: 'var(--fg-2)', maxWidth: '72ch' }}>
      {children}
    </p>
  )
}

/** Entradilla editorial: serif y un punto más grande que el cuerpo. */
function Entradilla({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-lg)',
        lineHeight: 1.5,
        color: 'var(--fg)',
        letterSpacing: '-0.01em',
        maxWidth: '48ch'
      }}
    >
      {children}
    </p>
  )
}

/** Lista de puntos con marca de acento. */
function Lista({ children }: { children: ReactNode }) {
  return (
    <ul className="col" style={{ gap: 'var(--sp-2)' }}>
      {children}
    </ul>
  )
}

function Punto({ children }: { children: ReactNode }) {
  return (
    <li className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
      <span
        aria-hidden="true"
        style={{
          width: 4,
          height: 4,
          marginTop: 9,
          flexShrink: 0,
          borderRadius: 'var(--r-full)',
          background: 'var(--accent)'
        }}
      />
      <span style={{ fontSize: 'var(--text-md)', lineHeight: 1.65, color: 'var(--fg-2)' }}>{children}</span>
    </li>
  )
}

/** Rótulo de bloque: versalitas discretas que ordenan el contenido. */
function Rotulo({ children }: { children: ReactNode }) {
  return <div className="section__title">{children}</div>
}

/** Fila etiqueta / valor con línea inferior tenue. */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div
      className="row"
      style={{
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--sp-4)',
        padding: '7px 0',
        borderBottom: '1px solid var(--line-soft)'
      }}
    >
      <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        {etiqueta}
      </span>
      <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-2)', textAlign: 'right' }}>
        {valor}
      </span>
    </div>
  )
}

/** Cifra grande con su leyenda: la retícula de garantías del resumen. */
function Garantia({ cifra, texto }: { cifra: string; texto: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 'var(--sp-3) var(--sp-4)',
        border: '1px solid var(--line-soft)',
        borderRadius: 'var(--r-md)',
        background: 'var(--surface-1)'
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-xl)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          color: 'var(--fg)',
          lineHeight: 1.15
        }}
      >
        {cifra}
      </span>
      <span className="dim" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.4 }}>
        {texto}
      </span>
    </div>
  )
}

/** Fila de verificación: hecho comprobado con su sello «activo». */
function Verificacion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div
      className="row"
      style={{
        alignItems: 'flex-start',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-3) 0',
        borderBottom: '1px solid var(--line-soft)'
      }}
    >
      <CircleCheck
        size={15}
        strokeWidth={1.8}
        style={{ color: 'var(--ok)', flexShrink: 0, marginTop: 2 }}
        aria-hidden="true"
      />
      <div className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-md)', color: 'var(--fg)' }}>{titulo}</span>
          <span className="badge badge--ok">Activo</span>
        </div>
        <span className="dim" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.55 }}>
          {children}
        </span>
      </div>
    </div>
  )
}

/** Tarjeta contenedora de una sección con cabecera propia. */
function Bloque({
  icono: Icono,
  titulo,
  meta,
  children
}: {
  icono: typeof BookOpen
  titulo: string
  meta?: string
  children: ReactNode
}) {
  return (
    <section className="card">
      <header className="card__header">
        <Icono size={16} strokeWidth={1.8} style={{ color: 'var(--accent)' }} aria-hidden="true" />
        <span
          className="card__title"
          style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', letterSpacing: '-0.01em' }}
        >
          {titulo}
        </span>
        <span className="spacer" />
        {meta && <span className="badge">{meta}</span>}
      </header>
      <div className="card__body col" style={{ gap: 'var(--sp-4)' }}>
        {children}
      </div>
    </section>
  )
}

// ============================================================
// 01 · Resumen
// ============================================================

function SeccionResumen() {
  return (
    <Bloque icono={BookOpen} titulo="Resumen" meta={`v${VERSION}`}>
      <Entradilla>
        Estrato archiva comunidades de Discord en tu propio disco: convierte hilos y canales en
        documentos que siguen siendo legibles dentro de veinte años.
      </Entradilla>

      <Parrafo>
        Es una aplicación de escritorio que funciona sin cuenta propia, sin servidor intermedio y sin
        ningún servicio en la nube. Se conecta a Discord con el token de tu cuenta, descarga lo que esa
        cuenta ya puede ver y lo escribe en la carpeta que elijas. No publica, no reacciona y no
        modifica nada en la plataforma.
      </Parrafo>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 'var(--sp-2)'
        }}
      >
        <Garantia cifra="0" texto="Servidores centrales. Nada pasa por infraestructura propia." />
        <Garantia cifra="0" texto="Telemetría, analítica o informe de errores a terceros." />
        <Garantia cifra="1" texto="Carpeta local: tus archivos, tu disco, tu copia de seguridad." />
        <Garantia cifra="Solo lectura" texto="Únicamente descarga lo que tu cuenta ya ve." />
      </div>

      <hr className="divider" />

      <div className="col" style={{ gap: 0 }}>
        <Dato etiqueta="Producto" valor="Estrato" />
        <Dato etiqueta="Versión" valor={VERSION} />
        <Dato etiqueta="Licencia del software" valor="Propietaria · uso personal" />
        <Dato etiqueta="Titular" valor={`Estrato, ${ANIO}`} />
        <Dato etiqueta="Plataforma" valor="Windows · Electron + React" />
      </div>

      <div
        className="row"
        style={{
          alignItems: 'flex-start',
          gap: 'var(--sp-3)',
          padding: 'var(--sp-3) var(--sp-4)',
          border: '1px solid var(--accent-line)',
          borderRadius: 'var(--r-md)',
          background: 'var(--accent-soft)'
        }}
      >
        <TriangleAlert
          size={15}
          strokeWidth={1.8}
          style={{ color: 'var(--accent-fg)', flexShrink: 0, marginTop: 2 }}
          aria-hidden="true"
        />
        <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, color: 'var(--fg-2)' }}>
          <strong style={{ color: 'var(--fg)' }}>Sin afiliación.</strong> Estrato es un proyecto
          independiente. No está afiliado, patrocinado ni respaldado por Discord Inc. «Discord» es una
          marca de Discord Inc. y se menciona aquí solo para describir la compatibilidad.
        </p>
      </div>
    </Bloque>
  )
}

// ============================================================
// 02 · Licencia de uso (EULA)
// ============================================================

function SeccionLicencia() {
  return (
    <Bloque icono={Scale} titulo="Licencia de uso" meta="EULA">
      <Parrafo>
        Estrato se entrega bajo una licencia propietaria: se te concede el derecho a usarlo, no la
        propiedad del programa. El texto completo, en español e inglés, acompaña al proyecto en el
        archivo <span className="mono">LICENSE</span>.
      </Parrafo>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Lo que puedes hacer</Rotulo>
        <Lista>
          <Punto>
            Instalar y usar la aplicación en tus propios equipos, para fines personales o de archivo
            interno.
          </Punto>
          <Punto>
            Conservar copias de seguridad del ejecutable y de la carpeta <span className="mono">data/</span>{' '}
            para no perder tu archivo.
          </Punto>
          <Punto>
            Usar el contenido exportado según lo que la ley y los autores de ese contenido permitan.
          </Punto>
        </Lista>
      </div>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Lo que no puedes hacer</Rotulo>
        <Lista>
          <Punto>
            Redistribuir, vender, alquilar o sublicenciar el programa, ni empaquetarlo dentro de otro
            producto.
          </Punto>
          <Punto>
            Retirar los avisos de titularidad, de versión o de licencia.
          </Punto>
          <Punto>
            Descompilar, desensamblar o intentar obtener el código fuente, salvo en la medida en que la
            ley aplicable lo permita expresamente pese a esta prohibición.
          </Punto>
          <Punto>
            Usar la aplicación para eludir límites de peticiones, automatizar cuentas ajenas o archivar
            contenido sin autorización de sus participantes.
          </Punto>
        </Lista>
      </div>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Titularidad del contenido archivado</Rotulo>
        <Parrafo>
          Los mensajes, imágenes y archivos que exportas siguen perteneciendo a quienes los escribieron
          y a las comunidades donde se publicaron. Esta licencia no te transfiere ningún derecho sobre
          ese contenido: solo regula el uso del programa. Eres responsable de tener base legal para
          conservar una copia.
        </Parrafo>
      </div>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Garantías y responsabilidad</Rotulo>
        <Parrafo>
          El programa se entrega «tal cual» y «según disponibilidad», sin garantía de ningún tipo,
          expresa o implícita, incluida la aptitud para un fin concreto o la ausencia de errores. En la
          medida máxima que permita la ley, el titular no responde por daños indirectos, pérdida de
          datos o lucro cesante derivados del uso de la aplicación. Si Discord cambia su API, algunas
          funciones pueden dejar de operar sin aviso.
        </Parrafo>
        <Parrafo>
          Esta licencia termina automáticamente si incumples sus términos. En ese caso debes dejar de
          usar el programa y destruir las copias que tengas.
        </Parrafo>
      </div>
    </Bloque>
  )
}

// ============================================================
// 03 · Licencias de terceros
// ============================================================

interface Componente {
  nombre: string
  version: string
  licencia: string
  uso: string
}

/**
 * Licencias leídas del campo `license` de cada paquete instalado
 * (node_modules/<paquete>/package.json). No se deduce ninguna.
 */
const COMPONENTES: Componente[] = [
  { nombre: '@pdf-lib/fontkit', version: '1.1.1', licencia: 'MIT', uso: 'Incrustar tipografías en los PDF exportados' },
  { nombre: 'better-sqlite3', version: '11.10.0', licencia: 'MIT', uso: 'Base local: caché, cola e historial' },
  { nombre: 'epub-gen-memory', version: '1.1.2', licencia: 'MIT', uso: 'Generar EPUB en memoria' },
  { nombre: 'epubjs', version: '0.3.93', licencia: 'BSD-2-Clause', uso: 'Lectura de EPUB en el visor' },
  { nombre: 'lucide-react', version: '1.8.0', licencia: 'ISC', uso: 'Iconografía de la interfaz' },
  { nombre: 'pdf-lib', version: '1.17.1', licencia: 'MIT', uso: 'Composición de documentos PDF' },
  { nombre: 'react-markdown', version: '10.1.0', licencia: 'MIT', uso: 'Renderizar el Markdown archivado' },
  { nombre: 'react-syntax-highlighter', version: '16.1.1', licencia: 'MIT', uso: 'Resaltado de bloques de código' },
  { nombre: 'rehype-raw', version: '7.0.0', licencia: 'MIT', uso: 'HTML incrustado dentro del Markdown' },
  { nombre: 'remark-gfm', version: '4.0.1', licencia: 'MIT', uso: 'Tablas, tachado y enlaces automáticos' },
  { nombre: 'sanitize-filename', version: '1.6.4', licencia: 'WTFPL OR ISC', uso: 'Nombres de archivo seguros al exportar' },
  { nombre: 'sharp', version: '0.34.5', licencia: 'Apache-2.0', uso: 'Redimensionar y convertir imágenes' },
  { nombre: 'zustand', version: '5.0.12', licencia: 'MIT', uso: 'Estado de la interfaz' },
  { nombre: 'Electron', version: '34.5.8', licencia: 'MIT', uso: 'Contenedor de escritorio (Chromium y Node)' },
  { nombre: 'React', version: '19.2.5', licencia: 'MIT', uso: 'Interfaz de usuario' },
  { nombre: 'React DOM', version: '19.2.5', licencia: 'MIT', uso: 'Render de React sobre el DOM' },
  { nombre: 'SQLite', version: '3.49.2', licencia: 'Public Domain', uso: 'Motor SQL embebido en better-sqlite3' }
]

function SeccionTerceros() {
  return (
    <Bloque icono={Package} titulo="Licencias de terceros" meta={`${COMPONENTES.length} componentes`}>
      <Parrafo>
        Estrato se apoya en software libre de terceros. Cada componente conserva su licencia original y
        su aviso de copyright; los textos completos viajan con el paquete instalado en{' '}
        <span className="mono">node_modules/&lt;paquete&gt;/LICENSE</span>. Esta tabla refleja lo que
        declara cada paquete en su propio <span className="mono">package.json</span>.
      </Parrafo>

      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Componente</th>
              <th style={{ width: 96 }}>Versión</th>
              <th style={{ width: 150 }}>Licencia</th>
              <th>Uso dentro de Estrato</th>
            </tr>
          </thead>
          <tbody>
            {COMPONENTES.map((c) => (
              <tr key={c.nombre}>
                <td style={{ color: 'var(--fg)', whiteSpace: 'nowrap' }}>{c.nombre}</td>
                <td className="mono" style={{ fontSize: 'var(--text-sm)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.version}
                </td>
                <td className="mono" style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
                  {c.licencia}
                </td>
                <td className="dim" style={{ fontSize: 'var(--text-sm)' }}>
                  {c.uso}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <hr className="divider" />

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Atribuciones que exigen aviso</Rotulo>
        <Lista>
          <Punto>
            <strong style={{ color: 'var(--fg)' }}>sharp</strong> — Apache License 2.0. Se conserva su
            aviso de copyright y, si se redistribuye el binario, su archivo{' '}
            <span className="mono">NOTICE</span>. La licencia Apache 2.0 incluye una concesión de
            patentes y exige indicar los cambios realizados.
          </Punto>
          <Punto>
            <strong style={{ color: 'var(--fg)' }}>epubjs</strong> — BSD 2-Clause. Se reproduce su aviso
            de copyright y sus dos condiciones: conservar el aviso en las redistribuciones y no usar el
            nombre de los autores para promocionar productos derivados.
          </Punto>
          <Punto>
            <strong style={{ color: 'var(--fg)' }}>lucide-react</strong> — ISC. Se mantiene el aviso de
            copyright y el permiso en todas las copias.
          </Punto>
          <Punto>
            <strong style={{ color: 'var(--fg)' }}>SQLite</strong> — dominio público. No impone
            condiciones de atribución.
          </Punto>
        </Lista>
      </div>

      <p className="dim" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
        Las licencias de terceros no modifican la licencia de Estrato: el programa sigue siendo
        propietario, aunque incorpore componentes con licencias permisivas.
      </p>
    </Bloque>
  )
}

// ============================================================
// 04 · Privacidad y datos
// ============================================================

function SeccionPrivacidad() {
  const [purgando, setPurgando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null)

  // Purga la caché local a través del IPC existente (`cache:clear`).
  // No toca los archivos exportados ni el token guardado.
  const borrarDatos = async () => {
    const confirmado = confirm(
      'Se borrarán la caché de mensajes, archivos, usuarios y el historial de descargas terminadas.\n\n' +
        'Los archivos ya exportados a tu carpeta de salida no se tocan.'
    )
    if (!confirmado) return

    setPurgando(true)
    setResultado(null)
    try {
      const respuesta = await window.api.cache.clear()
      setResultado(
        respuesta.success
          ? { ok: true, texto: 'Caché local vaciada. La base quedó compactada.' }
          : { ok: false, texto: respuesta.error || 'El proceso principal no devolvió detalle del fallo.' }
      )
    } catch (error) {
      setResultado({
        ok: false,
        texto: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setPurgando(false)
    }
  }

  return (
    <Bloque icono={Lock} titulo="Privacidad y datos" meta="Sin servidor">
      <Entradilla>Todo lo que Estrato sabe de ti vive en una sola carpeta de este equipo.</Entradilla>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Qué se guarda y dónde</Rotulo>
        <div className="col" style={{ gap: 0 }}>
          <Dato etiqueta="Token de Discord" valor="data/preferences.json · cifrado con DPAPI" />
          <Dato etiqueta="Preferencias y rutas" valor="data/preferences.json · JSON en claro" />
          <Dato etiqueta="Base de datos local" valor="data/estrato.db · SQLite con WAL" />
          <Dato etiqueta="Archivos exportados" valor="La carpeta de salida que elijas" />
        </div>
        <p className="dim" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
          El token se cifra con <span className="mono">safeStorage</span>, que en Windows usa DPAPI y
          queda ligado a tu usuario del sistema. Si el sistema no ofrece cifrado, se guarda codificado en
          base64 sin cifrar; en ese caso conviene no compartir la carpeta{' '}
          <span className="mono">data/</span>.
        </p>
      </div>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Qué no se envía a ningún sitio</Rotulo>
        <Lista>
          <Punto>No hay telemetría, analítica de uso ni identificadores de instalación.</Punto>
          <Punto>No hay informe de errores a servidores propios ni de terceros.</Punto>
          <Punto>
            No hay servidor central: el programa no tiene backend al que pueda consultar tu actividad.
          </Punto>
          <Punto>
            Las búsquedas del visor recorren el disco local; la consulta nunca sale del equipo.
          </Punto>
        </Lista>
      </div>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Qué sale por la red</Rotulo>
        <Parrafo>
          Solo peticiones a la API oficial de Discord (<span className="mono">discord.com</span>) y
          descargas desde su CDN de contenido (<span className="mono">cdn.discordapp.com</span> y{' '}
          <span className="mono">media.discordapp.net</span>), que es donde viven las imágenes, los
          vídeos y los avatares. Nada más.
        </Parrafo>
      </div>

      <hr className="divider" />

      <div className="col" style={{ gap: 'var(--sp-3)' }}>
        <Rotulo>Borrar los datos</Rotulo>
        <Parrafo>
          El botón purga la caché de metadatos y el historial de descargas terminadas, y compacta la base.
          No elimina los documentos ya exportados ni el token guardado.
        </Parrafo>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button className="btn btn--ghost btn--sm" onClick={() => void borrarDatos()} disabled={purgando}>
            {purgando ? 'Borrando…' : 'Borrar datos locales'}
          </button>
          {resultado && (
            <span
              className={resultado.ok ? 'badge badge--ok' : 'badge badge--err'}
              style={{ height: 'auto', padding: '3px 8px', textTransform: 'none', letterSpacing: 0 }}
            >
              {resultado.texto}
            </span>
          )}
        </div>
        <p className="dim" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
          Para un borrado total, cierra la aplicación y elimina la carpeta{' '}
          <span className="mono">data/</span> (junto al ejecutable en la versión portable). Eso arrastra
          token, preferencias y base de datos; los archivos exportados se borran aparte, desde el
          explorador. Cerrar sesión desde la aplicación elimina únicamente el token guardado.
        </p>
      </div>
    </Bloque>
  )
}

// ============================================================
// 05 · Permisos y seguridad
// ============================================================

function SeccionPermisos() {
  return (
    <Bloque icono={ShieldCheck} titulo="Permisos y seguridad" meta="7 controles">
      <Parrafo>
        La interfaz se ejecuta como una página web sin privilegios: no puede tocar archivos, procesos ni
        la red por su cuenta. Todo lo sensible ocurre en el proceso principal, detrás de un puente
        explícito. Estos son los controles activos en la versión empaquetada.
      </Parrafo>

      <div className="col" style={{ gap: 0 }}>
        <Verificacion titulo="Aislamiento de contexto">
          <span className="mono">contextIsolation</span> está activo: el código de la interfaz y el del
          preload viven en mundos separados y solo comparten lo que se expone por{' '}
          <span className="mono">contextBridge</span>.
        </Verificacion>

        <Verificacion titulo="Sandbox del renderer">
          El proceso de la ventana corre en sandbox y con{' '}
          <span className="mono">nodeIntegration</span> desactivado: no hay <span className="mono">require</span>,{' '}
          ni <span className="mono">process</span>, ni acceso al sistema de archivos desde la interfaz.
        </Verificacion>

        <Verificacion titulo="Política de seguridad de contenido">
          En producción se inyecta una CSP que limita los scripts al propio paquete y la red a{' '}
          <span className="mono">discord.com</span> y su CDN. Sin orígenes externos, sin{' '}
          <span className="mono">eval</span> y sin objetos incrustados.
        </Verificacion>

        <Verificacion titulo="Protocolo archive:// confinado">
          Las imágenes y los documentos del archivo se sirven por un protocolo propio que valida cada
          ruta contra la carpeta de salida. Cualquier intento de salir de ella —incluidos enlaces
          simbólicos— devuelve 403. El HTML archivado se sirve sin scripts.
        </Verificacion>

        <Verificacion titulo="Enlaces externos solo de Discord">
          Abrir un enlace pasa por una lista blanca: <span className="mono">discord.com</span>,{' '}
          <span className="mono">discordapp.com</span> y sus dominios de pruebas, además del esquema{' '}
          <span className="mono">discord:</span>. Cualquier otro destino se descarta.
        </Verificacion>

        <Verificacion titulo="Sin navegación ni ventanas nuevas">
          Las ventanas emergentes se deniegan, la navegación fuera de la aplicación se cancela y las
          vistas web incrustadas se bloquean.
        </Verificacion>

        <Verificacion titulo="Permisos del sistema denegados">
          Cámara, micrófono, ubicación, portapapeles y notificaciones del navegador se rechazan de raíz:
          la aplicación no pide ninguno y el manejador de permisos responde siempre que no.
        </Verificacion>
      </div>

      <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'flex-start' }}>
        <Database size={14} strokeWidth={1.8} style={{ color: 'var(--fg-3)', marginTop: 3 }} aria-hidden="true" />
        <p className="dim" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
          Las escrituras sobre el disco están acotadas a la carpeta de salida mediante comprobaciones de
          ruta en el proceso principal; el renderer no recibe ninguna capacidad de escritura directa.
        </p>
      </div>
    </Bloque>
  )
}

// ============================================================
// 06 · Términos de Discord
// ============================================================

function SeccionDiscord() {
  return (
    <Bloque icono={MessagesSquare} titulo="Términos de Discord" meta="Riesgo del usuario">
      <div
        className="row"
        style={{
          alignItems: 'flex-start',
          gap: 'var(--sp-3)',
          padding: 'var(--sp-3) var(--sp-4)',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface-2)'
        }}
      >
        <TriangleAlert
          size={15}
          strokeWidth={1.8}
          style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 2 }}
          aria-hidden="true"
        />
        <div className="col" style={{ gap: 'var(--sp-2)' }}>
          <span style={{ fontSize: 'var(--text-md)', color: 'var(--fg)' }}>
            Automatizar una cuenta de usuario puede contravenir los Términos de Servicio de Discord.
          </span>
          <span className="dim" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
            Las consecuencias —advertencias, limitaciones o el cierre de la cuenta— recaen sobre quien
            usa la herramienta, no sobre el programa. Ese riesgo es tuyo y conviene asumirlo con
            información.
          </span>
        </div>
      </div>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Qué hace exactamente la aplicación</Rotulo>
        <Lista>
          <Punto>
            Lee canales, hilos y mensajes a los que tu cuenta ya tiene acceso. No descubre contenido
            privado ni eleva privilegios.
          </Punto>
          <Punto>
            No envía mensajes, no reacciona, no edita, no borra y no se une a ningún servidor.
          </Punto>
          <Punto>
            Respeta los límites de peticiones de la API y espera cuando el servidor lo indica.
          </Punto>
          <Punto>
            No elude captchas, verificaciones ni bloqueos: si Discord rechaza una petición, la operación
            falla.
          </Punto>
        </Lista>
      </div>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Qué se espera de ti</Rotulo>
        <Lista>
          <Punto>
            Archiva solo contenido propio o aquel para el que tengas autorización de sus participantes y
            de la comunidad.
          </Punto>
          <Punto>
            No reduzcas los tiempos de espera entre peticiones por debajo de lo razonable: el límite
            protege tanto tu cuenta como el servicio.
          </Punto>
          <Punto>
            No uses la herramienta para vigilar a personas, recopilar datos personales ajenos ni
            redistribuir conversaciones privadas.
          </Punto>
        </Lista>
      </div>

      <p className="dim" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
        Este apartado no es asesoramiento legal. Si tu uso tiene implicancias laborales, periodísticas o
        comerciales, consulta los términos vigentes de Discord y, si hace falta, a un profesional.
      </p>
    </Bloque>
  )
}

// ============================================================
// 07 · Contacto y soporte
// ============================================================

function SeccionContacto() {
  return (
    <Bloque icono={LifeBuoy} titulo="Contacto y soporte" meta="Local">
      <Parrafo>
        Estrato no tiene mesa de ayuda ni formulario web: el proyecto se mantiene en su propio
        repositorio local. Los informes se registran ahí, con el detalle suficiente para poder
        reproducir el problema.
      </Parrafo>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Dónde reportar</Rotulo>
        <Lista>
          <Punto>
            En el repositorio del proyecto, abriendo una incidencia con un título que describa el
            síntoma, no la solución.
          </Punto>
          <Punto>
            Si el problema es de privacidad o de seguridad, márcalo como tal antes de adjuntar capturas:
            puede contener datos de terceros.
          </Punto>
        </Lista>
      </div>

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <Rotulo>Qué incluir en el informe</Rotulo>
        <div className="col" style={{ gap: 0 }}>
          <Dato etiqueta="Versión de Estrato" valor={VERSION} />
          <Dato etiqueta="Sistema operativo" valor="Windows · versión y arquitectura" />
          <Dato etiqueta="Pasos" valor="Qué hiciste, qué esperabas, qué ocurrió" />
          <Dato etiqueta="Adjuntos" valor="Captura o mensaje de error, sin tokens" />
        </div>
      </div>

      <div
        className="row"
        style={{
          alignItems: 'flex-start',
          gap: 'var(--sp-3)',
          padding: 'var(--sp-3) var(--sp-4)',
          border: '1px solid var(--line-soft)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface-2)'
        }}
      >
        <KeyRound size={15} strokeWidth={1.8} style={{ color: 'var(--fg-3)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, color: 'var(--fg-2)' }}>
          Nunca incluyas tu token de Discord en un informe. Si sospechas que se filtró, cámbialo desde
          Discord y luego cierra sesión en Estrato: el token guardado se elimina al instante.
        </p>
      </div>

      <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'flex-start' }}>
        <HardDrive size={14} strokeWidth={1.8} style={{ color: 'var(--fg-3)', marginTop: 3 }} aria-hidden="true" />
        <p className="dim" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
          Antes de reportar un fallo de archivado, revisa que la carpeta de salida exista y tenga
          permisos de escritura; la mayoría de los errores de exportación vienen de ahí.
        </p>
      </div>
    </Bloque>
  )
}

// ============================================================
// Vista
// ============================================================

export default function AboutView() {
  const [activa, setActiva] = useState<SeccionId>('resumen')

  return (
    <>
      <header className="workspace__header">
        <div className="workspace__titles">
          <div className="workspace__title">Legal y privacidad</div>
          <div className="workspace__subtitle">
            Licencia, tratamiento de datos y garantías de la aplicación
          </div>
        </div>
        <div className="workspace__actions">
          <span className="badge badge--accent">v{VERSION}</span>
        </div>
      </header>

      <div className="workspace__body">
        <div className="view-pad">
          {/* Dos columnas que se apilan solas cuando la ventana es estrecha
              (modo compacto): el índice nunca ahoga al contenido. */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sp-6)',
              alignItems: 'flex-start'
            }}
          >
            {/* Índice lateral: siete secciones, una activa */}
            <nav
              aria-label="Secciones legales"
              style={{ position: 'sticky', top: 0, flex: '0 1 200px', minWidth: 148 }}
            >
              <div className="list">
                {SECCIONES.map((s) => {
                  const Icono = s.icono
                  const seleccionada = s.id === activa
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`list__row${seleccionada ? ' list__row--active' : ''}`}
                      onClick={() => setActiva(s.id)}
                      aria-current={seleccionada ? 'page' : undefined}
                      style={{
                        width: '100%',
                        background: 'transparent',
                        border: 0,
                        textAlign: 'left',
                        font: 'inherit',
                        color: 'inherit'
                      }}
                    >
                      <Icono
                        size={15}
                        strokeWidth={1.8}
                        style={{ color: seleccionada ? 'var(--accent-fg)' : 'var(--fg-3)', flexShrink: 0 }}
                        aria-hidden="true"
                      />
                      <span className="list__name" style={{ flex: 1 }}>
                        {s.nombre}
                      </span>
                      <span className="list__meta mono">{s.numero}</span>
                    </button>
                  )
                })}
              </div>
            </nav>

            <div style={{ flex: '1 1 460px', minWidth: 0 }}>
              {activa === 'resumen' && <SeccionResumen />}
              {activa === 'licencia' && <SeccionLicencia />}
              {activa === 'terceros' && <SeccionTerceros />}
              {activa === 'privacidad' && <SeccionPrivacidad />}
              {activa === 'permisos' && <SeccionPermisos />}
              {activa === 'discord' && <SeccionDiscord />}
              {activa === 'contacto' && <SeccionContacto />}

              <p
                className="dim"
                style={{
                  fontSize: 'var(--text-2xs)',
                  lineHeight: 1.6,
                  marginTop: 'var(--sp-4)',
                  textAlign: 'right'
                }}
              >
                Estrato {VERSION} · {ANIO} · Documento informativo, no asesoramiento legal
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
