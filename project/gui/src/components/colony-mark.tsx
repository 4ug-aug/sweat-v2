import colonyMarkSvg from './colony-mark.svg?raw'
import { cn } from '#/lib/utils'
import { useId, type CSSProperties } from 'react'

/** Colony ant mark. Use this instead of Lucide `Bot`. Keep in sync with `public/colony-mark.svg`. */
export function ColonyMark({
  className,
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  const uid = useId().replaceAll(':', '')
  const html = colonyMarkSvg
    .replaceAll('ant-body-shape', `ant-body-shape-${uid}`)
    .replaceAll('fill: #282522', 'fill: currentColor')
  return (
    <span
      aria-hidden="true"
      className={cn('block shrink-0 [&_svg]:block [&_svg]:size-full', className)}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
