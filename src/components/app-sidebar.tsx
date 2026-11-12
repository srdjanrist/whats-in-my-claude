import { Link, useRouterState } from '@tanstack/react-router'
import {
  Bot,
  Brain,
  FileText,
  FolderGit2,
  HardDrive,
  History,
  LayoutDashboard,
  ListTodo,
  type LucideIcon,
  MessagesSquare,
  Plug,
  Server,
  Settings2,
  Sparkles,
  Webhook,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: 'Work',
    items: [
      { to: '/projects', label: 'Projects', icon: FolderGit2 },
      { to: '/sessions', label: 'Sessions', icon: MessagesSquare },
      { to: '/history', label: 'Prompt history', icon: History },
      { to: '/plans', label: 'Plans', icon: ListTodo },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/memories', label: 'Memories', icon: Brain },
      { to: '/skills', label: 'Skills', icon: Sparkles },
      { to: '/agents', label: 'Agents & commands', icon: Bot },
      { to: '/plugins', label: 'Plugins', icon: Plug },
      { to: '/mcp', label: 'MCP servers', icon: Server },
      { to: '/hooks', label: 'Hooks', icon: Webhook },
      { to: '/instructions', label: 'CLAUDE.md files', icon: FileText },
      { to: '/settings', label: 'Settings', icon: Settings2 },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/storage', label: 'Storage', icon: HardDrive }],
  },
]

export function AppSidebar() {
  const pathname = useRouterState({ select: s => s.location.pathname })
  const active = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`))
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />} tooltip="What's in my Claude">
              <div className="flex aspect-square size-8 items-center justify-center bg-primary text-primary-foreground">
                <span className="text-sm font-bold">✳</span>
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">What's in my Claude</span>
                <span className="truncate text-[11px] text-muted-foreground">your Claude Code setup</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={active('/')} render={<Link to="/" />} tooltip="Overview">
                  <LayoutDashboard />
                  <span>Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {NAV.map(group => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(item => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton isActive={active(item.to)} render={<Link to={item.to} />} tooltip={item.label}>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 text-[10px] leading-relaxed text-muted-foreground group-data-[collapsible=icon]:hidden">
          Read-only · localhost only · secrets are never sent to the browser
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
