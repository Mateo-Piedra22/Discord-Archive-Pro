# Sistema de diseño

**Estrato**, *archivo vivo de comunidades*, tiene la identidad de un **archivo**: una
herramienta de preservación, no un panel de control. De ahí las decisiones: tinta
cálida en lugar de azul corporativo, un solo acento cobre, tipografía editorial en
los títulos y cifras tabulares en los datos.

Si vienes del diseño anterior (gradientes, glassmorphism, animaciones flotantes), el
cambio es intencionado: eso hacía que la app pareciera una demo y no una herramienta.

---

## Marca

- **Nombre**: Estrato. Un estrato es una capa de sedimento: lo que se depositó, en
  orden, y se puede leer de arriba abajo. Es lo que hace el producto con un canal.
- **Lema**: «Archivo vivo de comunidades».
- **Marca gráfica**: tres estratos apilados, tres capas horizontales que se estrechan
  hacia abajo. Se generan con `npm run icon` (`scripts/generate-icon.js`), sin
  dependencias: el `.ico` y los `.png` se escriben a mano desde formas vectoriales.
- **Paleta de la marca**: tinta `#1a1d22` → `#0d0f12` y tres cobres, `#e0a45c`,
  `#c9873f` y `#965f2a`. El tono medio es el acento de la interfaz.
- **Lockup**: icono + «Estrato» en la barra de título; el nombre solo, en la pantalla
  de acceso; el icono solo, en la cabecera del riel.

---

## Principios

1. **Densidad sobre espectáculo.** El usuario viene a leer y descargar, no a mirar
   animaciones. Filas compactas, jerarquía por tipografía y espaciado.
2. **Un acento.** El cobre marca lo accionable y lo activo. Nada más compite.
3. **Superficies planas.** Un borde de 1px separa; la sombra se reserva para lo que
   flota de verdad (avisos, diálogos y el cajón).
4. **Sin decoración.** No hay gradientes, ni `backdrop-filter`, ni halos. Si un
   elemento no aporta información, no existe.
5. **El movimiento informa.** 110–220 ms, `ease` con salida suave. Nunca rebotes.
   Con `prefers-reduced-motion`, todo se desactiva.

---

## Tokens

Todo vive en `src/renderer/assets/styles/tokens.css`. **No escribas colores, tamaños
ni radios literales**: usa la variable.

### Color

| Token | Uso |
|---|---|
| `--surface-0` | Fondo de la aplicación |
| `--surface-1` | Riel, barras, tarjetas |
| `--surface-2` | Campos, elementos elevados |
| `--surface-3` | Botones neutros, esqueletos |
| `--surface-hover` | Estado hover de superficie |
| `--line-soft` | Separadores internos |
| `--line` | Bordes de componentes |
| `--line-strong` | Bordes en hover |
| `--fg` | Texto principal |
| `--fg-2` | Texto secundario |
| `--fg-3` | Texto auxiliar, metadatos |
| `--fg-4` | Placeholders, deshabilitado |
| `--accent` | Acción primaria, estado activo (`#c9873f`) |
| `--accent-hover` / `--accent-press` | Estados del acento |
| `--accent-soft` | Fondo de la fila activa en la paleta |
| `--accent-line` | Resaltado de coincidencias, anillo de foco |
| `--accent-fg` | Texto sobre acento suave |
| `--ok` / `--warn` / `--err` / `--info` | Semántica de estado |

El tema claro redefine los mismos tokens con `:root[data-theme='light']`. **Ningún
componente sabe si está en claro u oscuro.**

### Tipografía

- `--font-ui`: pila del sistema. Sin fuentes externas (la app debe funcionar offline).
- `--font-display`: serif del sistema, solo para títulos de vista y de tarjeta.
- `--font-mono`: cifras, rutas, IDs. Siempre con `font-variant-numeric: tabular-nums`.

Escala: `--text-2xs` (10) · `xs` (11) · `sm` (12) · `md` (13) · `base` (14) ·
`lg` (16) · `xl` (20) · `2xl` (26) · `3xl` (34).

### Espaciado y forma

- Espaciado en múltiplos de 4: `--sp-1` … `--sp-10`.
- Radios: `--r-sm` (4, chips) · `--r-md` (6, botones/campos) · `--r-lg` (8, tarjetas)
  · `--r-xl` (12, contenedores grandes) · `--r-full`.

---

## Armazón

```
┌───────────────────────────────────────────────────────────┐
│ titlebar (40px)  marca · estado · ruta · controles        │
├──────┬────────────────────────────────────────────────────┤
│ rail │ workspace                                          │
│ (76) │  ├─ workspace__header (60px) título + acciones     │
│      │  └─ workspace__body                               │
└──────┴────────────────────────────────────────────────────┘
```

- **titlebar**: arrastrable (`-webkit-app-region: drag`), doble clic maximiza.
  De izquierda a derecha: marca, estado de sesión (punto + nombre), ruta contextual
  (servidor · canal, solo en Explorar), botón de paleta y controles de ventana. Los
  controles van en `.window-controls` con `no-drag`.
- **rail**: seis destinos —Panel, Explorar, Cola, Archivo, Ajustes, Legal— más pie.
  Cada uno tiene su `Ctrl+n` (1–6) en el `title`. El elemento activo tiene una barra
  de 2px a la izquierda y color de acento. El badge numérico de Cola cuenta
  descargas activas y satura en `99+`. El pie aloja «Buscar» y el conmutador de tema.
- **workspace**: cada vista pinta su `workspace__header` y su `workspace__body`.
  Las vistas con panel lateral usan `.split`.

El riel mide 76px fijos (`--rail-w`): no cambia entre temas ni en la ventana
compacta. Es la referencia estable de la navegación.

---

## Componentes

Todos en `components.css`. Resumen de uso:

| Componente | Clases | Nota |
|---|---|---|
| Botón | `.btn` + `--primary`/`--ghost`/`--danger` + `--sm`/`--icon`/`--block` | Altura 32 (27 en `--sm`) |
| Campo | `.field`, `.field__label`, `.field__hint`, `.input`, `.select` | 34px de alto |
| Buscador | `.search`, `.search__icon`, `.input--search` | Icono a la izquierda |
| Interruptor | `.switch`, `.switch--on` | 38×21 |
| Casilla | `.checkbox`, `.checkbox--on` | 16×16 |
| Stepper | `.stepper`, `.stepper__btn`, `.stepper__value` | Cifras mono |
| Tarjeta | `.card`, `.card__header`, `.card__title`, `.card__body` | Borde 1px, sin sombra |
| Fila de ajuste | `.setting-row`, `__label`, `__hint` | Toda la fila es clicable |
| Chip | `.chip`, `.chip--active` | Filtros |
| Badge | `.badge` + `--ok`/`--warn`/`--err`/`--info`/`--accent` | 19px de alto |
| Lista | `.list`, `.list__row`, `--active`, `.list__name`, `.list__meta` | Densidad 9px vertical |
| Vacío | `.empty`, `__icon`, `__title`, `__text` | Icono 44px, sin ilustración |
| Progreso | `.progress`, `.progress__fill` | 4px de alto |
| Tabla | `.table` | Para historial y datos |
| Esqueleto | `.skeleton`, `--row`, `--card` | Shimmer suave |
| Superposición | `.scrim`, `.scrim--centro` | Velo bajo la barra de título |
| Diálogo | `.dialogo` | 620px, radio 12, sombra; aloja paleta, atajos y búsqueda |
| Cajón | `.cajon` | Panel lateral derecho de 760px (visor en vivo) |
| Hilo | `.hilo` | Columna de mensajes |
| Mensaje | `.msg`, `--agrupado`, `__avatar`, `__autor`, `__hora`, `__texto`, `__adjuntos`, `__img`, `__reacciones` | Visor en vivo |
| Separador de día | `.separador-dia` | «Hoy», «Ayer», fecha larga |
| Reacción | `.reaccion` | Chip de emoji o de adjunto |
| Métrica | `.metrica`, `__valor`, `__etiqueta` | Cifra mono + rótulo en versalitas |
| Barra horizontal | `.barra-horizontal`, `__parte` | Reparto por servidor en el panel |
| Sección | `.section`, `__title` | Bloques del panel |
| Paleta | `.paleta__campo`, `__lista`, `__item`, `--activo`, `__grupo` | Paleta de comandos y hoja de atajos |

Utilidades: `.mono`, `.muted`, `.dim`, `.truncate`, `.row`, `.col`, `.spacer`,
`.divider`, `.kbd`, `.dot` (+ `--ok`/`--warn`/`--err`/`--busy`).

---

## Capas superpuestas

- El velo (`.scrim`) arranca debajo de la barra de título
  (`inset: var(--titlebar-h) 0 0 0`): la ventana sigue arrastrable con un diálogo
  abierto.
- `.scrim` alinea arriba con 12vh de aire (paleta y búsqueda); `.scrim--centro`
  centra (hoja de atajos).
- `.dialogo` es la superficie única de las tres capas con velo: mismo borde, mismo
  radio y misma sombra. La búsqueda solo lo ensancha a 760px.
- `.cajon` no lleva velo y no cierra al clicar fuera: es un panel de lectura. Se
  cierra con `Esc` o con el botón, y entra deslizando 28px desde la derecha.
- El movimiento de las capas es solo de entrada (`aparecer`, `brotar`, `deslizar`);
  no hay animación de salida.

---

## Reglas de implementación

**Sí**

- Usa clases del sistema.
- Usa `style` inline **solo** para valores dinámicos: `width: ${pct}%`,
  `transform: rotate(${deg}deg)`, `color: var(--status-${estado})`.
- Iconos de `lucide-react` a 14–18 px con `strokeWidth={1.8}`.
- Textos en español, tono directo.

**No**

- Gradientes, `backdrop-filter`, `text-shadow`, halos.
- Radios mayores de 12 px en componentes.
- Animaciones de entrada en cada tarjeta.
- Emojis en la interfaz.
- Colores literales (`#5865F2`) o píxeles sueltos (`padding: 13px`).
- Fuentes remotas.

---

## Accesibilidad

- `:focus-visible` con anillo de 2 px usando `--ring`.
- Contraste mínimo AA sobre `--surface-0`.
- `prefers-reduced-motion` desactiva transiciones y animaciones.
- Los controles de ventana y el riel tienen `title` descriptivo.
- El estado nunca se comunica solo por color: siempre hay texto o icono.
- Las capas con velo son `role="dialog"` con `aria-modal="true"` y `aria-label`;
  el foco entra en el campo al abrirlas.
- La lista de resultados de búsqueda es `role="listbox"` con `aria-selected` y se
  recorre con las flechas, `Enter` y `Esc`.

---

## Cómo añadir una vista

1. Crea el componente con `export default`.
2. Devuelve un fragmento con `.workspace__header` y `.workspace__body`.
3. Si necesitas panel lateral, usa `.split`.
4. Añade la entrada en `VISTAS` de `App.tsx` (icono, etiqueta, atajo `Ctrl+n`) y al
   tipo `Vista` de `stores/uiStore.ts`.
5. Impórtala con `React.lazy` para no engordar el bundle inicial.
6. Añádela también a la lista de `ShortcutsSheet` y al grupo «Ir a» de
   `CommandPalette`: ambas listas son estáticas y no se generan solas.
