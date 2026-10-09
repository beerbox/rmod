// Draws the /rmod pane (FR-3.5, FR-3.6, FR-4.4, FR-5.3). Gets the surface's element table, plain data and
// plain callbacks, never `$`. Names come from the parsers already sanitised; long ones are truncated.

import type { ElementTable } from 'claude-code'

import type { Tone } from '../lib/band'
import type { ModelRow } from '../lib/model-list'
import type { PaneSection } from '../lib/pane'

export type PaneActions = { onRefresh: () => void; onReset: () => void; onToggleBand: () => void }

type Els = Pick<ElementTable<'terminal' | 'desktop'>, 'Box' | 'Text' | 'Button'>

const COLOR: { readonly [T in Tone]?: 'success' | 'error' | 'warning' } = { ok: 'success', bad: 'error', warn: 'warning' }

const modelRow = ({ Box, Text }: Els, row: ModelRow) => (
  <Box flexDirection="row">
    <Box flexShrink={0}>
      <Text color={row.marker === '●' ? 'success' : undefined} dimColor={row.marker !== '●'}>
        {row.marker === '' ? '  ' : `${row.marker} `}
      </Text>
    </Box>
    <Box flexShrink={1}>
      <Text wrap="truncate-end">{row.name}</Text>
    </Box>
    {[
      // "Used this session" never shrinks away; the detail is cut first.
      ...(row.requests === 0 ? [] : [<Box flexShrink={0}><Text>{`  ×${row.requests}`}</Text></Box>]),
      ...(row.detail === '' ? [] : [<Text dimColor wrap="truncate-end">{`  ${row.detail}`}</Text>]),
    ]}
  </Box>
)

const section = (els: Els, sec: PaneSection) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Box flexDirection="row">
        <Text bold>{`${sec.name}: `}</Text>
        <Text color={COLOR[sec.tone]} dimColor={sec.tone === 'dim'} wrap="truncate-end">
          {sec.status}
        </Text>
      </Box>
      {[
        ...sec.stats.map(line => <Text wrap="truncate-end">{`  ${line}`}</Text>),
        ...(sec.modelsNote === undefined ? [] : [<Text color={sec.modelsNote.startsWith('⚠') ? 'warning' : undefined} dimColor={!sec.modelsNote.startsWith('⚠')}>{`  ${sec.modelsNote}`}</Text>]),
        ...sec.models.map(row => modelRow(els, row)),
      ]}
    </Box>
  )
}

export const paneTree = (els: Els, sections: readonly PaneSection[], bandHidden: boolean, actions: PaneActions) => {
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="column">
      {/* plain: the terminal draws `r: Refresh`, so the hotkeys are visible (bracketed buttons hide them). */}
      <Box flexDirection="row" flexWrap="wrap">
        <Button key="refresh" plain label="Refresh" hotkey="r" onPress={actions.onRefresh} />
        <Text>{'   '}</Text>
        <Button key="reset" plain label="Reset" hotkey="z" onPress={actions.onReset} />
        <Text>{'   '}</Text>
        <Button key="band" plain label={bandHidden ? 'Show band' : 'Hide band'} hotkey="h" onPress={actions.onToggleBand} />
      </Box>
      {sections.map(sec => section(els, sec))}
      <Text> </Text>
      <Text dimColor>● loaded · ○ available · ◌ loaded state unknown · ×N requests this session</Text>
    </Box>
  )
}
