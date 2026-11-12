import { Link, type LinkProps } from '@tanstack/react-router'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
      <div className="min-w-0 space-y-1">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="max-w-3xl text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  to,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ComponentType<{ className?: string }>
  to?: LinkProps['to']
}) {
  const body = (
    <Card size="sm" className={cn('h-full transition-colors', to && 'hover:bg-muted/50')}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-[11px] font-normal uppercase tracking-wider text-muted-foreground">
          {label}
          {Icon ? <Icon className="size-3.5" /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="truncate text-[11px] text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  )
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  )
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function Loading({ label = 'Loading…', rows = 6 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {label}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive">
      <AlertTriangle className="size-4" />
      {error instanceof Error ? error.message : 'Something went wrong.'}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 border border-dashed p-8 text-center text-xs text-muted-foreground">
      <Inbox className="size-5" />
      {children}
    </div>
  )
}

/** Renders a query's loading / error states, or its data. */
export function QueryView<T>({
  query,
  children,
  loading,
}: {
  query: { data: T | undefined; error: unknown; isPending: boolean }
  children: (data: T) => ReactNode
  loading?: ReactNode
}) {
  if (query.error) return <ErrorState error={query.error} />
  if (query.isPending || query.data === undefined) return <>{loading ?? <Loading />}</>
  return <>{children(query.data)}</>
}

export function KeyValues({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-xs">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[11px] text-muted-foreground', className)}>{children}</span>
}

const SOURCE_COLORS: Record<string, string> = {
  user: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  agents: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'claude-ai': 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  plugin: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  project: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  'project-local': 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  local: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  'user-local': 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  feedback: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  reference: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  security: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  info: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

/** A colored badge for a source / scope / type name. */
export function Tag({ children, tone }: { children: ReactNode; tone?: string }) {
  const key = tone ?? (typeof children === 'string' ? children : '')
  return (
    <Badge variant="secondary" className={cn('font-normal', SOURCE_COLORS[key])}>
      {children}
    </Badge>
  )
}

export function Dot({ on, title }: { on: boolean | null; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        on === null
          ? 'bg-muted-foreground/40'
          : on
            ? 'bg-emerald-500'
            : 'bg-muted-foreground/20 ring-1 ring-muted-foreground/40',
      )}
    />
  )
}

/** Horizontal bars for a ranked list (tools, folders…). */
export function BarList({
  items,
  format = v => v.toLocaleString(),
  max,
}: {
  items: { label: ReactNode; value: number; key?: string }[]
  format?: (v: number) => string
  max?: number
}) {
  const top = max ?? Math.max(1, ...items.map(i => i.value))
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={item.key ?? i} className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
          <div className="relative min-w-0 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-chart-1/15"
              style={{ width: `${(item.value / top) * 100}%` }}
            />
            <div className="relative truncate px-2 py-1">{item.label}</div>
          </div>
          <div className="tabular-nums text-muted-foreground">{format(item.value)}</div>
        </div>
      ))}
    </div>
  )
}
