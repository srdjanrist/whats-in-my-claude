import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { Mono, PageHeader, QueryView } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { type client, q, type Res } from '@/lib/api'
import { ago, bytes, duration, modelLabel, shortCount, totalTokens, usd } from '@/lib/format'

export const Route = createFileRoute('/sessions/')({
  component: Sessions,
  validateSearch: (s: Record<string, unknown>): { project?: string } =>
    typeof s.project === 'string' ? { project: s.project } : {},
})

type Session = Res<typeof client.api.sessions.$get>['sessions'][number]

const h = columnHelper<Session>()
const columns = [
  h.accessor(r => r.title ?? r.id, {
    id: 'title',
    header: 'Session',
    cell: ({ row: { original: s } }) => (
      <div className="max-w-xl min-w-0">
        <Link
          to="/sessions/$id"
          params={{ id: s.id }}
          className="block truncate font-medium hover:underline"
          onClick={e => e.stopPropagation()}
        >
          {s.title ?? s.id}
        </Link>
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {s.displayCwd}
          {s.gitBranch ? ` · ${s.gitBranch}` : ''}
        </div>
      </div>
    ),
  }),
  h.accessor('lastAt', {
    header: 'Last active',
    cell: i => <span className="whitespace-nowrap">{ago(i.getValue())}</span>,
  }),
  h.accessor(r => (r.startedAt ? r.lastAt - r.startedAt : 0), {
    id: 'span',
    header: 'Span',
    cell: i => (i.getValue() ? duration(i.getValue()) : '—'),
  }),
  h.accessor(r => r.stats?.prompts ?? -1, {
    id: 'prompts',
    header: 'Prompts',
    cell: i => (i.getValue() >= 0 ? i.getValue() : '…'),
  }),
  h.accessor(r => totalTokens(r.stats?.tokens), {
    id: 'tokens',
    header: 'Tokens',
    cell: ({ row: { original: s } }) =>
      s.stats ? (
        <span className="whitespace-nowrap">
          {shortCount(totalTokens(s.stats.tokens))}
          <span className="text-muted-foreground"> · {s.stats.models.map(modelLabel).join(', ')}</span>
        </span>
      ) : (
        '…'
      ),
  }),
  h.accessor(r => r.stats?.costUSD ?? 0, {
    id: 'cost',
    header: 'Cost',
    cell: i => (i.getValue() ? usd(i.getValue()) : '—'),
  }),
  h.accessor('subagents', { header: 'Agents', cell: i => i.getValue() || '—' }),
  h.accessor('size', { header: 'Size', cell: i => bytes(i.getValue()) }),
]

function Sessions() {
  const { project } = Route.useSearch()
  const navigate = useNavigate()
  const query = useQuery(q.sessions())
  const rows = useMemo(
    () => (query.data?.sessions ?? []).filter(s => !project || s.projectDir === project),
    [query.data, project],
  )
  return (
    <>
      <PageHeader
        title="Sessions"
        description="Every transcript in ~/.claude/projects. Titles come from Claude's own session titles; token totals count each response once."
        actions={
          project ? (
            <Button variant="outline" size="sm" onClick={() => void navigate({ to: '/sessions', search: {} })}>
              Project: <Mono>{project}</Mono> ✕
            </Button>
          ) : null
        }
      />
      <QueryView query={query}>
        {() => (
          <DataTable
            data={rows}
            columns={columns}
            searchText={s => `${s.title ?? ''} ${s.prompt ?? ''} ${s.displayCwd ?? ''} ${s.id}`}
            searchPlaceholder="Filter by title, prompt, folder or id…"
            initialSort={[{ id: 'lastAt', desc: true }]}
            onRowClick={s => void navigate({ to: '/sessions/$id', params: { id: s.id } })}
          />
        )}
      </QueryView>
    </>
  )
}
