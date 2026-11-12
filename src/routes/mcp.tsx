import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Dot, Mono, PageHeader, QueryView, StatCard, Tag } from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type client, q, type Res } from '@/lib/api'

export const Route = createFileRoute('/mcp')({ component: Mcp })

type Server = Res<typeof client.api.mcp.$get>['servers'][number]

const SCOPE_HELP: Record<string, string> = {
  user: '~/.claude.json → mcpServers (every project)',
  local: '~/.claude.json → projects[path].mcpServers (one project, not shared)',
  project: '.mcp.json in the project (shared through git)',
  plugin: 'shipped by an installed plugin',
  'claude-ai': 'claude.ai connector you have connected',
}

const h = columnHelper<Server>()
const columns = [
  h.accessor('name', {
    header: 'Server',
    cell: ({ row: { original: s } }) => (
      <div className="flex items-center gap-2">
        <Dot
          on={s.enabled}
          title={s.enabled === null ? 'not decided (would prompt)' : s.enabled ? 'enabled' : 'disabled'}
        />
        <span className="font-medium">{s.name}</span>
        {s.inlineSecrets.length ? (
          <span title={`inline: ${s.inlineSecrets.map(x => `${x.field}.${x.key}`).join(', ')}`}>
            <ShieldAlert className="size-3.5 text-destructive" />
          </span>
        ) : null}
      </div>
    ),
  }),
  h.accessor('scope', {
    header: 'Scope',
    cell: i => (
      <span title={SCOPE_HELP[i.getValue()]}>
        <Tag tone={i.getValue()}>{i.getValue()}</Tag>
      </span>
    ),
  }),
  h.accessor('origin', {
    header: 'Defined in',
    cell: i => <Mono className="block max-w-64 truncate">{i.getValue()}</Mono>,
  }),
  h.accessor('transport', { header: 'Transport' }),
  h.accessor(r => r.url ?? [r.command, ...r.args].join(' '), {
    id: 'target',
    header: 'Command / URL',
    cell: i => <Mono className="line-clamp-2 max-w-md break-all">{i.getValue()}</Mono>,
  }),
  h.accessor(r => [...r.envKeys, ...r.headerKeys].length, {
    id: 'env',
    header: 'env / headers',
    cell: ({ row: { original: s } }) => (
      <div className="flex max-w-56 flex-wrap gap-1">
        {s.envKeys.map(k => (
          <Tag key={k} tone={s.inlineSecrets.some(x => x.key === k) ? 'security' : 'user'}>
            {k}
          </Tag>
        ))}
        {s.headerKeys.map(k => (
          <Tag key={k} tone="agents">
            {k}
          </Tag>
        ))}
      </div>
    ),
  }),
]

const SCOPES = ['all', 'user', 'local', 'project', 'plugin', 'claude-ai'] as const

function Mcp() {
  const query = useQuery(q.mcp())
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('all')
  const rows = useMemo(
    () => (query.data?.servers ?? []).filter(s => scope === 'all' || s.scope === scope),
    [query.data, scope],
  )
  return (
    <>
      <PageHeader
        title="MCP servers"
        description="Every MCP server Claude Code can load, by scope. Values of env vars and headers never leave the server: only their names are shown."
      />
      <QueryView query={query}>
        {data => (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {SCOPES.filter(s => s !== 'all').map(s => (
                <StatCard
                  key={s}
                  label={s}
                  value={data.servers.filter(x => x.scope === s).length}
                  hint={SCOPE_HELP[s]}
                />
              ))}
              <StatCard
                label="inline secrets"
                value={data.servers.filter(s => s.inlineSecrets.length).length}
                hint="literal credentials in config"
              />
            </div>
            <DataTable
              data={rows}
              columns={columns}
              searchText={s => `${s.name} ${s.origin} ${s.url ?? ''} ${s.command ?? ''}`}
              initialSort={[{ id: 'scope', desc: false }]}
              toolbar={
                <ToggleGroup
                  value={[scope]}
                  onValueChange={v => v[0] && setScope(v[0] as typeof scope)}
                  variant="outline"
                  size="sm"
                >
                  {SCOPES.map(s => (
                    <ToggleGroupItem key={s} value={s}>
                      {s}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              }
            />
          </>
        )}
      </QueryView>
    </>
  )
}
