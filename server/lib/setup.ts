// The shared context most views need: known projects (and the roots that
// exist on disk, whose .claude folders are scanned) and installed plugins.
import { readPlugins } from './plugins.ts'
import { readProjects } from './projects.ts'

export async function setupContext() {
  const projects = await readProjects()
  const roots = projects.filter(p => p.exists && p.path).map(p => p.path as string)
  const { plugins, marketplaces } = await readPlugins(roots)
  return { projects, roots, plugins, marketplaces }
}
