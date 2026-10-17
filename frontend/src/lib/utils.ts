import { createCn } from 'cn/config'
import tokens from '../../design/tokens.json'

// Our type scale (text-title, text-code…) is custom, so the class merger must be told those are
// font sizes. Without this, cn('text-title', 'text-ink-muted') would drop text-title as a "colour".
const typeScale = tokens.type.groups.flatMap((g) => g.styles.map((s) => s.name))

export const cn = createCn({ extend: { classGroups: { 'font-size': [{ text: typeScale }] } } })
