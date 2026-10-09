// Shared inputs for kit tests, typed against the installed build.

/** What the engine stamps on a slash command typed at the prompt. */
export const typed = (command: string, args = '') =>
  ({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  }) as const
