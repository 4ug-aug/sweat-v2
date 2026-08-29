import colonyMarkSvg from './colony-mark.svg?raw'
import { cn } from '#/lib/utils'
import { useId, type CSSProperties } from 'react'

/** Stable 32-bit hash so remounts keep the same phase. */
function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

type ColonyMarkStyle = CSSProperties & {
  '--colony-mark-delay'?: string
  '--colony-mark-settle'?: string
  '--colony-mark-nibble'?: string
}

/** Colony ant mark. Use this instead of Lucide `Bot`. Keep in sync with `public/colony-mark.svg`. */
export function ColonyMark({
  className,
  style,
  seed,
}: {
  className?: string
  style?: CSSProperties
  /** Optional stable id (e.g. agent id). Mixed with React's instance id. */
  seed?: string
}) {
  const uid = useId().replaceAll(':', '')
  const hash = hashSeed(`${seed ?? ''}:${uid}`)
  const html = colonyMarkSvg
    .replaceAll('ant-body-shape', `ant-body-shape-${uid}`)
    .replaceAll('fill: #282522', 'fill: currentColor')
  const markStyle: ColonyMarkStyle = {
    ...style,
    // Negative delay starts mid-loop so marks don't wait, then chorus.
    '--colony-mark-delay': `-${hash % 6400}ms`,
    '--colony-mark-settle': `${5800 + ((hash >>> 10) % 1401)}ms`,
    '--colony-mark-nibble': `${6200 + ((hash >>> 18) % 1601)}ms`,
  }
  return (
    <span
      aria-hidden="true"
      className={cn('block shrink-0 [&_svg]:block [&_svg]:size-full', className)}
      style={markStyle}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
