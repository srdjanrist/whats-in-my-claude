import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { Empty, Mono, PageHeader, QueryView } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { q } from '@/lib/api'
import { dateTime } from '@/lib/format'

export const Route = createFileRoute('/history')({ component: History })

const LIMIT = 50

function History() {
  const [text, setText] = useState('')
  const [project, setProject] = useState<string>('')
  const [offset, setOffset] = useState(0)
  const search = useDeferredValue(text)
  const query = useQuery(q.history({ q: search || undefined, project: project || undefined, offset, limit: LIMIT }))
  return (
    <>
      <PageHeader
        title="Prompt history"
        description="Every prompt typed into Claude Code (~/.claude/history.jsonl), newest first."
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={e => {
              setText(e.target.value)
              setOffset(0)
            }}
            placeholder="Search prompts…"
            className="pl-7"
          />
        </div>
        <Select
          value={project || '__all'}
          onValueChange={v => {
            setProject(!v || v === '__all' ? '' : String(v))
            setOffset(0)
          }}
        >
          <SelectTrigger className="w-80 max-w-full">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All projects</SelectItem>
            {(query.data?.projects ?? []).slice(0, 150).map(p => (
              <SelectItem key={p.path} value={p.path}>
                {p.display} ({p.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <QueryView query={query}>
        {data =>
          data.items.length === 0 ? (
            <Empty>No prompts match.</Empty>
          ) : (
            <div className="space-y-3">
              <div className="text-[11px] text-muted-foreground">
                {data.total.toLocaleString()} prompts · showing {offset + 1}–{Math.min(offset + LIMIT, data.total)}
              </div>
              <ul className="divide-y border">
                {data.items.map((item, i) => (
                  <li key={`${item.at}-${i}`} className="space-y-1 p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                      <span>{dateTime(item.at)}</span>
                      <Mono>{item.displayProject}</Mono>
                      {item.pastes ? <span>{item.pastes} pasted</span> : null}
                      {item.sessionId ? (
                        <Link to="/sessions/$id" params={{ id: item.sessionId }} className="ml-auto underline">
                          session
                        </Link>
                      ) : null}
                    </div>
                    <div className="whitespace-pre-wrap break-words">{item.display}</div>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                >
                  ← Newer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + LIMIT >= data.total}
                  onClick={() => setOffset(offset + LIMIT)}
                >
                  Older →
                </Button>
              </div>
            </div>
          )
        }
      </QueryView>
    </>
  )
}
