import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Dot, PageHeader, QueryView, Tag } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type client, q, type Res } from '@/lib/api'
import { ago, bytes, shortCount, totalTokens } from '@/lib/format'

export const Route = createFileRoute('/projects/')({ component: Projects })

type Project = Res<typeof client.api.projects.$get>['projects'][number]

const h = columnHelper<Project>()
const columns = [
  h.accessor('name', {
    header: 'Project',
    cell: ({ row }) => (
      <div className="min-w-0 max-w-md">
        <div className="flex items-center gap-2">
          <Dot on={row.original.exists} title={row.original.exists ? 'exists on disk' : 'folder no longer exists'} />
          <Link
            to="/projects/$id"
            params={{ id: row.original.id }}
            className="truncate font-medium hover:underline"
            onClick={e => e.stopPropagation()}
          >
            {row.original.name}
          </Link>
        </div>
        <div className="truncate pl-4 font-mono text-[11px] text-muted-foreground">{row.original.displayPath}</div>
      </div>
    ),
  }),
  h.accessor('sessionCount', {
    header: 'Sessions',
    cell: ({ row }) =>
      row.original.sessionCount ? (
        <span className="tabular-nums">
          {row.original.sessionCount}
          {row.original.subagentCount ? (
            <span className="text-muted-foreground"> +{row.original.subagentCount}</span>
          ) : null}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  }),
  h.accessor(r => r.lastActiveAt ?? 0, {
    id: 'lastActive',
    header: 'Last active',
    cell: ({ row }) => <span className="whitespace-nowrap">{ago(row.original.lastActiveAt)}</span>,
  }),
  h.accessor('promptCount', { header: 'Prompts', cell: i => (i.getValue() ? i.getValue().toLocaleString() : '—') }),
  h.accessor('memoryCount', { header: 'Memories', cell: i => i.getValue() || '—' }),
  h.accessor(r => totalTokens(r.tokens), {
    id: 'tokens',
    header: 'Tokens',
    cell: i => (i.getValue() ? shortCount(i.getValue()) : '—'),
  }),
  h.accessor('transcriptBytes', { header: 'Transcripts', cell: i => (i.getValue() ? bytes(i.getValue()) : '—') }),
  h.display({
    id: 'config',
    header: 'Config',
    cell: ({ row: { original: p } }) => (
      <div className="flex flex-wrap gap-1">
        {p.instructionFiles.map(f => (
          <Tag key={f} tone="project">
            {f}
          </Tag>
        ))}
        {p.hasSettings ? <Tag tone="user">settings</Tag> : null}
        {p.hasMcpJson ? <Tag tone="plugin">.mcp.json</Tag> : null}
      </div>
    ),
  }),
]

type Filter = 'active' | 'all' | 'disk'

function Projects() {
  const query = useQuery(q.projects())
  const [filter, setFilter] = useState<Filter>('active')
  const navigate = useNavigate()
  const rows = useMemo(() => {
    const all = query.data?.projects ?? []
    if (filter === 'all') return all
    if (filter === 'disk') return all.filter(p => p.exists)
    return all.filter(p => p.sessionCount > 0 || p.memoryCount > 0 || p.promptCount > 0)
  }, [query.data, filter])
  return (
    <>
      <PageHeader
        title="Projects"
        description="Every folder Claude Code has worked in, merged from ~/.claude/projects, ~/.claude.json and your prompt history."
      />
      <QueryView query={query}>
        {() => (
          <DataTable
            data={rows}
            columns={columns}
            searchText={p => `${p.displayPath} ${p.name}`}
            searchPlaceholder="Filter projects…"
            initialSort={[{ id: 'lastActive', desc: true }]}
            onRowClick={p => void navigate({ to: '/projects/$id', params: { id: p.id } })}
            toolbar={
              <ToggleGroup
                value={[filter]}
                onValueChange={v => v[0] && setFilter(v[0] as Filter)}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="active">With activity</ToggleGroupItem>
                <ToggleGroupItem value="disk">On disk</ToggleGroupItem>
                <ToggleGroupItem value="all">All</ToggleGroupItem>
              </ToggleGroup>
            }
          />
        )}
      </QueryView>
    </>
  )
}
