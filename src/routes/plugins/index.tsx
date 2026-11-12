import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Dot, Mono, PageHeader, QueryView, Section, Tag } from '@/components/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { q } from '@/lib/api'
import { ago, date, shortCount } from '@/lib/format'

export const Route = createFileRoute('/plugins/')({ component: Plugins })

function Plugins() {
  const query = useQuery(q.plugins())
  return (
    <>
      <PageHeader
        title="Plugins"
        description="Installed plugins (~/.claude/plugins/installed_plugins.json), whether they are enabled, and what each one adds to Claude Code."
      />
      <QueryView query={query}>
        {data => (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.plugins.map(p => {
                const c = p.components
                const parts = [
                  [c.skills.length, 'skills'],
                  [c.agents.length, 'agents'],
                  [c.commands.length, 'commands'],
                  [c.hooks.length, 'hooks'],
                  [c.mcpServers.length, 'MCP'],
                  [c.lspServers.length, 'LSP'],
                ] as const
                return (
                  <Link key={p.id} to="/plugins/$id" params={{ id: p.id }} className="block">
                    <Card className="h-full hover:bg-muted/40">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Dot on={p.enabled} title={p.enabled ? 'enabled' : 'not enabled'} />
                          {p.name}
                          <span className="font-normal text-muted-foreground">v{p.version}</span>
                          <span className="ml-auto">
                            <Tag tone={p.scope === 'project' ? 'project' : 'user'}>{p.scope}</Tag>
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="line-clamp-3 text-muted-foreground">{p.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {parts
                            .filter(([n]) => n > 0)
                            .map(([n, label]) => (
                              <Tag key={label} tone="plugin">
                                {n} {label}
                              </Tag>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                          <span>installed {date(p.installedAt)}</span>
                          {p.usage ? (
                            <span>
                              used {p.usage.usageCount}× · {ago(p.usage.lastUsedAt)}
                            </span>
                          ) : null}
                          {p.contextTokens ? (
                            <span>~{shortCount(p.contextTokens.alwaysOn)} tok always loaded</span>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
            <Section title="Marketplaces">
              <ul className="space-y-2 text-xs">
                {data.marketplaces.map(m => (
                  <li key={m.name} className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{m.name}</span>
                    <Mono>{m.source}</Mono>
                    {m.pluginCount ? (
                      <span className="text-muted-foreground">{m.pluginCount} plugins listed</span>
                    ) : null}
                    <span className="text-muted-foreground">
                      updated {ago(m.lastUpdated ? Date.parse(m.lastUpdated) : null)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </QueryView>
    </>
  )
}
