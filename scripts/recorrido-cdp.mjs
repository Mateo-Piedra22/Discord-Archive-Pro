// Recorrido completo por CDP: inicia sesión, navega y captura cada superficie.
// Uso: node scripts/recorrido-cdp.mjs [puerto]
//
// El recorrido es determinista: espera a que cada paso produzca su resultado
// en el DOM antes de seguir, en lugar de confiar en pausas fijas.
import fs from 'fs'

const puerto = process.argv[2] || '9222'
const listado = await fetch(`http://127.0.0.1:${puerto}/json`).then((r) => r.json())
const pagina = listado.find((t) => t.type === 'page')
if (!pagina) {
  console.error('Sin página depurable.')
  process.exit(1)
}

const ws = new WebSocket(pagina.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id)
    pend.delete(m.id)
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id
    pend.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params }))
  })

await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Runtime.enable')
await send('Page.enable')

const ev = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

/** Espera a que una expresión devuelva algo verdadero. */
async function esperarA(expr, etiqueta, limite = 20000) {
  const inicio = Date.now()
  while (Date.now() - inicio < limite) {
    const valor = await ev(expr)
    if (valor) return valor
    await esperar(400)
  }
  console.log(`tiempo agotado: ${etiqueta}`)
  return null
}

async function capturar(nombre) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(nombre, Buffer.from(shot.data, 'base64'))
  console.log('captura:', nombre)
}

const irA = async (destino) => {
  await ev(`window.dispatchEvent(new CustomEvent('dap:navigate', { detail: '${destino}' }))`)
  await esperar(1200)
}

// 1. Iniciar sesión con la sesión detectada (si hace falta).
const conectado = await ev(`!!document.querySelector('.rail')`)
if (!conectado) {
  console.log('sin sesión: detectando…')
  const r = await ev(`(async () => {
    const d = await window.api.tokenDetector.detect()
    if (!d.tokens.length) return 'sin tokens'
    await window.api.auth.setToken(d.tokens[0].token)
    return 'ok'
  })()`)
  console.log('login:', r)
  // El store del renderer se hidrata al montar: recargamos para que valide.
  await send('Page.reload')
  await esperar(4500)
}

// 2. Panel
await irA('panel')
await capturar('ui-panel.png')

// 3. Explorar: servidor → canal
await irA('explorar')
// Si la app venía con un canal abierto, la vista muestra la lista de
// publicaciones en lugar del explorador: Escape vuelve a la lista de canales.
if (!(await ev(`!!document.querySelector('.split__side')`))) {
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await esperar(1200)
}
await esperarA(`document.querySelectorAll('.split__side .list__row').length > 2`, 'lista de servidores')
await ev(`document.querySelectorAll('.split__side .list__row')[1]?.click()`)
await esperarA(`document.querySelectorAll('.split__main .list__row').length > 0`, 'lista de canales')

// Filtramos por foros para asegurar publicaciones con hilo.
await ev(`(() => {
  const chip = [...document.querySelectorAll('.split__main button, .split__main .chip')]
    .find(b => /^foro/i.test(b.textContent.trim()));
  chip?.click();
  return !!chip;
})()`)
await esperar(900)
await ev(`(() => {
  const filas = [...document.querySelectorAll('.split__main .list__row')];
  const util = filas.find(f => getComputedStyle(f).cursor !== 'not-allowed');
  util?.click();
  return !!util;
})()`)
await esperarA(
  `document.querySelectorAll('button[title="Leer el hilo sin descargarlo"]').length > 0`,
  'lista de publicaciones'
)
await capturar('ui-explorar.png')

// 4. Visor en vivo (botón «Leer»)
const leido = await ev(`(() => {
  const b = document.querySelector('button[title="Leer el hilo sin descargarlo"]');
  if (!b) return false; b.click(); return true;
})()`)
console.log('visor en vivo:', leido)
const cajon = await esperarA(`!!document.querySelector('.cajon')`, 'panel del hilo', 25000)
await esperar(2500)
console.log('mensajes en el visor:', await ev(`document.querySelectorAll('.msg').length`))
console.log('cajón visible:', !!cajon)
await capturar('ui-hilo.png')

// 5. Paleta de comandos
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
await esperar(500)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))`)
await esperar(800)
await capturar('ui-paleta.png')

// 6. Búsqueda global
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
await esperar(400)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))`)
await esperar(700)
await ev(`(() => {
  const i = document.querySelector('.dialogo input');
  if (!i) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'BlackMarket');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await esperar(2200)
await capturar('ui-busqueda.png')

// 7. Resto de superficies
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
await esperar(400)
await irA('cola')
await capturar('ui-cola.png')
await irA('archivo')
await capturar('ui-archivo.png')
await irA('ajustes')
await capturar('ui-ajustes.png')
await irA('legal')
await capturar('ui-legal.png')

ws.close()
