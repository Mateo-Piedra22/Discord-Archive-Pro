// ============================================================
// Captura de la interfaz vía Chrome DevTools Protocol.
// Requiere arrancar Electron con --remote-debugging-port=9222.
//
// Uso:
//   node scripts/captura-cdp.mjs explorar ui-1.png
//   node scripts/captura-cdp.mjs ajustes  ui-4.png
// ============================================================

import fs from 'fs'

const [, , vista = 'explorar', salida = 'captura.png'] = process.argv
const PUERTO = process.env.CDP_PORT || '9222'

const listado = await fetch(`http://127.0.0.1:${PUERTO}/json`).then((r) => r.json())
const pagina = listado.find((t) => t.type === 'page')
if (!pagina) {
  console.error('No hay ninguna página depurable. ¿Arrancaste con --remote-debugging-port?')
  process.exit(1)
}

const ws = new WebSocket(pagina.webSocketDebuggerUrl)
let siguienteId = 0
const pendientes = new Map()

ws.addEventListener('message', (evento) => {
  const mensaje = JSON.parse(evento.data)
  if (mensaje.id && pendientes.has(mensaje.id)) {
    const { resolver, rechazar } = pendientes.get(mensaje.id)
    pendientes.delete(mensaje.id)
    if (mensaje.error) rechazar(new Error(mensaje.error.message))
    else resolver(mensaje.result)
  }
})

function enviar(method, params = {}) {
  const id = ++siguienteId
  return new Promise((resolver, rechazar) => {
    pendientes.set(id, { resolver, rechazar })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

await new Promise((resolver) => ws.addEventListener('open', resolver, { once: true }))

await enviar('Page.enable')
await enviar('Runtime.enable')

// Navega usando el mismo evento que usan las vistas.
await enviar('Runtime.evaluate', {
  expression: `window.dispatchEvent(new CustomEvent('dap:navigate', { detail: '${vista}' }))`
})

// Espera a que terminen las transiciones y las cargas diferidas.
await new Promise((r) => setTimeout(r, 1200))

const captura = await enviar('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
fs.writeFileSync(salida, Buffer.from(captura.data, 'base64'))
console.log(`Captura guardada en ${salida}`)

ws.close()
