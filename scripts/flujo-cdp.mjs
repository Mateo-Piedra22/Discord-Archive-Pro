// Flujo principal por CDP: servidor → canal → publicaciones, y captura.
// Uso: node scripts/flujo-cdp.mjs [puerto] [salida]
import fs from 'fs'

const puerto = process.argv[2] || '9222'
const salida = process.argv[3] || 'flujo.png'

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

await ev(`window.dispatchEvent(new CustomEvent('dap:navigate', { detail: 'explorar' }))`)
await esperar(900)

// Primer servidor de la lista lateral.
console.log('servidores:', await ev(`document.querySelectorAll('.split__side .list__row').length`))
await ev(`document.querySelectorAll('.split__side .list__row')[1]?.click()`)
await esperar(2500)

// Primer canal navegable.
console.log('canales:', await ev(`document.querySelectorAll('.split__main .list__row').length`))
const canal = await ev(`(() => {
  const filas = [...document.querySelectorAll('.split__main .list__row')];
  const util = filas.find(f => !f.style.cursor || f.style.cursor !== 'not-allowed');
  if (!util) return null;
  const nombre = util.querySelector('.list__name')?.textContent;
  util.click();
  return nombre;
})()`)
console.log('canal abierto:', canal)
await esperar(3000)

const captura = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(salida, Buffer.from(captura.data, 'base64'))
console.log(`Captura: ${salida}`)
ws.close()
