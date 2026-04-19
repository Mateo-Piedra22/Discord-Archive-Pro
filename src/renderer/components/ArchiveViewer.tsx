import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Folder, FolderOpen, FileText, Image as FileImage, BookOpen, FileJson, Globe, File, RefreshCw, ExternalLink, PanelLeftClose, PanelLeftOpen, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, Download, Maximize2, Search, X, Plus, Minus } from 'lucide-react'
import { useDownloadStore } from '../stores/downloadStore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// @ts-ignore - Support for raw HTML in markdown
import rehypeRaw from 'rehype-raw'
import DOMPurify from 'dompurify'
import ePub, { Rendition } from 'epubjs'
import * as pdfjsLib from 'pdfjs-dist'

// @ts-ignore - Syntax Highlighting for code views
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
// @ts-ignore - VSCode Dark theme for professional look
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
// @ts-ignore - JSON Tree visualizer
import ReactJson from 'react-json-view'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

interface FileEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  children?: FileEntry[]
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'ico']

/**
 * Utility to map file extensions to Prism highligher languages
 */
const getLanguageFromExt = (ext: string): string => {
  const map: Record<string, string> = {
    'md': 'markdown',
    'html': 'markup',
    'css': 'css',
    'json': 'json',
    'js': 'javascript',
    'ts': 'typescript',
    'jsx': 'jsx',
    'tsx': 'tsx',
    'xml': 'markup',
    'log': 'bash',
    'txt': 'text',
    'csv': 'csv',
    'sql': 'sql',
    'yml': 'yaml',
    'yaml': 'yaml'
  };
  return map[ext.toLowerCase()] || 'text';
}

export default function ArchiveViewer() {
  const { outputDir, openOutputFolder } = useDownloadStore()
  const [tree, setTree] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string; type: string; name: string } | null>(null)
  const [imagePreview, setImagePreview] = useState<{ path: string; name: string } | null>(null)
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered')
  const [searchQuery, setSearchQuery] = useState('')
  const [treeWidth, setTreeWidth] = useState(250)
  const [treeVisible, setTreeVisible] = useState(true)
  const [imageZoom, setImageZoom] = useState(1)
  const [imageRotate, setImageRotate] = useState(0)
  const dragging = useRef(false)

  // Flatten tree for gallery navigation
  const flatFiles = useMemo(() => {
    const files: FileEntry[] = []
    const walk = (nodes: FileEntry[]) => {
      nodes.forEach(node => {
        if (node.type === 'file') files.push(node)
        if (node.children) walk(node.children)
      })
    }
    walk(tree)
    return files
  }, [tree])

  const imageFiles = useMemo(() =>
    flatFiles.filter(f => IMAGE_EXTS.includes(f.name.split('.').pop()?.toLowerCase() || '')),
    [flatFiles]
  )

  const onMouseDownSplitter = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startW = treeWidth
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const newW = Math.max(140, Math.min(500, startW + ev.clientX - startX))
      setTreeWidth(newW)
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [treeWidth])

  const loadTree = async () => {
    if (!outputDir) return
    setLoading(true)
    try {
      const entries = await window.api.archive.scanDirectory(outputDir)
      setTree(entries || [])
    } catch (err) {
      console.error('Failed to scan archive:', err)
      setTree([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTree()
  }, [outputDir])

  const handleFileClick = async (entry: FileEntry) => {
    if (entry.type === 'dir') return

    const ext = entry.name.split('.').pop()?.toLowerCase() || ''

    if (IMAGE_EXTS.includes(ext)) {
      setImagePreview({ path: entry.path, name: entry.name })
      setSelectedFile(null)
      setImageZoom(1)
      setImageRotate(0)
    } else if (['md', 'txt', 'json', 'html', 'css', 'log', 'pdf', 'epub', 'zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'csv', 'xml', 'iso'].includes(ext)) {
      try {
        if (['pdf', 'epub', 'zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'csv', 'xml', 'iso'].includes(ext)) {
          setSelectedFile({ path: entry.path, content: '', type: ext, name: entry.name })
          setImagePreview(null)
        } else {
          const content = await window.api.archive.readFile(entry.path)
          setSelectedFile({ path: entry.path, content, type: ext, name: entry.name })
          setImagePreview(null)
        }
      } catch {
        setSelectedFile({ path: entry.path, content: 'Error al leer archivo', type: 'txt', name: entry.name })
      }
    } else {
      window.api.settings.openFolder(entry.path)
    }
  }

  const navigateGallery = (direction: number) => {
    if (!imagePreview) return
    const currentIndex = imageFiles.findIndex(f => f.path === imagePreview.path)
    const nextIndex = (currentIndex + direction + imageFiles.length) % imageFiles.length
    const nextFile = imageFiles[nextIndex]
    if (nextFile) {
      setImagePreview({ path: nextFile.path, name: nextFile.name })
      setImageZoom(1)
      setImageRotate(0)
    }
  }

  const filterTree = (nodes: FileEntry[]): FileEntry[] => {
    if (!searchQuery) return nodes
    const q = searchQuery.toLowerCase()

    return nodes.map(node => {
      if (node.name.toLowerCase().includes(q)) return node
      if (node.type === 'dir' && node.children) {
        const filteredChildren = filterTree(node.children)
        if (filteredChildren.length > 0) {
          return { ...node, children: filteredChildren }
        }
      }
      return null
    }).filter(Boolean) as FileEntry[]
  }

  const renderBreadcrumbs = () => {
    const currentPath = imagePreview?.path || selectedFile?.path
    if (!currentPath || !outputDir) return null

    const relative = currentPath.replace(outputDir, '').replace(/\\/g, '/')
    const parts = relative.split('/').filter(Boolean)

    return (
      <div className="breadcrumbs">
        <Folder size={12} style={{ marginRight: 6, opacity: 0.5 }} />
        {parts.map((part, i) => (
          <React.Fragment key={part}>
            <span className="breadcrumb__item">{part}</span>
            {i < parts.length - 1 && <span className="breadcrumb__sep">/</span>}
          </React.Fragment>
        ))}
      </div>
    )
  }

  if (!outputDir) {
    return (
      <div className="panel full-center">
        <div className="empty-state">
          <div className="empty-state__icon"><Folder size={48} opacity={0.2} /></div>
          <h3>Sin Carpeta de Origen</h3>
          <p>Ve a Configuración para seleccionar la carpeta donde se descargan tus archivos.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="archive-view">
      <div className="toolbar" style={{ 
        background: 'rgba(255, 255, 255, 0.02)', 
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        padding: '10px 16px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
      }}>
        <button
          className="btn btn--ghost btn--xs"
          onClick={() => setTreeVisible(v => !v)}
          title={treeVisible ? 'Ocultar Explorador' : 'Mostrar Explorador'}
        >
          {treeVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        <div className="spacer--h" style={{ width: 12 }} />
        {renderBreadcrumbs()}
        <div className="spacer" />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn--ghost btn--xs" onClick={loadTree} title="Actualizar"><RefreshCw size={14} /></button>
          <button className="btn btn--ghost btn--xs" onClick={openOutputFolder} title="Abrir carpeta"><ExternalLink size={14} /></button>
        </div>
      </div>

      <div className="archive-view__body" style={{ position: 'relative' }}>
        {treeVisible && (
          <div className="archive-view__tree" style={{ width: treeWidth }}>
            <div className="tree-search">
              <Search size={13} className="tree-search__icon" />
              <input
                className="tree-search__input"
                placeholder="Buscar archivos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="tree-container">
              {loading ? (
                <div className="panel__pad">
                  {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton skeleton--row" style={{ marginBottom: 8 }} />)}
                </div>
              ) : filterTree(tree).length === 0 ? (
                <div className="empty-state--small" style={{
                  padding: '24px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '12px',
                  margin: '8px'
                }}>
                  <div style={{ opacity: 0.3, marginBottom: 12 }}>
                    <Search size={32} strokeWidth={1.5} />
                  </div>
                  <p style={{ 
                    fontSize: '11px', 
                    fontWeight: 500, 
                    color: 'var(--text-3)',
                    textAlign: 'center'
                  }}>
                    {searchQuery ? 'No se encontraron resultados para tu búsqueda' : 'No hay archivos en esta carpeta todavía'}
                  </p>
                </div>
              ) : (
                <TreeNode entries={filterTree(tree)} depth={0} onFileClick={handleFileClick} activePath={imagePreview?.path || selectedFile?.path} />
              )}
            </div>
          </div>
        )}

        {treeVisible && (
          <div onMouseDown={onMouseDownSplitter} className="tree-splitter" />
        )}

        <div className="archive-view__preview">
          {imagePreview ? (
            <div className="preview-image-container">
              <div className="viewer-controls viewer-controls--floating">
                <div className="viewer-controls__group">
                  <button className="btn btn--ghost btn--xs" onClick={() => navigateGallery(-1)} title="Anterior"><ChevronLeft size={16} /></button>
                  <span className="viewer-info">{imagePreview.name}</span>
                  <button className="btn btn--ghost btn--xs" onClick={() => navigateGallery(1)} title="Siguiente"><ChevronRight size={16} /></button>
                </div>
                <div className="spacer--h" />
                <div className="viewer-controls__group">
                  <button className="btn btn--ghost btn--xs" onClick={() => setImageZoom(z => z + 0.2)}><ZoomIn size={16} /></button>
                  <button className="btn btn--ghost btn--xs" onClick={() => setImageZoom(1)} title="Reset"><Maximize2 size={16} /></button>
                  <button className="btn btn--ghost btn--xs" onClick={() => setImageZoom(z => Math.max(0.1, z - 0.2))}><ZoomOut size={16} /></button>
                  <button className="btn btn--ghost btn--xs" onClick={() => setImageRotate(r => r + 90)}><RotateCw size={16} /></button>
                  <div className="spacer--h" style={{ width: 8 }} />
                  <button className="btn btn--ghost btn--xs" style={{ background: 'var(--red)', color: 'white' }} onClick={() => setImagePreview(null)} title="Cerrar"><X size={16} /></button>
                </div>
              </div>
              <div className="image-canvas" style={{ overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <img
                  src={`file://${imagePreview.path}`}
                  alt=""
                  style={{
                    transform: `scale(${imageZoom}) rotate(${imageRotate}deg)`,
                    transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    maxWidth: imageZoom === 1 ? '90%' : 'none',
                    maxHeight: imageZoom === 1 ? '90%' : 'none',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                    borderRadius: 4
                  }}
                />
              </div>
            </div>
          ) : selectedFile ? (
            <div className="preview-content-wrapper">
              <div className="preview-header">
                <div className="preview-header__title">
                  {selectedFile.type === 'pdf' ? <BookOpen size={14} color="var(--red)" /> :
                    selectedFile.type === 'epub' ? <BookOpen size={14} color="var(--amber)" /> :
                      selectedFile.type === 'json' ? <FileJson size={14} color="var(--text-2)" /> :
                        <FileText size={14} color="var(--text-1)" />}
                  <span>{selectedFile.name}</span>
                </div>
                <div className="preview-header__actions">
                  {['md', 'html', 'json'].includes(selectedFile.type) && (
                    <div className="view-toggle">
                      <button className={`view-toggle__btn ${viewMode === 'rendered' ? 'view-toggle__btn--active' : ''}`} onClick={() => setViewMode('rendered')}>Visualizar</button>
                      <button className={`view-toggle__btn ${viewMode === 'source' ? 'view-toggle__btn--active' : ''}`} onClick={() => setViewMode('source')}>Código</button>
                    </div>
                  )}
                  <button className="btn btn--ghost btn--xs" onClick={() => window.api.settings.revealFolder(selectedFile.path)}><ExternalLink size={14} /></button>
                </div>
              </div>
              {/* 
                FIX: preview-viewport needs min-height: 0 to allow the container 
                to shrink inside its flex parent and trigger internal overflow scroll.
              */}
              <div className="preview-viewport" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {viewMode === 'rendered' && selectedFile.type === 'md' ? (
                  /* FIX: markdown-body should not have overflow: hidden or fixed height */
                  <div className="markdown-body" style={{ flex: 1, height: 'auto' }}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      urlTransform={(src: string) => {
                        if (src.startsWith('http') || src.startsWith('file')) return src;

                        // Robust relative path resolution
                        const parts = selectedFile.path.split(/[\\/]/);
                        const fileDir = parts.slice(0, -1).join('/');

                        // Try to find /assets/ folder by going up if needed
                        let currentDir = fileDir;
                        let absolutePath = '';

                        // Clean src (remove ./ or leading /)
                        const cleanSrc = src.replace(/^\.?\//, '');

                        // If src starts with assets/, it's likely relative to the post root
                        // We need to find where assets/ actually is
                        if (cleanSrc.startsWith('assets/')) {
                          if (selectedFile.path.includes('/replies/') || selectedFile.path.includes('\\replies\\')) {
                            const pathParts = fileDir.split(/[\\/]/);
                            const rootDir = pathParts.slice(0, -1).join('/');
                            absolutePath = `${rootDir}/${cleanSrc}`;
                          } else {
                            absolutePath = `${fileDir}/${cleanSrc}`;
                          }
                        } else {
                          absolutePath = `${fileDir}/${cleanSrc}`;
                        }

                        return `file://${absolutePath.replace(/\\/g, '/')}`;
                      }}
                    >
                      {selectedFile.content.replace(/^---\r?\n[\s\S]*?\n---\r?\n/, '')}
                    </ReactMarkdown>
                  </div>
                ) : viewMode === 'rendered' && selectedFile.type === 'html' ? (
                  <HtmlPreview content={selectedFile.content} path={selectedFile.path} />
                ) : viewMode === 'rendered' && selectedFile.type === 'json' ? (
                  <JsonViewer content={selectedFile.content} />
                ) : selectedFile.type === 'pdf' ? (
                  <PdfViewer path={selectedFile.path} />
                ) : selectedFile.type === 'epub' ? (
                  <EpubViewer path={selectedFile.path} />
                ) : ['zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'csv', 'xml', 'iso'].includes(selectedFile.type) ? (
                  <div className="full-center" style={{ padding: '2rem' }}>
                    <div className="empty-state--small">
                      <Download size={48} color="var(--blue)" />
                      <h3>{selectedFile.name}</h3>
                      <p>Este tipo de archivo debe abrirse con una aplicación externa.</p>
                      <button className="btn btn--primary" onClick={() => window.api.settings.openFolder(selectedFile.path)}>
                        Abrir Archivo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="source-code-editor" style={{ flex: 1, minHeight: 0, width: '100%', background: '#1e1e1e' }}>
                    <SyntaxHighlighter
                      language={getLanguageFromExt(selectedFile.type)}
                      style={vscDarkPlus}
                      showLineNumbers={true}
                      customStyle={{
                        margin: 0,
                        padding: '24px',
                        background: 'transparent',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        fontFamily: 'var(--font-mono)',
                        height: '100%'
                      }}
                      lineNumberStyle={{
                        minWidth: '3.5em',
                        paddingRight: '1.5em',
                        color: 'var(--text-3)',
                        opacity: 0.4,
                        textAlign: 'right',
                        userSelect: 'none'
                      }}
                    >
                      {selectedFile.content}
                    </SyntaxHighlighter>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="archive-empty-landing" style={{
              flex: 1,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '40px',
              textAlign: 'center',
              background: 'radial-gradient(circle at center, rgba(88, 101, 242, 0.05) 0%, transparent 70%)'
            }}>
              <div className="empty-hero" style={{ position: 'relative', width: 200, height: 200, marginBottom: 32 }}>
                <ArchiveAnimation />
              </div>

              <div style={{ maxWidth: 450, position: 'relative' }}>
                <h2 style={{ 
                  color: 'var(--text-0)', 
                  marginBottom: 12, 
                  fontSize: '1.8rem', 
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  background: 'linear-gradient(to bottom, #fff, #999)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent'
                }}>
                  Explorador de Archivos
                </h2>
                <p style={{ 
                  fontSize: 'var(--font-md)', 
                  color: 'var(--text-2)', 
                  lineHeight: 1.6,
                  marginBottom: 32
                }}>
                  Bienvenido a tu biblioteca personal. Navega por el árbol de directorios a la izquierda para visualizar mensajes, medios y documentos exportados con fidelidad de producción.
                </p>

                <div className="empty-tips" style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr 1fr', 
                  gap: 16,
                  marginTop: 20
                }}>
                  <div className="tip-card" style={{
                    padding: '16px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '12px',
                    textAlign: 'left',
                    transition: 'transform 0.2s, background 0.2s',
                    cursor: 'default'
                  }}>
                    <BookOpen size={18} color="var(--accent)" style={{ marginBottom: 12 }} />
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>Previsualización</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>Soporte nativo para Markdown, PDF, EPUB, JSON e Imágenes.</div>
                  </div>
                  <div className="tip-card" style={{
                    padding: '16px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '12px',
                    textAlign: 'left',
                    transition: 'transform 0.2s, background 0.2s',
                    cursor: 'default'
                  }}>
                    <Maximize2 size={18} color="var(--green)" style={{ marginBottom: 12 }} />
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>Interactividad</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>Zoom en imágenes, búsqueda en árbol y cambio de temas.</div>
                  </div>
                </div>
              </div>

              {/* Add keyframe animations directly to style tag or via CSS (assuming we can inject it) */}
              <style dangerouslySetInnerHTML={{ __html: `
                @keyframes float {
                  0%, 100% { transform: translateY(0px) rotate(0deg); }
                  50% { transform: translateY(-15px) rotate(2deg); }
                }
                @keyframes pulse {
                  0% { opacity: 0.05; transform: scale(1); }
                  100% { opacity: 0.12; transform: scale(1.1); }
                }
                .tip-card:hover {
                  background: rgba(255,255,255,0.06) !important;
                  transform: translateY(-4px);
                }
              `}} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function HtmlPreview({ path: filePath }: { content: string; path: string }) {
  // Use file:// protocol for Electron IFRAME
  // FIX: Ensure iframe takes full space and handles internal scrolling
  const fileUri = `file://${filePath.replace(/\\/g, '/')}`;

  return (
    /* 
      FIX: The HTML container MUST allow the iframe to take 100% of the available 
      height and handle its own scrollbars. Added flex properties to ensure expansion.
    */
    <div className="html-preview-container" style={{
      flex: 1,
      width: '100%',
      height: '100%',
      minHeight: 0,
      background: '#0f0f12',
      overflow: 'hidden',
      display: 'flex'
    }}>
      <iframe
        src={fileUri}
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          border: 'none',
          backgroundColor: '#fff'
        }}
        title="HTML Preview"
        sandbox="allow-same-origin allow-scripts allow-popups"
      />
    </div>
  );
}

function JsonViewer({ content }: { content: string }) {
  // Memoize parsing to prevent expensive re-renders on every parent toggle
  const data = useMemo(() => {
    try {
      return typeof content === 'string' ? JSON.parse(content) : content;
    } catch {
      return null;
    }
  }, [content])

  // Fallback if parsing fails or content is not valid JSON
  if (!data) {
    return (
      <div style={{ flex: 1, background: '#1e1e1e' }}>
        <SyntaxHighlighter language="json" style={vscDarkPlus} customStyle={{ margin: 0, background: 'transparent' }}>
          {content}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <div className="json-visualizer" style={{
      flex: 1,
      overflow: 'auto',
      padding: '20px',
      background: 'var(--bg-1)',
      minHeight: 0
    }}>
      <ReactJson
        src={data}
        theme="ocean"
        style={{
          background: 'transparent',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px'
        }}
        iconStyle="circle"
        displayDataTypes={false}
        displayObjectSize={true}
        enableClipboard={true}
        collapsed={2} // Start with a reasonable collapse depth for big files
        collapseStringsAfterLength={100}
        name={false}
        onEdit={false} // Read-only for viewer
        onAdd={false}
        onDelete={false}
      />
    </div>
  );
}

function PdfViewer({ path }: { path: string }) {
  const [loading, setLoading] = useState(true)
  const fileUri = `file://${path.replace(/\\/g, '/')}`

  return (
    <div className="pdf-viewer-native" style={{ 
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      background: '#1a1a1c',
      position: 'relative',
      minHeight: 0
    }}>
      {loading && (
        <div className="full-center" style={{ 
          position: 'absolute', 
          inset: 0, 
          zIndex: 10, 
          background: 'var(--bg-0)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          <RefreshCw className="animate-spin" size={24} color="var(--accent)" />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Sincronizando visor nativo...</span>
        </div>
      )}
      
      <iframe
        src={`${fileUri}#view=FitH&toolbar=1`}
        style={{ 
          flex: 1, 
          width: '100%', 
          height: '100%', 
          border: 'none',
          visibility: loading ? 'hidden' : 'visible'
        }}
        onLoad={() => setLoading(false)}
        title="PDF Preview"
      />
    </div>
  )
}

function EpubViewer({ path }: { path: string }) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<any>(null)
  const [fontSize, setFontSize] = useState(100)
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('light')
  const [location, setLocation] = useState<string | null>(null)

  useEffect(() => {
    if (!viewerRef.current) return
    const book = ePub(`file://${path}`)

    book.loaded.metadata.then(m => setMeta(m))

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      manager: 'default',
    })

    renditionRef.current = rendition

    rendition.display().then(() => {
      setLoading(false)
      applyTheme(theme)
    })

    rendition.on('relocated', (loc: any) => {
      setLocation(loc.start.displayed.page + ' / ' + loc.start.displayed.total)
    })

    return () => {
      book.destroy()
    }
  }, [path])

  const applyTheme = (t: typeof theme) => {
    if (!renditionRef.current) return
    const themes = renditionRef.current.themes
    themes.register('dark', { body: { background: '#121214', color: '#e1e1e6' } })
    themes.register('sepia', { body: { background: '#f4ecd8', color: '#5b4636' } })
    themes.register('light', { body: { background: '#ffffff', color: '#1a1a1a' } })
    themes.select(t)
    setTheme(t)
  }

  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.fontSize(`${fontSize}%`)
    }
  }, [fontSize])

  return (
    <div className={`epub-viewer-v2 theme-${theme}`} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme === 'dark' ? '#0a0a0c' : theme === 'sepia' ? '#efe3c5' : '#f0f0f5' }}>
      <div className="viewer-controls viewer-controls--glass">
        <div className="viewer-controls__group">
          <button className="btn btn--ghost btn--xs" onClick={() => renditionRef.current?.prev()}><ChevronLeft size={18} /></button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span className="viewer-info" style={{ fontWeight: 600 }}>{meta?.title || 'Leyendo EPUB'}</span>
            <span style={{ fontSize: 9, opacity: 0.6 }}>{location || 'Cargando...'}</span>
          </div>
          <button className="btn btn--ghost btn--xs" onClick={() => renditionRef.current?.next()}><ChevronRight size={18} /></button>
        </div>
        <div className="spacer" />
        <div className="viewer-controls__group">
          <div className="epub-themes">
            <button className={`theme-dot light ${theme === 'light' ? 'active' : ''}`} onClick={() => applyTheme('light')} />
            <button className={`theme-dot sepia ${theme === 'sepia' ? 'active' : ''}`} onClick={() => applyTheme('sepia')} />
            <button className={`theme-dot dark ${theme === 'dark' ? 'active' : ''}`} onClick={() => applyTheme('dark')} />
          </div>
          <div className="spacer--h" style={{ width: 12 }} />
          <button className="btn btn--ghost btn--xs" onClick={() => setFontSize(f => Math.min(200, f + 10))} title="Aumentar fuente"><Plus size={14} /></button>
          <span style={{ fontSize: 11, width: 35, textAlign: 'center' }}>{fontSize}%</span>
          <button className="btn btn--ghost btn--xs" onClick={() => setFontSize(f => Math.max(50, f - 10))} title="Disminuir fuente"><Minus size={14} /></button>
        </div>
      </div>
      <div className="epub-viewport-container" style={{ flex: 1, position: 'relative', margin: '15px', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', background: theme === 'dark' ? '#121214' : theme === 'sepia' ? '#f4ecd8' : '#fff' }}>
        <div ref={viewerRef} style={{ height: '100%' }} />
        {loading && <div className="loader full-center">Abriendo libro...</div>}
      </div>
    </div>
  )
}

function TreeNode({ entries, depth, onFileClick, activePath }: { entries: FileEntry[]; depth: number; onFileClick: (e: FileEntry) => void; activePath?: string }) {
  return (
    <div className="tree-node">
      {entries.map((entry, idx) => (
        <TreeItem key={`${entry.name}-${idx}`} entry={entry} depth={depth} onFileClick={onFileClick} activePath={activePath} />
      ))}
    </div>
  )
}

function TreeItem({ entry, depth, onFileClick, activePath }: { entry: FileEntry; depth: number; onFileClick: (e: FileEntry) => void; activePath?: string }) {
  const [open, setOpen] = useState(depth < 1)
  const isDir = entry.type === 'dir'
  const isActive = activePath === entry.path
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''

  let icon = <File size={14} color="var(--text-3)" />
  if (isDir) icon = open ? <FolderOpen size={14} color="var(--blue)" /> : <Folder size={14} color="var(--blue)" />
  else if (IMAGE_EXTS.includes(ext)) icon = <FileImage size={14} color="var(--green)" />
  else if (ext === 'md') icon = <FileText size={14} color="var(--text-1)" />
  else if (ext === 'pdf') icon = <BookOpen size={14} color="var(--red)" />
  else if (ext === 'epub') icon = <BookOpen size={14} color="var(--amber)" />
  else if (ext === 'html') icon = <Globe size={14} color="var(--blue)" />
  else if (ext === 'json') icon = <FileJson size={14} color="var(--text-2)" />

  return (
    <div className="tree-item-wrapper">
      <div className={`tree-item${isDir ? ' tree-item--dir' : ''}${isActive ? ' tree-item--active' : ''}`}
        style={{ paddingLeft: 12 + depth * 12 }}
        onClick={() => { if (isDir) setOpen(!open); else onFileClick(entry); }}>
        <span className="tree-item__icon">{icon}</span>
        <span className="tree-item__name">{entry.name}</span>
        {entry.size !== undefined && entry.size > 0 && !isDir && (
          <span className="tree-item__size">{formatSize(entry.size)}</span>
        )}
      </div>
      {isDir && open && entry.children && entry.children.length > 0 && (
        <TreeNode entries={entry.children} depth={depth + 1} onFileClick={onFileClick} activePath={activePath} />
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/**
 * Premium SVG Animation Component
 * Renders a multi-layered futuristic archive icon with CSS transitions.
 */
function ArchiveAnimation() {
  return (
    <div className="archive-anim-container" style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative'
    }}>
      {/* Background glow */}
      <div style={{
        position: 'absolute',
        width: '120%',
        height: '120%',
        background: 'radial-gradient(circle, var(--accent) 0%, transparent 60%)',
        opacity: 0.15,
        filter: 'blur(30px)',
        animation: 'glowPulse 4s infinite alternate ease-in-out'
      }} />

      <svg width="120" height="120" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Shadow/Base */}
        <path d="M4 19V5C4 3.89543 4.89543 3 6 3H18C19.1046 3 20 3.89543 20 5V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19Z" fill="var(--bg-1)" fillOpacity="0.1" />
        
        {/* Back page */}
        <path className="page-anim-back" d="M18 19V5C18 4.44772 17.5523 4 17 4H7C6.44772 4 6 4.44772 6 5V19C6 20.1046 6.89543 21 8 21H16C17.1046 21 18 20.1046 18 19Z" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.3" />
        
        {/* Main folder/book cover */}
        <path className="folder-anim-main" d="M22 19V9C22 7.89543 21.1046 7 20 7H13.4142C13.149 7 12.8946 6.89464 12.7071 6.70711L10.2929 4.29289C10.1054 4.10536 9.85095 4 9.58579 4H4C2.89543 4 2 4.89543 2 6V19C2 20.1046 2.89543 21 4 21H20C21.1046 21 22 20.1046 22 19Z" fill="url(#folderGradient)" stroke="var(--accent)" strokeWidth="1.5" />
        
        {/* Content lines */}
        <path className="line-anim-1" d="M7 12H17" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.6" />
        <path className="line-anim-2" d="M7 15H14" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.6" />
        
        <defs>
          <linearGradient id="folderGradient" x1="2" y1="4" x2="22" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.1" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
      </svg>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes glowPulse {
          0% { transform: scale(0.8); opacity: 0.1; }
          100% { transform: scale(1.1); opacity: 0.25; }
        }
        .folder-anim-main {
          animation: floatFolder 4s infinite ease-in-out;
        }
        .page-anim-back {
          animation: slidePage 4s infinite ease-in-out;
        }
        .line-anim-1 {
          animation: scanLine 3s infinite ease-in-out;
        }
        .line-anim-2 {
          animation: scanLine 3s infinite ease-in-out 0.5s;
        }
        @keyframes floatFolder {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        @keyframes slidePage {
          0%, 100% { transform: translateY(0) translateX(0); }
          50% { transform: translateY(-12px) translateX(4px); }
        }
        @keyframes scanLine {
          0%, 100% { stroke-dasharray: 0, 20; stroke-dashoffset: 0; opacity: 0; }
          20% { opacity: 0.6; }
          50% { stroke-dasharray: 10, 0; stroke-dashoffset: -5; }
          80% { opacity: 0.6; }
        }
      `}} />
    </div>
  )
}
