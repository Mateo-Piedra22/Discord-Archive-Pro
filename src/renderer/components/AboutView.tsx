// AboutView.tsx — Legal disclaimer, usage policy, non-affiliation notice,
//                 privacy statement, and application info.

import React, { useState } from 'react'
import {
  ShieldAlert, FileText, Info, Heart, AlertTriangle, ExternalLink,
  Lock, Globe, HelpCircle, BookOpen, ChevronDown, ChevronRight
} from 'lucide-react'

const VERSION = '1.0.0'
const BUILD_DATE = '2026'

// ─── Section accordion ────────────────────────────────────────────────────────
function Section({ icon, title, accent, children }: {
  icon: React.ReactNode
  title: string
  accent?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{
      border: `1px solid ${accent ? `${accent}33` : 'var(--border)'}`,
      borderRadius: 10,
      overflow: 'hidden',
      background: accent ? `${accent}08` : 'var(--bg-1)'
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '12px 16px', border: 'none',
          background: 'transparent', cursor: 'pointer', textAlign: 'left'
        }}
      >
        <span style={{ color: accent || 'var(--accent)', display: 'flex' }}>{icon}</span>
        <span style={{ flex: 1, fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-0)' }}>{title}</span>
        {open ? <ChevronDown size={14} style={{ color: 'var(--text-3)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />}
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px', fontSize: '0.82rem', color: 'var(--text-2)', lineHeight: 1.65 }}>
          {children}
        </div>
      )}
    </div>
  )
}

function P({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p style={{ marginBottom: 8, ...props.style }} {...props}>{children}</p>
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: 'var(--text-0)', fontWeight: 700 }}>{children}</strong>
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
      <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }}>›</span>
      <span>{children}</span>
    </div>
  )
}

function ExLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => { e.preventDefault(); window.open(href) }}
      style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
    >
      {children} <ExternalLink size={10} />
    </a>
  )
}

// ─── Tab list ─────────────────────────────────────────────────────────────────
type LegalTab = 'about' | 'disclaimer' | 'usage' | 'privacy' | 'terms'

const TABS: { key: LegalTab; label: string; icon: React.ReactNode }[] = [
  { key: 'about', label: 'Acerca de', icon: <Info size={13} /> },
  { key: 'disclaimer', label: 'Aviso Legal', icon: <ShieldAlert size={13} /> },
  { key: 'usage', label: 'Uso', icon: <BookOpen size={13} /> },
  { key: 'privacy', label: 'Privacidad', icon: <Lock size={13} /> },
  { key: 'terms', label: 'ToS Discord', icon: <FileText size={13} /> },
]

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AboutView() {
  const [tab, setTab] = useState<LegalTab>('about')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Sub-tabs */}
      <div style={{
        display: 'flex', gap: 2, padding: '8px 12px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-1)',
        flexShrink: 0, overflowX: 'auto'
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 6, border: 'none',
              background: tab === t.key ? 'var(--accent-dim)' : 'transparent',
              color: tab === t.key ? 'var(--accent-text)' : 'var(--text-2)',
              fontWeight: tab === t.key ? 700 : 400,
              fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
              fontFamily: 'var(--font)'
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* ── ABOUT ── */}
        {tab === 'about' && (<>
          {/* Hero */}
          <div style={{
            padding: '30px 20px', borderRadius: 16, textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(88,101,242,0.15) 0%, rgba(235,69,158,0.1) 100%)',
            border: '1px solid rgba(88,101,242,0.25)', marginBottom: 8,
            boxShadow: '0 4px 24px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontWeight: 900, fontSize: '1.6rem', color: 'var(--text-0)', marginBottom: 6, letterSpacing: '-0.02em' }}>
              Discord Archive Pro
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-3)', fontStyle: 'italic' }}>
              Advanced Archiving & Forensic Data Export Tool
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginTop: 4 }}>
              Versión {VERSION} (2026) · © {BUILD_DATE}
            </div>
          </div>

          <Section icon={<Info size={16} />} title="Visión General del Proyecto">
            <P>
              <Strong>Discord Archive Pro</Strong> es una solución de grado profesional diseñada para la preservación de datos digitales. En una era donde las plataformas centralizadas dominan nuestra comunicación, poseer copias locales de tus conversaciones es un acto de soberanía digital.
            </P>
            <P>
              Esta herramienta permite transformar el flujo efímero de Discord en registros estáticos, inmutables y portables. Ideal para archivistas, comunidades que desean respaldar su conocimiento colectivo, o usuarios individuales que buscan preservar recuerdos personales.
            </P>
            <Bullet><Strong>Autonomía Estructural</Strong>: Los datos exportados no dependen de la infraestructura de Discord para ser visualizados.</Bullet>
            <Bullet><Strong>Portabilidad Extrema</Strong>: Formatos universales compatibles con cualquier visor de texto, navegador o e-reader.</Bullet>
          </Section>

          <Section icon={<Heart size={16} />} title="Ecosistema Tecnológico">
            <Bullet><Strong>Electron Framework (v34+)</Strong> — Núcleo de alto rendimiento para aplicaciones híbridas.</Bullet>
            <Bullet><Strong>React 19 & TypeScript 5</Strong> — Interface reactiva con tipado estricto para máxima estabilidad.</Bullet>
            <Bullet><Strong>SQLite Advanced Engine</Strong> — Manejo de caché local con capacidad para millones de registros sin degradación.</Bullet>
            <Bullet><Strong>Vercel Optimization Patterns</Strong> — Implementación de mejores prácticas de renderizado y performance.</Bullet>
            <Bullet><Strong>Secure Storage Architecture</Strong> — Cifrado de credenciales mediante DPAPI (Windows) / Keychain (macOS).</Bullet>
          </Section>
        </>)}

        {/* ── DISCLAIMER ── */}
        {tab === 'disclaimer' && (<>
          <Section icon={<AlertTriangle size={16} />} title="Estatus Jurídico y No Afiliación" accent="#faa61a">
            <div style={{
              background: 'rgba(250,166,26,0.1)', border: '1px solid rgba(250,166,26,0.3)',
              borderRadius: 8, padding: '12px 16px', marginBottom: 14, fontWeight: 700, color: '#faa61a',
              lineHeight: 1.4
            }}>
              ATENCIÓN: Discord Archive Pro es una herramienta INDEPENDIENTE. No existe vínculo societario, comercial ni oficial con Discord Inc.
            </div>
            <P>
              <Strong>Discord Inc.</Strong> posee todos los derechos sobre la marca "Discord" y sus activos visuales. El uso de dichos términos en esta aplicación es estrictamente nominativo y descriptivo, destinado únicamente a informar al usuario sobre la compatibilidad del servicio.
            </P>
          </Section>

          <Section icon={<ShieldAlert size={16} />} title="Limitación de Responsabilidad (Hold Harmless)" accent="#ed4245">
            <P>
              El usuario reconoce y acepta que el uso de esta herramienta conlleva riesgos inherentes. <Strong>Discord Archive Pro y sus desarrolladores NO serán responsables por:</Strong>
            </P>
            <Bullet><Strong>Acciones de la Plataforma</Strong>: Baneos de cuentas (Shadow-bans, suspensiones permanentes) por violar las políticas de Discord en cuanto a automatización o "self-bots".</Bullet>
            <Bullet><Strong>Integridad de Datos</Strong>: Errores en la exportación, pérdida de archivos o fallos en el proceso de descarga.</Bullet>
            <Bullet><Strong>Uso de Credenciales</Strong>: Consecuencias derivadas del manejo manual de tokens por parte del usuario.</Bullet>
            <P style={{ marginTop: 10, padding: 10, background: 'rgba(237,66,69,0.05)', borderRadius: 6, borderLeft: '3px solid var(--red)' }}>
              Al ejecutar esta aplicación, el usuario libera de toda responsabilidad legal y financiera a los creadores de este software por cualquier daño derivado del acceso a los servidores de Discord mediante métodos no aprobados explícitamente por dicha empresa.
            </P>
          </Section>

          <Section icon={<HelpCircle size={16} />} title="Aviso sobre Propiedad Intelectual">
            <P>
              Los mensajes, imágenes y contenidos descargados a través de esta herramienta son propiedad intelectual de sus respectivos autores. El hecho de poder descargarlos no otorga al usuario derechos de autor, licencia de distribución ni propiedad alguna sobre el contenido de terceros.
            </P>
          </Section>
        </>)}

        {/* ── USAGE ── */}
        {tab === 'usage' && (<>
          <Section icon={<BookOpen size={16} />} title="Código de Conducta y Ética de Datos">
            <P>El archivado de datos debe realizarse bajo principios éticos:</P>
            <Bullet><Strong>Finalidad Legítima</Strong>: Uso para backup personal, investigación académica o archivo histórico sin fines de lucro.</Bullet>
            <Bullet><Strong>Respeto a la Privacidad</Strong>: Abstención de archivar canales privados o DMs sin el consentimiento explícito de los participantes.</Bullet>
            <Bullet><Strong>Transparencia</Strong>: En contextos de servidores comunitarios, se recomienda informar a los moderadores sobre la realización de respaldos.</Bullet>
          </Section>

          <Section icon={<AlertTriangle size={16} />} title="Prohibiciones Críticas" accent="#ed4245">
            <Bullet><Strong>Comercialización</Strong>: Venta de bases de datos de usuarios o mensajes extraídos mediante esta aplicación.</Bullet>
            <Bullet><Strong>Entrenamiento de Modelos de IA</Strong>: Queda terminantemente prohibido usar los datos extraídos de terceros para alimentar modelos de lenguaje (LLMs) u otras IAs sin autorización legal de los autores originales (Safe-Guard for AI Training 2026).</Bullet>
            <Bullet><Strong>Explotación de Vulnerabilidades</Strong>: Uso de la herramienta para encontrar debilidades en la infraestructura de Discord.</Bullet>
          </Section>

          <Section icon={<Info size={16} />} title="Cumplimiento con Rate-Limits">
            <P>
              La herramienta incluye un limitador inteligente de tasa de peticiones. Forzar o "hackear" los timeouts internos de la aplicación para acelerar descargas es un motivo directo de baneo por parte de los sistemas de seguridad de Discord (Anti-Scraping protection). <Strong>Usa la configuración recomendada.</Strong>
            </P>
          </Section>
        </>)}

        {/* ── PRIVACY ── */}
        {tab === 'privacy' && (<>
          <Section icon={<Lock size={16} />} title="Arquitectura de Privacidad Local (Zero-Server)" accent="#23a559">
            <P><Strong>Discord Archive Pro opera bajo el paradigma de "Conocimiento Cero".</Strong></P>
            <P>No existe un servidor central, no hay telemetría de uso y no hay seguimiento de errores enviado a la nube.</P>
            <Bullet><Strong>Local-First Storage</Strong>: Tu token viaja directamente de tu almacenamiento seguro al socket de Discord. Nunca es interceptado por un tercero.</Bullet>
            <Bullet><Strong>Aislamiento de Red</Strong>: El proceso renderer tiene restricciones estrictas para no conectarse a ninguna dirección que no sea la API oficial de Discord o CDNs de assets.</Bullet>
            <Bullet><Strong>Auditoría de Caché</Strong>: La base de datos SQLite es accesible y legible por ti en cualquier momento usando herramientas estándar.</Bullet>
          </Section>

          <Section icon={<ShieldAlert size={16} />} title="Cumplimiento Normativo (GDPR / CCPA / LGPD)">
            <P>
              Como usuario de esta herramienta, actúas como el <Strong>Controlador de Datos</Strong>. Eres responsable de cumplir con las legislaciones locales sobre el tratamiento de datos de carácter personal.
            </P>
            <P>
              Recuerda que el derecho al archivado personal (personal use exception) tiene límites en cada jurisdicción. El uso de esta aplicación implica que conoces y acatas estas regulaciones.
            </P>
          </Section>
        </>)}

        {/* ── DISCORD ToS ── */}
        {tab === 'terms' && (<>
          <Section icon={<FileText size={16} />} title="Interpretación de los Términos de Discord" accent="#5865F2">
            <P>Los Términos de Servicio de Discord son un contrato vinculante. Aspectos críticos a considerar:</P>
            <Bullet>
              <Strong>Sección 3.2 (Restrictions)</Strong>: Prohíbe el uso de software automatizado para acceder a los servicios. Discord Archive Pro automatiza la lectura de la API de forma que imita el comportamiento humano, pero sigue siendo un riesgo técnico.
            </Bullet>
            <Bullet>
              <Strong>Propiedad del Usuario</Strong>: Tú eres dueño de tus mensajes, pero Discord tiene una licencia de uso sobre ellos. El archivado local te devuelve el control físico de tus datos.
            </Bullet>
            <Bullet>
              <Strong>Derecho al Olvido</Strong>: Si un usuario borra sus mensajes en Discord, tu copia local persistirá. Maneja esta información con responsabilidad ética y legal.
            </Bullet>
          </Section>

          <Section icon={<Globe size={16} />} title="Directrices de la comunidad" accent="#5865F2">
            <P>Además de los ToS, las <ExLink href="https://discord.com/guidelines">Normas de la Comunidad</ExLink> de Discord prohíben:</P>
            <Bullet>Compartir información privada de otras personas sin consentimiento (doxxing).</Bullet>
            <Bullet>Acosar, intimidar o amenazar a otros usuarios.</Bullet>
            <Bullet>Evadir sanciones o bans de servidores o de la plataforma.</Bullet>
            <P>El uso de Discord Archive Pro para infringir estas normas está expresamente prohibido por nuestra política de uso.</P>
          </Section>

          <Section icon={<AlertTriangle size={16} />} title="Recomendaciones legales" accent="#faa61a">
            <P>
              <Strong>Si exportas conversaciones de terceros</Strong>, considera las siguientes leyes:
            </P>
            <Bullet><Strong>GDPR (UE)</Strong>: Requiere base legal para procesar datos personales de ciudadanos europeos.</Bullet>
            <Bullet><Strong>CCPA (California)</Strong>: Otorga derechos a los consumidores sobre sus datos personales.</Bullet>
            <Bullet><Strong>LGPD (Brasil)</Strong>: Ley General de Protección de Datos, similar al GDPR.</Bullet>
            <P>
              Esta herramienta está diseñada para uso personal. Consulta con un asesor legal si
              planeas usar el contenido exportado en contextos comerciales o de investigación.
            </P>
          </Section>
        </>)}
      </div>
    </div>
  )
}
