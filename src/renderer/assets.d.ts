// Declaraciones de tipos para assets estáticos del bundler de Vite
// Permite a TypeScript entender las importaciones de imágenes/fuentes resueltas por Vite.

declare module '*.png' {
  const url: string
  export default url
}

declare module '*.jpg' {
  const url: string
  export default url
}

declare module '*.jpeg' {
  const url: string
  export default url
}

declare module '*.svg' {
  const url: string
  export default url
}

declare module '*.webp' {
  const url: string
  export default url
}

declare module '*.gif' {
  const url: string
  export default url
}
