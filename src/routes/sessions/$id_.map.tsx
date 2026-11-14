// /sessions/<id>/map: a session's subagents and files on one timeline. The
// trailing underscore in the file name makes this a page of its own rather
// than a child of the session page. What's selected lives in the URL
// (?agent= or ?file=), so reload, back/forward and saved links keep it.
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Loading, Mono, PageHeader, QueryView } from '@/components/common'
import { SessionMap } from '@/components/session-map'
import type { Selection } from '@/components/session-timeline'
import { Button } from '@/components/ui/button'
import { q } from '@/lib/api'

export const Route = createFileRoute('/sessions/$id_/map')({
  component: SessionMapPage,
  validateSearch: (s: Record<string, unknown>): { agent?: string; file?: string } =>
    typeof s.agent === 'string' ? { agent: s.agent } : typeof s.file === 'string' ? { file: s.file } : {},
})

function SessionMapPage() {
  const { id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const query = useQuery(q.sessionMap(id))
  const selection: Selection = search.agent ? { agent: search.agent } : search.file ? { file: search.file } : null
  // Back to the session, on the selected subagent's transcript.
  const back = search.agent && search.agent !== 'main' ? { agent: search.agent } : {}
  const session = query.data?.session
  return (
    <>
      <PageHeader
        title="Session map"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link to="/sessions/$id" params={{ id }} className="hover:underline">
              {session?.title ?? id}
            </Link>
            {session?.displayCwd ? <Mono>{session.displayCwd}</Mono> : null}
          </span>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/sessions/$id" params={{ id }} search={back} />}
          >
            <ArrowLeft />
            Back to session
          </Button>
        }
      />
      <QueryView query={query} loading={<Loading label="Reading the session and its subagents…" />}>
        {data => (
          <SessionMap
            data={data}
            selection={selection}
            onSelect={sel => void navigate({ search: sel ?? {}, resetScroll: false })}
          />
        )}
      </QueryView>
    </>
  )
}
