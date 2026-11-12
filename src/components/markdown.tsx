import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/** Renders markdown from the setup (never raw HTML: react-markdown escapes it). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn('overflow-auto bg-muted/40 p-3 font-mono text-[11px] leading-relaxed', className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

/** YAML-ish frontmatter as a key/value list. */
export function Frontmatter({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null
  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 border bg-muted/30 p-3 text-[11px]">
      {Object.entries(data as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className="contents">
          <span className="text-muted-foreground">{k}</span>
          <span className="min-w-0 font-mono break-words whitespace-pre-wrap">
            {typeof v === 'string' ? v : JSON.stringify(v, null, 1)}
          </span>
        </div>
      ))}
    </div>
  )
}
