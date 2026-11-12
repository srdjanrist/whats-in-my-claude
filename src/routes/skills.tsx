import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Link2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { KeyValues, Mono, PageHeader, QueryView, Tag } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { DetailSheet } from '@/components/detail-sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SkillViewer } from '@/components/viewers'
import { type client, q, type Res } from '@/lib/api'
import { ago, date } from '@/lib/format'

export const Route = createFileRoute('/skills')({
  component: Skills,
  validateSearch: (s: Record<string, unknown>): { open?: string } =>
    typeof s.open === 'string' ? { open: s.open } : {},
})

type Skill = Res<typeof client.api.skills.$get>['skills'][number]

const SOURCE_LABEL: Record<string, string> = {
  user: '~/.claude/skills',
  agents: '~/.agents/skills',
  'claude-ai': 'claude.ai',
  plugin: 'plugin',
  project: 'project',
}

const h = columnHelper<Skill>()
const columns = [
  h.accessor('qualifiedName', {
    header: 'Skill',
    cell: ({ row: { original: s } }) => (
      <div className="max-w-2xl min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 font-medium">
          {s.qualifiedName}
          {s.isSymlink ? (
            <span title={`symlink → ${s.symlinkTarget}`}>
              <Link2 className="size-3 text-muted-foreground" />
            </span>
          ) : null}
          {s.broken ? <Tag tone="security">broken</Tag> : null}
          {s.duplicates ? <Tag tone="warning">{`${s.duplicates + 1} copies`}</Tag> : null}
        </div>
        <div className="line-clamp-2 text-[11px] text-muted-foreground">{s.description}</div>
      </div>
    ),
  }),
  h.accessor('source', {
    header: 'Source',
    cell: ({ row: { original: s } }) => (
      <div className="space-y-0.5">
        <Tag tone={s.source}>{SOURCE_LABEL[s.source] ?? s.source}</Tag>
        {s.owner && s.source !== 'claude-ai' ? (
          <div className="max-w-48 truncate font-mono text-[10px] text-muted-foreground">{s.owner}</div>
        ) : null}
      </div>
    ),
  }),
  h.accessor('usageCount', { header: 'Uses', cell: i => i.getValue() || '—' }),
  h.accessor(r => r.lastUsedAt ?? 0, {
    id: 'lastUsed',
    header: 'Last used',
    cell: i => (i.getValue() ? ago(i.getValue()) : '—'),
  }),
  h.accessor('fileCount', {
    header: 'Files',
    cell: ({ row: { original: s } }) => (
      <span title={s.extras.join(', ')}>
        {s.fileCount}
        {s.extras.length ? <span className="text-muted-foreground"> · {s.extras.slice(0, 3).join(', ')}</span> : null}
      </span>
    ),
  }),
]

const SOURCES = ['all', 'user', 'agents', 'claude-ai', 'plugin', 'project'] as const

function Skills() {
  const query = useQuery(q.skills())
  const { open } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [source, setSource] = useState<(typeof SOURCES)[number]>('all')
  const rows = useMemo(
    () => (query.data?.skills ?? []).filter(s => source === 'all' || s.source === source),
    [query.data, source],
  )
  const selected = query.data?.skills.find(s => s.id === open)
  return (
    <>
      <PageHeader
        title="Skills"
        description="From ~/.claude/skills, ~/.agents/skills, claude.ai, installed plugins and your projects' .claude/skills. Usage counts come from ~/.claude.json."
      />
      <QueryView query={query}>
        {data => (
          <DataTable
            data={rows}
            columns={columns}
            searchText={s => `${s.qualifiedName} ${s.description ?? ''} ${s.owner ?? ''}`}
            searchPlaceholder="Filter skills…"
            initialSort={[{ id: 'usageCount', desc: true }]}
            onRowClick={s => void navigate({ search: { open: s.id } })}
            toolbar={
              <ToggleGroup
                value={[source]}
                onValueChange={v => v[0] && setSource(v[0] as typeof source)}
                variant="outline"
                size="sm"
              >
                {SOURCES.map(s => (
                  <ToggleGroupItem key={s} value={s}>
                    {s === 'all' ? 'all' : (SOURCE_LABEL[s] ?? s)} (
                    {s === 'all' ? data.skills.length : data.skills.filter(x => x.source === s).length})
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            }
          />
        )}
      </QueryView>
      <DetailSheet
        open={!!open}
        onClose={() => void navigate({ search: {} })}
        title={selected?.qualifiedName ?? 'Skill'}
        description={selected?.description}
      >
        {selected ? (
          <KeyValues
            items={[
              [
                'source',
                <Tag key="s" tone={selected.source}>
                  {SOURCE_LABEL[selected.source] ?? selected.source}
                </Tag>,
              ],
              ['folder', <Mono key="d">{selected.dir}</Mono>],
              ...(selected.isSymlink
                ? ([['symlink to', <Mono key="l">{selected.symlinkTarget}</Mono>]] as [string, React.ReactNode][])
                : []),
              ['real path', <Mono key="r">{selected.realPath}</Mono>],
              ['uses', `${selected.usageCount}${selected.lastUsedAt ? ` · last ${date(selected.lastUsedAt)}` : ''}`],
              [
                'allowed tools',
                selected.allowedTools.length ? <Mono key="t">{selected.allowedTools.join(', ')}</Mono> : 'any',
              ],
              ...(selected.lock
                ? ([['installed from', <Mono key="i">{selected.lock.sourceUrl ?? selected.lock.source}</Mono>]] as [
                    string,
                    React.ReactNode,
                  ][])
                : []),
            ]}
          />
        ) : null}
        {open ? <SkillViewer id={open} /> : null}
      </DetailSheet>
    </>
  )
}
