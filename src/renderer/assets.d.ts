// Static asset type declarations for Vite bundler
// Allows TypeScript to understand image/font imports resolved by Vite.

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
