// Typed API client (Hono RPC: request and response types come straight from
// server/app.ts) and the TanStack Query options for every endpoint.
import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { type ClientResponse, hc } from 'hono/client'
import type { AppType } from '../../server/app.ts'

export const client = hc<AppType>('/')
const api = client.api

type ErrorBody = { error: 'not-found' } | { error: 'bad-request'; issues: number }
/** The JSON body of a successful response (error shapes removed). */
export type Data<R> = R extends ClientResponse<infer T, number, 'json'> ? Exclude<T, ErrorBody> : never

export class ApiError extends Error {
  readonly status: number
  constructor(status: number) {
    super(status === 404 ? 'Not found' : `Request failed (${status})`)
    this.status = status
  }
}

async function ok<R extends ClientResponse<unknown, number, 'json'>>(request: Promise<R>): Promise<Data<R>> {
  const res = await request
  if (!res.ok) throw new ApiError(res.status)
  return (await res.json()) as Data<R>
}

export const q = {
  overview: () =>
    queryOptions({
      queryKey: ['overview'],
      queryFn: () => ok(api.overview.$get()),
    }),
  indexStatus: () =>
    queryOptions({
      queryKey: ['index-status'],
      queryFn: () => ok(api.index.status.$get()),
    }),
  projects: () =>
    queryOptions({
      queryKey: ['projects'],
      queryFn: () => ok(api.projects.$get()),
    }),
  project: (id: string) =>
    queryOptions({
      queryKey: ['project', id],
      queryFn: () => ok(api.projects[':id'].$get({ param: { id } })),
    }),
  projectGraph: (id: string) =>
    queryOptions({
      queryKey: ['project-graph', id],
      queryFn: () => ok(api.projects[':id'].graph.$get({ param: { id } })),
      // Usage fills in while the background index runs.
      refetchInterval: query => (query.state.data?.coverage.indexing ? 3000 : false),
    }),
  sessions: () =>
    queryOptions({
      queryKey: ['sessions'],
      queryFn: () => ok(api.sessions.$get({ query: {} })),
    }),
  session: (id: string) =>
    queryOptions({
      queryKey: ['session', id],
      queryFn: () => ok(api.sessions[':id'].$get({ param: { id } })),
    }),
  conversation: (id: string, agent: string | undefined, offset: number, limit: number) =>
    queryOptions({
      queryKey: ['conversation', id, agent ?? '', offset, limit],
      queryFn: () =>
        ok(
          api.sessions[':id'].conversation.$get({
            param: { id },
            query: {
              offset: String(offset),
              limit: String(limit),
              ...(agent ? { agent } : {}),
            },
          }),
        ),
      placeholderData: keepPreviousData,
    }),
  memories: () =>
    queryOptions({
      queryKey: ['memories'],
      queryFn: () => ok(api.memories.$get()),
    }),
  memory: (projectId: string, file: string) =>
    queryOptions({
      queryKey: ['memory', projectId, file],
      queryFn: () =>
        ok(
          api.memories[':projectId'][':file'].$get({
            param: { projectId, file },
          }),
        ),
    }),
  skills: () =>
    queryOptions({
      queryKey: ['skills'],
      queryFn: () => ok(api.skills.$get()),
    }),
  skillContent: (id: string) =>
    queryOptions({
      queryKey: ['skill-content', id],
      queryFn: () => ok(api.skills.content.$get({ query: { id } })),
    }),
  agents: () =>
    queryOptions({
      queryKey: ['agents'],
      queryFn: () => ok(api.agents.$get()),
    }),
  agentContent: (id: string) =>
    queryOptions({
      queryKey: ['agent-content', id],
      queryFn: () => ok(api.agents.content.$get({ query: { id } })),
    }),
  plugins: () =>
    queryOptions({
      queryKey: ['plugins'],
      queryFn: () => ok(api.plugins.$get()),
    }),
  mcp: () => queryOptions({ queryKey: ['mcp'], queryFn: () => ok(api.mcp.$get()) }),
  hooks: () => queryOptions({ queryKey: ['hooks'], queryFn: () => ok(api.hooks.$get()) }),
  settings: () =>
    queryOptions({
      queryKey: ['settings'],
      queryFn: () => ok(api.settings.$get()),
    }),
  instructions: () =>
    queryOptions({
      queryKey: ['instructions'],
      queryFn: () => ok(api.instructions.$get()),
    }),
  instructionContent: (path: string) =>
    queryOptions({
      queryKey: ['instruction-content', path],
      queryFn: () => ok(api.instructions.content.$get({ query: { path } })),
    }),
  plans: () => queryOptions({ queryKey: ['plans'], queryFn: () => ok(api.plans.$get()) }),
  plan: (slug: string) =>
    queryOptions({
      queryKey: ['plan', slug],
      queryFn: () => ok(api.plans[':slug'].$get({ param: { slug } })),
    }),
  history: (params: { q?: string; project?: string; offset: number; limit: number }) =>
    queryOptions({
      queryKey: ['history', params],
      queryFn: () =>
        ok(
          api.history.$get({
            query: {
              ...(params.q ? { q: params.q } : {}),
              ...(params.project ? { project: params.project } : {}),
              offset: String(params.offset),
              limit: String(params.limit),
            },
          }),
        ),
      placeholderData: keepPreviousData,
    }),
  storage: () =>
    queryOptions({
      queryKey: ['storage'],
      queryFn: () => ok(api.storage.$get()),
    }),
  runtime: () =>
    queryOptions({
      queryKey: ['runtime'],
      queryFn: () => ok(api.runtime.$get()),
    }),
  search: (text: string) =>
    queryOptions({
      queryKey: ['search', text],
      queryFn: () => ok(api.search.$get({ query: { q: text } })),
      enabled: text.trim().length >= 2,
      placeholderData: keepPreviousData,
    }),
}

/** Fetches one conversation entry with its full text (for "show all"). */
export function fetchEntry(id: string, index: number, agent?: string) {
  return ok(
    api.sessions[':id'].entry[':index'].$get({
      param: { id, index: String(index) },
      query: agent ? { agent } : {},
    }),
  )
}

/** The success body type of an API call, e.g. Res<typeof client.api.projects.$get>. */
// biome-ignore lint/suspicious/noExplicitAny: any client function signature
export type Res<F extends (...args: any[]) => Promise<unknown>> = Data<Awaited<ReturnType<F>>>

export function fetchConversation(id: string, agent: string | undefined, offset: number, limit: number) {
  return ok(
    api.sessions[':id'].conversation.$get({
      param: { id },
      query: { offset: String(offset), limit: String(limit), ...(agent ? { agent } : {}) },
    }),
  )
}
