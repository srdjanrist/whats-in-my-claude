// The transcript viewer: pages of conversation entries, loaded on demand.
// Tool calls, tool results, thinking and injected context are collapsed so
// the human ↔ Claude exchange reads top to bottom.
import { useInfiniteQuery } from '@tanstack/react-query'
import { Bot, ChevronRight, CornerDownRight, Info, Loader2, User, Wrench } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Empty, ErrorState } from '@/components/common'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { type client, fetchConversation, fetchEntry, type Res } from '@/lib/api'
import { dateTime, modelLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

type Page = Res<(typeof client.api.sessions)[':id']['conversation']['$get']>
type Entry = Page['entries'][number]
type Block = Extract<Entry, { kind: 'assistant' }>['blocks'][number]

const PAGE_SIZE = 60

export function Conversation({ sessionId, agent }: { sessionId: string; agent?: string }) {
  const query = useInfiniteQuery({
    queryKey: ['conversation', sessionId, agent ?? ''],
    queryFn: ({ pageParam }) => fetchConversation(sessionId, agent, pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: last => (last.offset + PAGE_SIZE < last.total ? last.offset + PAGE_SIZE : undefined),
  })
  if (query.error) return <ErrorState error={query.error} />
  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Indexing the transcript…
      </div>
    )
  }
  const first = query.data.pages[0]
  const entries = query.data.pages.flatMap(p => p.entries)
  if (!first || first.total === 0) return <Empty>No conversation in this transcript.</Empty>
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        {first.counts.prompt} prompts · {first.counts.assistant} responses · {first.counts['tool-result']} tool results
        {first.counts['compact-summary'] ? ` · ${first.counts['compact-summary']} compactions` : ''} — showing{' '}
        {entries.length} of {first.total}
      </p>
      <div className="space-y-2">
        {entries.map(e => (
          <EntryView key={e.index} entry={e} sessionId={sessionId} agent={agent} />
        ))}
      </div>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null}
          Load {Math.min(PAGE_SIZE, first.total - entries.length)} more
        </Button>
      ) : null}
    </div>
  )
}

function useFull(entry: Entry, sessionId: string, agent?: string) {
  const [full, setFull] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      setFull((await fetchEntry(sessionId, entry.index, agent)).entry)
    } finally {
      setLoading(false)
    }
  }
  return { shown: full ?? entry, load, loading }
}

function ShowAll({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      className="mt-1 text-[11px] underline text-muted-foreground"
      onClick={onClick}
      disabled={loading}
    >
      {loading ? 'Loading…' : 'Show all'}
    </button>
  )
}

function Fold({
  icon,
  label,
  tone,
  children,
}: {
  icon: ReactNode
  label: ReactNode
  tone?: string
  children: ReactNode
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        className={cn(
          'group flex w-full items-center gap-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground',
          tone,
        )}
      >
        <ChevronRight className="size-3 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
        {icon}
        <span className="min-w-0 truncate">{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-4">{children}</CollapsibleContent>
    </Collapsible>
  )
}

const pre = 'max-h-[28rem] overflow-auto bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap break-words'

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'text':
      return <Markdown className="text-xs">{block.text + (block.truncated ? '\n\n…' : '')}</Markdown>
    case 'thinking':
      return (
        <Fold icon={<Info className="size-3" />} label="thinking">
          <div className={pre}>{block.text || '(redacted)'}</div>
        </Fold>
      )
    case 'tool_use':
      return (
        <Fold
          icon={<Wrench className="size-3" />}
          label={
            <>
              <span className="font-medium text-foreground">{block.name}</span>{' '}
              <span className="font-mono">{block.summary}</span>
            </>
          }
        >
          <div className={pre}>{block.input}</div>
        </Fold>
      )
    case 'image':
      return <div className="text-[11px] text-muted-foreground">[image]</div>
    default:
      return <div className="text-[11px] text-muted-foreground">[{block.name}]</div>
  }
}

function EntryView({ entry, sessionId, agent }: { entry: Entry; sessionId: string; agent?: string }) {
  const { shown, load, loading } = useFull(entry, sessionId, agent)
  const time = <span className="text-[10px] text-muted-foreground">{dateTime(entry.at)}</span>
  switch (shown.kind) {
    case 'prompt':
      return (
        <div className="border-l-2 border-primary bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium">
            <User className="size-3.5" /> You {time}
          </div>
          <div className="text-xs whitespace-pre-wrap break-words">{shown.text}</div>
          {shown.truncated ? <ShowAll onClick={load} loading={loading} /> : null}
        </div>
      )
    case 'assistant':
      return (
        <div className="space-y-1.5 border-l-2 border-chart-2 p-3 pt-2">
          <div className="flex items-center gap-2 text-[11px] font-medium">
            <Bot className="size-3.5" /> Claude{' '}
            {shown.model ? <span className="font-normal text-muted-foreground">{modelLabel(shown.model)}</span> : null}{' '}
            {time}
          </div>
          {shown.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
          {shown.blocks.some(b => 'truncated' in b && b.truncated) && shown === entry ? (
            <ShowAll onClick={load} loading={loading} />
          ) : null}
        </div>
      )
    case 'tool-result':
      return (
        <div className="pl-5">
          <Fold
            icon={<CornerDownRight className="size-3" />}
            tone={shown.isError ? 'text-destructive' : undefined}
            label={`${shown.isError ? 'error' : 'result'} · ${shown.length.toLocaleString()} chars`}
          >
            <div className={pre}>{shown.text || '(empty)'}</div>
            {shown.truncated ? <ShowAll onClick={load} loading={loading} /> : null}
          </Fold>
        </div>
      )
    case 'injected':
      return (
        <div className="pl-5">
          <Fold icon={<Info className="size-3" />} label={`injected: ${shown.label}`}>
            <div className={pre}>{shown.text}</div>
            {shown.truncated ? <ShowAll onClick={load} loading={loading} /> : null}
          </Fold>
        </div>
      )
    case 'compact-summary':
      return (
        <div className="border border-dashed p-2">
          <Fold icon={<Info className="size-3" />} label="Compaction summary (what Claude kept after compacting)">
            <Markdown className="text-xs">{shown.text}</Markdown>
            {shown.truncated ? <ShowAll onClick={load} loading={loading} /> : null}
          </Fold>
        </div>
      )
    case 'system':
      return (
        <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span className="max-w-[70%] truncate">
            {shown.subtype.replace(/_/g, ' ')}: {shown.text}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )
  }
}
