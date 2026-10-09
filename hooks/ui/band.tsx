// Draws the band's segments (FR-3.1, NFR-5). Gets the surface's element table and plain data, never `$`.

import type { ElementTable } from 'claude-code'

import type { Segment, Tone } from '../lib/band'

/** Theme keys, so colours follow the person's theme. The glyph and word carry the meaning without them. */
const COLOR: { readonly [T in Tone]?: 'success' | 'error' | 'warning' } = { ok: 'success', bad: 'error', warn: 'warning' }

export const bandTree = ({ Box, Text }: Pick<ElementTable<'terminal' | 'desktop'>, 'Box' | 'Text'>, line: readonly Segment[]) => {
  const text = (seg: Segment) => (
    <Text color={COLOR[seg.tone]} dimColor={seg.tone === 'dim'} wrap="truncate-end">
      {seg.text}
    </Text>
  )
  // The status never shrinks; if the row is still too wide (ambiguous-width glyphs), the summary is cut.
  return (
    <Box flexDirection="row">
      <Box flexDirection="row" flexShrink={0}>
        {line.filter(seg => seg.shrink !== true).map(text)}
      </Box>
      {line.filter(seg => seg.shrink === true).map(text)}
    </Box>
  )
}
