import { cn } from '#/lib/utils'
import { Globe, SquareTerminal, Wrench, type LucideIcon } from 'lucide-react'
import {
  siAsana,
  siGithub,
  siGrafana,
  siLinear,
  siOutline,
  siPostgresql,
} from 'simple-icons'

const BRAND_PATHS: Record<string, string> = {
  asana: siAsana.path,
  github: siGithub.path,
  grafana: siGrafana.path,
  linear: siLinear.path,
  outline: siOutline.path,
  postgres: siPostgresql.path,
}

const LUCIDE_ICONS: Record<string, LucideIcon> = {
  shell: SquareTerminal,
  web: Globe,
}

function normalizeTool(tool?: string): string {
  return (tool ?? '').trim().toLowerCase()
}

function prefixed(name: string, prefix: string): boolean {
  return (
    name === prefix ||
    name.startsWith(`${prefix}.`) ||
    name.startsWith(`${prefix}_`)
  )
}

export function toolIconId(tool?: string): string {
  const name = normalizeTool(tool)
  if (!name) return 'wrench'
  if (prefixed(name, 'workspace')) return 'workspace'
  const brand = Object.keys(BRAND_PATHS).find((id) => prefixed(name, id))
  if (brand) return brand
  const lucide = Object.keys(LUCIDE_ICONS).find((id) => prefixed(name, id))
  if (lucide) return lucide
  return 'wrench'
}

function BrandGlyph({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('size-3.5 shrink-0 fill-current', className)}
      viewBox="0 0 24 24"
    >
      <path d={path} />
    </svg>
  )
}

export function ToolIcon({
  tool,
  className,
}: {
  tool?: string
  className?: string
}) {
  const id = toolIconId(tool)
  if (id === 'workspace') {
    return (
      <img
        src="/app-icon.png"
        alt=""
        className={cn('size-3.5 shrink-0 dark:invert', className)}
      />
    )
  }
  const brandPath = BRAND_PATHS[id]
  if (brandPath) return <BrandGlyph path={brandPath} className={className} />
  const Icon = LUCIDE_ICONS[id] ?? Wrench
  return (
    <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', className)} />
  )
}
