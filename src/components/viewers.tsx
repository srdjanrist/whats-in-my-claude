// Detail views shared by several pages: a memory file, a skill/agent/command
// file, a CLAUDE.md, a plan.
import { useQuery } from '@tanstack/react-query'
import { KeyValues, Mono, QueryView, Tag } from '@/components/common'
import { Frontmatter, Markdown } from '@/components/markdown'
import { q } from '@/lib/api'
import { bytes, dateTime } from '@/lib/format'

export function MemoryViewer({ projectId, file }: { projectId: string; file: string }) {
  const query = useQuery(q.memory(projectId, file))
  return (
    <QueryView query={query}>
      {m => (
        <>
          <Mono>{m.path}</Mono>
          <Frontmatter data={m.frontmatter} />
          <Markdown>{m.body}</Markdown>
        </>
      )}
    </QueryView>
  )
}

export function SkillViewer({ id }: { id: string }) {
  const query = useQuery(q.skillContent(id))
  return (
    <QueryView query={query}>
      {s => (
        <>
          <Mono>{s.file}</Mono>
          <Frontmatter data={s.frontmatter} />
          <Markdown>{s.body}</Markdown>
        </>
      )}
    </QueryView>
  )
}

export function AgentViewer({ id }: { id: string }) {
  const query = useQuery(q.agentContent(id))
  return (
    <QueryView query={query}>
      {s => (
        <>
          <Mono>{s.file}</Mono>
          <Frontmatter data={s.frontmatter} />
          <Markdown>{s.body}</Markdown>
        </>
      )}
    </QueryView>
  )
}

export function InstructionViewer({ path }: { path: string }) {
  const query = useQuery(q.instructionContent(path))
  return (
    <QueryView query={query}>
      {f => (
        <>
          <KeyValues
            items={[
              ['file', <Mono key="f">{f.displayPath}</Mono>],
              ['size', `${f.lines.toLocaleString()} lines · ${bytes(f.bytes)}`],
              [
                'imports',
                f.imports.length ? (
                  <div key="i" className="flex flex-wrap gap-1">
                    {f.imports.map(i => (
                      <Tag key={i} tone="user">
                        @{i}
                      </Tag>
                    ))}
                  </div>
                ) : (
                  'none'
                ),
              ],
            ]}
          />
          <Markdown>{f.content}</Markdown>
        </>
      )}
    </QueryView>
  )
}

export function PlanViewer({ slug }: { slug: string }) {
  const query = useQuery(q.plan(slug))
  return (
    <QueryView query={query}>
      {p => (
        <>
          <Mono>
            {p.file} · {dateTime(p.modifiedAt)} · {bytes(p.bytes)}
          </Mono>
          <Markdown>{p.content}</Markdown>
        </>
      )}
    </QueryView>
  )
}
