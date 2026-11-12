import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Bot,
  Brain,
  FileText,
  FolderGit2,
  HardDrive,
  History,
  ListTodo,
  MessagesSquare,
  Plug,
  Server,
  ShieldAlert,
  Sparkles,
  Webhook,
} from 'lucide-react'
import { BarList, Dot, Empty, PageHeader, QueryView, Section, StatCard, Tag } from '@/components/common'
import { Heatmap } from '@/components/heatmap'
import { type client, q, type Res } from '@/lib/api'
import { ago, bytes, date, duration, modelLabel, shortCount } from '@/lib/format'

export const Route = createFileRoute('/')({ component: Overview })

type OverviewData = Res<typeof client.api.overview.$get>

function Overview() {
  const query = useQuery(q.overview())
  return (
    <>
      <PageHeader
        title="Overview"
        description="Everything Claude Code keeps on this machine: ~/.claude, ~/.claude.json and the .claude folders of your projects. Read-only."
      />
      <QueryView query={query}>{data => <OverviewBody data={data} />}</QueryView>
    </>
  )
}

function OverviewBody({ data }: { data: OverviewData }) {
  const c = data.counts
  const t = data.tokens
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Projects"
          value={c.projectsWithSessions}
          hint={`with sessions · ${c.projects} known`}
          icon={FolderGit2}
          to="/projects"
        />
        <StatCard
          label="Sessions"
          value={c.sessions}
          hint={`+ ${c.subagents} subagent runs`}
          icon={MessagesSquare}
          to="/sessions"
        />
        <StatCard label="Prompts" value={shortCount(c.prompts)} hint="in history.jsonl" icon={History} to="/history" />
        <StatCard
          label="Memories"
          value={c.memories}
          hint={`in ${c.memoryDirs} projects`}
          icon={Brain}
          to="/memories"
        />
        <StatCard
          label="Skills"
          value={c.uniqueSkills}
          hint={`${c.skills} incl. copies`}
          icon={Sparkles}
          to="/skills"
        />
        <StatCard
          label="Agents · commands"
          value={`${c.agents} · ${c.commands}`}
          hint="user, plugin & project"
          icon={Bot}
          to="/agents"
        />
        <StatCard
          label="Plugins"
          value={`${c.pluginsEnabled}/${c.plugins}`}
          hint={`enabled · ${c.marketplaces} marketplace${c.marketplaces === 1 ? '' : 's'}`}
          icon={Plug}
          to="/plugins"
        />
        <StatCard label="MCP servers" value={c.mcpServers} hint="all scopes" icon={Server} to="/mcp" />
        <StatCard label="Hooks" value={c.hooks} hint={`${c.hookEvents} events`} icon={Webhook} to="/hooks" />
        <StatCard
          label="CLAUDE.md files"
          value={c.instructionFiles}
          hint="global + projects"
          icon={FileText}
          to="/instructions"
        />
        <StatCard label="Plans" value={c.plans} hint="plan mode" icon={ListTodo} to="/plans" />
        <StatCard label="~/.claude" value={bytes(data.storage.total)} hint="on disk" icon={HardDrive} to="/storage" />
      </div>

      <Section title="Prompt activity" description="Every prompt you typed, from ~/.claude/history.jsonl.">
        <Heatmap days={data.activity} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Tokens by model"
          description={
            t.indexedFiles < t.totalFiles
              ? `From ${t.indexedFiles} of ${t.totalFiles} transcripts; the rest (often sessions running right now) are picked up shortly.`
              : `From all ${t.totalFiles} transcripts (sessions + subagents), each response counted once.`
          }
        >
          {t.byModel.length === 0 ? (
            <Empty>No indexed transcripts yet.</Empty>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <Metric label="output" value={shortCount(t.totals.output)} />
                <Metric label="input" value={shortCount(t.totals.input)} />
                <Metric label="cache read" value={shortCount(t.totals.cacheRead)} />
                <Metric label="cache write" value={shortCount(t.totals.cacheWrite)} />
              </div>
              <BarList
                items={t.byModel.map(m => ({
                  key: m.model,
                  label: (
                    <span>
                      {modelLabel(m.model)}{' '}
                      <span className="text-muted-foreground">· {m.messages.toLocaleString()} responses</span>
                    </span>
                  ),
                  value: m.output,
                }))}
                format={v => `${shortCount(v)} out`}
              />
              <p className="text-[11px] text-muted-foreground">
                {t.prompts.toLocaleString()} prompts · {duration(t.workMs)} of Claude working time
              </p>
            </div>
          )}
        </Section>
        <Section title="Most used tools" description="Tool calls across all indexed transcripts.">
          {t.topTools.length === 0 ? (
            <Empty>No tool calls indexed yet.</Empty>
          ) : (
            <BarList
              items={t.topTools.map(x => ({
                key: x.tool,
                label: <span className="font-mono">{x.tool}</span>,
                value: x.count,
              }))}
            />
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section
          className="lg:col-span-2"
          title={
            <span className="flex items-center gap-2">
              <ShieldAlert className="size-4" /> Things worth a look
            </span>
          }
          description={`${data.warnings.length} findings`}
        >
          {data.warnings.length === 0 ? (
            <Empty>All clear.</Empty>
          ) : (
            <ul className="divide-y">
              {data.warnings.map(w => (
                <li key={w.id} className="flex gap-3 py-2.5 text-xs">
                  <Tag tone={w.severity}>{w.severity}</Tag>
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-medium">
                      {w.link ? (
                        <Link to={w.link} className="hover:underline">
                          {w.title}
                        </Link>
                      ) : (
                        w.title
                      )}
                    </div>
                    <div className="break-words text-muted-foreground">{w.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="space-y-6">
          <Section title="Recent sessions">
            <ul className="space-y-2 text-xs">
              {data.recentSessions.map(s => (
                <li key={s.id} className="min-w-0">
                  <Link to="/sessions/$id" params={{ id: s.id }} className="block truncate font-medium hover:underline">
                    {s.title ?? s.id}
                  </Link>
                  <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{s.cwd}</span>
                    <span className="shrink-0">{ago(s.lastAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Running now" description={`${data.running.length} Claude Code processes`}>
            {data.running.length === 0 ? (
              <Empty>Nothing running.</Empty>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
                {data.running.map(s => (
                  <li key={s.pid} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                    <Dot on={s.status === 'busy'} title={s.status ?? undefined} />
                    <span className="truncate">{s.name ?? s.sessionId}</span>
                    <span
                      className="truncate text-right text-[11px] text-muted-foreground"
                      title={s.displayCwd ?? undefined}
                    >
                      {s.displayCwd}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Disk usage of ~/.claude"
          actions={
            <Link to="/storage" className="text-xs underline">
              details
            </Link>
          }
        >
          <BarList
            items={data.storage.entries.map(e => ({ key: e.name, label: e.name, value: e.bytes }))}
            format={bytes}
          />
        </Section>
        <Section title="Install">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Metric label="Claude Code version" value={data.install.latestVersion ?? '—'} />
            <Metric label="install method" value={data.install.installMethod ?? '—'} />
            <Metric label="startups" value={data.install.numStartups?.toLocaleString() ?? '—'} />
            <Metric label="first used" value={date(data.install.firstStartTime)} />
          </div>
          {data.claudeStatsCache ? (
            <p className="mt-4 text-[11px] text-muted-foreground">
              Claude Code's own stats-cache.json says {data.claudeStatsCache.totalSessions?.toLocaleString()} sessions
              and {data.claudeStatsCache.totalMessages?.toLocaleString()} messages, as of{' '}
              {data.claudeStatsCache.lastComputedDate}.
            </p>
          ) : null}
        </Section>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}
