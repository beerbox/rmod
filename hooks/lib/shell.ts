// A small, quote-aware reader for Bash tool commands (FR-4.1b). Pure: no `$`.
//
// It is not a shell parser. It is just enough to tell a command that runs something from a command
// that only mentions it in quotes, a comment or a heredoc. It returns each simple command's words
// with the quotes removed, and keeps nothing.

const MAX_WORDS = 256

/** Removes heredoc bodies (`<<EOF ... EOF`, `<<-'X' ... X`): text written to a file or stdin, not run. */
const dropHeredocs = (src: string): string => {
  const out: string[] = []
  let until: { word: string; tabs: boolean } | undefined
  for (const line of src.split('\n')) {
    if (until !== undefined) {
      if ((until.tabs ? line.replace(/^\t+/, '') : line) === until.word) until = undefined
      continue
    }
    out.push(line)
    const m = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(line)
    if (m !== null && m[3] !== undefined) until = { word: m[3], tabs: m[1] === '-' }
  }
  return out.join('\n')
}

/**
 * Splits a command line into simple commands, each a list of words with quotes removed. Separators:
 * newline, `;`, `&`, `|` (so `&&` and `||` too), `(`, `)`, `$(` and backticks. A `#` that starts a
 * word begins a comment to the end of the line.
 */
export const simpleCommands = (src: string): string[][] => {
  const text = dropHeredocs(src)
  const commands: string[][] = []
  let words: string[] = []
  let word = ''
  let inWord = false

  const endWord = () => {
    if (inWord && words.length < MAX_WORDS) words.push(word)
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? ''
    if (c === "'") {
      const close = text.indexOf("'", i + 1)
      const stop = close === -1 ? text.length : close
      word += text.slice(i + 1, stop)
      inWord = true
      i = stop
    } else if (c === '"') {
      inWord = true
      for (i += 1; i < text.length && text[i] !== '"'; i += 1) {
        if (text[i] === '\\' && i + 1 < text.length) i += 1
        word += text[i] ?? ''
      }
    } else if (c === '\\') {
      // A backslash-newline continues the line; any other escaped character is literal.
      if (text[i + 1] !== '\n') {
        word += text[i + 1] ?? ''
        inWord = true
      }
      i += 1
    } else if (c === '#' && !inWord) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1
    } else if (c === '$' && text[i + 1] === '(') {
      endCommand()
      i += 1
    } else if ('\n;&|()`'.includes(c)) {
      endCommand()
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else {
      word += c
      inWord = true
    }
  }
  endCommand()
  return commands
}

/** Words that run the next word as a command: `time ollama run`, `nohup lms chat`, `env X=1 curl`. */
const WRAPPERS: ReadonlySet<string> = new Set(['time', 'nohup', 'env', 'exec', 'command', 'nice', 'caffeinate', 'xargs', 'timeout', 'gtimeout', 'sudo'])

/** Wrapper options that take a value as the next word (`nice -n 5`, `sudo -u me`, `timeout -s KILL`). */
const VALUE_OPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['nice', new Set(['-n'])],
  ['sudo', new Set(['-u', '-g', '-h', '-p', '-C'])],
  ['env', new Set(['-u', '-C', '-S'])],
  ['timeout', new Set(['-s', '-k'])],
  ['gtimeout', new Set(['-s', '-k'])],
  ['xargs', new Set(['-n', '-P', '-I', '-L', '-s', '-d', '-E'])],
])

export type Program = {
  program: string
  args: readonly string[]
  /** `VAR=value` words before the program (and inside `env`), by name. */
  env: ReadonlyMap<string, string>
}

/**
 * The command a simple command runs, with its arguments: `VAR=value` prefixes, wrappers and their
 * options (and option values) are skipped, and the program is its base name (`/opt/homebrew/bin/ollama` → `ollama`).
 */
export const programOf = (words: readonly string[]): Program | undefined => {
  const env = new Map<string, string>()
  let i = 0
  while (i < words.length) {
    const w = words[i] ?? ''
    const assign = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(w)
    if (assign !== null) {
      env.set(assign[1] ?? '', assign[2] ?? '')
      i += 1
    } else if (WRAPPERS.has(baseName(w))) {
      const wrapper = baseName(w)
      const takesValue = VALUE_OPTIONS.get(wrapper)
      i += 1
      // Options of the wrapper come before the command; some take the next word as a value.
      while (i < words.length) {
        const o = words[i] ?? ''
        if (o.startsWith('-')) {
          i += takesValue?.has(o) === true ? 2 : 1
        } else if ((wrapper === 'timeout' || wrapper === 'gtimeout') && /^\d/.test(o)) {
          i += 1
        } else {
          break
        }
      }
    } else {
      return { program: baseName(w), args: words.slice(i + 1), env }
    }
  }
  return undefined
}

const baseName = (w: string): string => w.slice(w.lastIndexOf('/') + 1)

/** The script of `bash -c '...'` (also sh, zsh, and combined flags such as `-lc`), if this is one. */
export const inlineScript = (program: string, args: readonly string[]): string | undefined => {
  if (program !== 'bash' && program !== 'sh' && program !== 'zsh') return undefined
  const flag = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a))
  return flag === -1 ? undefined : args[flag + 1]
}
