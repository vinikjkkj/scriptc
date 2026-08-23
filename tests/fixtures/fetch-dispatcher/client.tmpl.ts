/* undici's `dispatcher` on a fetch init, run identically by Node v25.9.0
 * and by a compiled binary on both backends. `__HTTP__` is substituted
 * with the origin's base URL before compiling: a static build has no
 * runtime string it could assemble a URL literal from, and the compared
 * program has to be byte-identical in both lanes.
 *
 * EVERY CELL IS A WAY A PROXY CAN BE SILENTLY WRONG. A dispatcher that is
 * ignored still answers a Response — from the ORIGIN — so the cases are
 * built so that a bypassed proxy produces a DIFFERENT answer rather than a
 * missing one: the delegated requests go to paths the origin answers 400
 * on, and the direct ones go to /ok.
 */
const BASE = '__HTTP__'

interface Handler {
  onConnect(abort: unknown): unknown
  onResponseStarted(): unknown
  onHeaders(status: number, headers: readonly unknown[], resume: unknown, statusText: unknown): unknown
  onData(chunk: unknown): unknown
  onComplete(trailers: unknown): unknown
  onError(err: unknown): unknown
}

interface Dispatcher {
  dispatch(...args: readonly unknown[]): unknown
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => { resolve() }, ms)
  })
}

function say(key: string, value: string): void {
  console.log(key + ' ' + value)
}

/** The failure shape a fetch rejection carries, printed the same way on
 * both lanes. Node puts the dispatcher's own error on `cause`, which this
 * runtime's ScrError has no slot for, so only the NAME and the MESSAGE are
 * compared — the two halves every consumer actually branches on. */
function errLine(e: unknown): string {
  const err = e as { name?: unknown; message?: unknown }
  return String(err.name) + ':' + String(err.message)
}

/* ── 1. a dispatcher that is honoured, end to end ─────────────────── */

async function honoured(): Promise<void> {
  let optsLine = ''
  let handlerLine = ''
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      const o = args[0] as Record<string, unknown>
      const h = args[1] as unknown as Handler
      const keys = Object.keys(args[1] as Record<string, unknown>)
      optsLine =
        'argc=' + String(args.length) +
        ' path=' + String(o.path) +
        ' origin=' + String(o.origin) +
        ' method=' + String(o.method) +
        ' bodyNull=' + String(o.body === null) +
        ' maxRedirections=' + String(o.maxRedirections) +
        ' upgradeUndefined=' + String(o.upgrade === undefined) +
        ' headers=' + JSON.stringify(o.headers)
      handlerLine = keys.join(',')
      h.onConnect((): void => {})
      h.onResponseStarted()
      h.onHeaders(201, ['content-type', 'text/plain', 'x-mark', 'viaproxy'], null, 'Created')
      h.onData('PROX')
      h.onData('IED!')
      h.onComplete(null)
      return true
    }
  }
  const init: RequestInit = { method: 'GET', headers: { 'x-custom': 'yes' } }
  ;(init as { dispatcher?: unknown }).dispatcher = d
  const res = await fetch(BASE + '/never-a-route?q=1', init)
  say('opts', optsLine)
  say('handler', handlerLine)
  say('honoured',
    'status=' + String(res.status) +
    ' statusText=' + res.statusText +
    ' ok=' + String(res.ok) +
    ' redirected=' + String(res.redirected) +
    ' url=' + res.url +
    ' ct=' + String(res.headers.get('content-type')) +
    ' xmark=' + String(res.headers.get('X-Mark')))
  say('honoured-body', await res.text())
}

/* ── 2. an UNDEFINED dispatcher takes the ordinary path ───────────── */

async function notConfigured(): Promise<void> {
  const init: RequestInit = { method: 'GET' }
  const res = await fetch(BASE + '/ok', init)
  say('direct', 'status=' + String(res.status) + ' body=' + (await res.text()))
}

/* ── 3. the dispatcher answers a NON-2xx, which resolves ──────────── */

async function nonOk(): Promise<void> {
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      const h = args[1] as unknown as Handler
      h.onConnect((): void => {})
      h.onHeaders(503, ['content-type', 'text/plain'], null, 'Service Unavailable')
      h.onData('down')
      h.onComplete(null)
      return true
    }
  }
  const init: RequestInit = {}
  ;(init as { dispatcher?: unknown }).dispatcher = d
  const res = await fetch(BASE + '/never-a-route', init)
  say('non2xx',
    'status=' + String(res.status) + ' ok=' + String(res.ok) +
    ' statusText=' + res.statusText + ' body=' + (await res.text()))
}

/* ── 4. repeated header names join the way Node joins them ────────── */

async function headerJoin(): Promise<void> {
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      const h = args[1] as unknown as Handler
      h.onConnect((): void => {})
      h.onHeaders(200, ['X-A', '1', 'x-a', '2', 'set-cookie', 'a=1', 'set-cookie', 'b=2'], null, 'OK')
      h.onComplete(null)
      return true
    }
  }
  const init: RequestInit = {}
  ;(init as { dispatcher?: unknown }).dispatcher = d
  const res = await fetch(BASE + '/never-a-route', init)
  say('joined',
    'xa=' + String(res.headers.get('x-a')) +
    ' XA=' + String(res.headers.get('X-A')) +
    ' cookie=' + String(res.headers.get('set-cookie')) +
    ' has=' + String(res.headers.has('X-A')) +
    ' missing=' + String(res.headers.get('x-nope')))
  await res.text()
}

/* ── 5. a content-encoding a PROXY produced is still decoded ──────── */

async function gzipped(): Promise<void> {
  const gz = new Uint8Array([
    31, 139, 8, 0, 0, 0, 0, 0, 0, 10, 115, 246, 247, 13, 8, 114, 13, 14, 118, 117, 209, 117, 138,
    212, 13, 241, 112, 213, 13, 8, 242, 143, 136, 4, 0, 174, 65, 48, 24, 23, 0, 0, 0
  ])
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      const h = args[1] as unknown as Handler
      h.onConnect((): void => {})
      h.onHeaders(200, ['content-encoding', 'gzip'], null, 'OK')
      h.onData(gz)
      h.onComplete(null)
      return true
    }
  }
  const init: RequestInit = {}
  ;(init as { dispatcher?: unknown }).dispatcher = d
  const res = await fetch(BASE + '/never-a-route', init)
  say('gzip', 'ce=' + String(res.headers.get('content-encoding')) + ' body=' + (await res.text()))
}

/* ── 6. a REDIRECT is followed through the dispatcher again ───────── */

async function redirected(): Promise<void> {
  let calls = 0
  const seen: string[] = []
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      const o = args[0] as Record<string, unknown>
      const h = args[1] as unknown as Handler
      calls += 1
      seen.push(String(o.path))
      h.onConnect((): void => {})
      if (calls === 1) {
        h.onHeaders(302, ['location', '/second'], null, 'Found')
        h.onComplete(null)
      } else {
        h.onHeaders(200, ['content-type', 'text/plain'], null, 'OK')
        h.onData('FINAL')
        h.onComplete(null)
      }
      return true
    }
  }
  const init: RequestInit = { headers: { authorization: 'Bearer T' } }
  ;(init as { dispatcher?: unknown }).dispatcher = d
  const res = await fetch(BASE + '/first', init)
  say('redirect',
    'calls=' + String(calls) +
    ' paths=' + seen.join('|') +
    ' status=' + String(res.status) +
    ' redirected=' + String(res.redirected) +
    ' url=' + res.url +
    ' body=' + (await res.text()))
}

/* ── 7. every way a dispatcher fails to deliver ───────────────────── */

async function throwing(): Promise<void> {
  const d: Dispatcher = {
    dispatch: (): unknown => {
      throw new Error('BOOM')
    }
  }
  const init: RequestInit = {}
  ;(init as { dispatcher?: unknown }).dispatcher = d
  try {
    const res = await fetch(BASE + '/never-a-route', init)
    say('throws', 'RESOLVED status=' + String(res.status))
  } catch (e: unknown) {
    say('throws', errLine(e))
  }
}

async function erroring(): Promise<void> {
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      const h = args[1] as unknown as Handler
      h.onConnect((): void => {})
      h.onError(new Error('PROXY-DOWN'))
      return true
    }
  }
  const init: RequestInit = {}
  ;(init as { dispatcher?: unknown }).dispatcher = d
  try {
    const res = await fetch(BASE + '/never-a-route', init)
    say('onerror', 'RESOLVED status=' + String(res.status))
  } catch (e: unknown) {
    say('onerror', errLine(e))
  }
}

/** A dispatcher that answers NOTHING. The oracle leaves the fetch promise
 * unsettled forever and the process exits anyway; this cell measures that
 * rather than reproducing a hang, by racing it against a timer the fixture
 * owns. A build that quietly rejected — or quietly resolved — would print
 * something other than `pending`. */
async function silent(): Promise<void> {
  let state = ''
  const d: Dispatcher = {
    dispatch: (): unknown => true
  }
  const init: RequestInit = {}
  ;(init as { dispatcher?: unknown }).dispatcher = d
  void fetch(BASE + '/never-a-route', init).then(
    (): void => { state = 'resolved' },
    (): void => { state = 'rejected' }
  )
  await sleep(400)
  say('silent', state === '' ? 'pending' : state)
}

/** The same, with the handler DROPPED as well: nothing in the program can
 * answer any more. Node still fires nothing, and the process still exits
 * 0 — which is what the last line of this fixture proves. */
async function abandoned(): Promise<void> {
  let state = ''
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      void args
      return true
    }
  }
  const init: RequestInit = {}
  ;(init as { dispatcher?: unknown }).dispatcher = d
  void fetch(BASE + '/never-a-route', init).then(
    (): void => { state = 'resolved' },
    (): void => { state = 'rejected' }
  )
  await sleep(400)
  say('abandoned', state === '' ? 'pending' : state)
}

/* ── 8. the SIGNAL still aborts a delegated request ───────────────── */

async function aborted(): Promise<void> {
  let abortCalls = 0
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      const h = args[1] as unknown as Handler
      h.onConnect((): void => { abortCalls += 1 })
      return true
    }
  }
  const controller = new AbortController()
  const init: RequestInit = { signal: controller.signal }
  ;(init as { dispatcher?: unknown }).dispatcher = d
  setTimeout(() => { controller.abort() }, 120)
  try {
    const res = await fetch(BASE + '/never-a-route', init)
    say('abort', 'RESOLVED status=' + String(res.status))
  } catch (e: unknown) {
    say('abort', errLine(e))
  }
  // NOT the count: undici calls the dispatcher's abort TWICE for one
  // signal (measured), which is an implementation detail of its teardown
  // rather than an observable contract. What must not differ is WHETHER
  // the dispatcher was told at all -- a build that never tells it leaves
  // a proxy holding a connection nobody will ever close.
  say('abort-told', String(abortCalls > 0))
}

/** A signal that is ALREADY aborted never reaches the dispatcher at all. */
async function preAborted(): Promise<void> {
  let calls = 0
  const d: Dispatcher = {
    dispatch: (): unknown => {
      calls += 1
      return true
    }
  }
  const controller = new AbortController()
  controller.abort()
  const init: RequestInit = { signal: controller.signal }
  ;(init as { dispatcher?: unknown }).dispatcher = d
  try {
    await fetch(BASE + '/never-a-route', init)
    say('pre-abort', 'RESOLVED')
  } catch (e: unknown) {
    say('pre-abort', errLine(e) + ' calls=' + String(calls))
  }
}

/* ── 9. one dispatcher, several requests ──────────────────────────── */

async function reused(): Promise<void> {
  let calls = 0
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      const o = args[0] as Record<string, unknown>
      const h = args[1] as unknown as Handler
      calls += 1
      h.onConnect((): void => {})
      h.onHeaders(200, ['content-type', 'text/plain'], null, 'OK')
      h.onData('r' + String(calls) + String(o.path))
      h.onComplete(null)
      return true
    }
  }
  const init: RequestInit = {}
  ;(init as { dispatcher?: unknown }).dispatcher = d
  const a = await (await fetch(BASE + '/one', init)).text()
  const b = await (await fetch(BASE + '/two', init)).text()
  say('reused', a + ' ' + b + ' calls=' + String(calls))
}

/** The dispatcher written at the LITERAL rather than onto a value. Both
 * spellings must describe the identical request — one key walk. */
async function atTheLiteral(): Promise<void> {
  let optsLine = ''
  const d: Dispatcher = {
    dispatch: (...args: readonly unknown[]): unknown => {
      const o = args[0] as Record<string, unknown>
      const h = args[1] as unknown as Handler
      optsLine = String(o.method) + ' ' + String(o.path) + ' ' + JSON.stringify(o.headers)
      h.onConnect((): void => {})
      h.onHeaders(200, ['content-type', 'text/plain'], null, 'OK')
      h.onData('LIT')
      h.onComplete(null)
      return true
    }
  }
  const res = await fetch(BASE + '/lit?x=1', {
    method: 'PUT',
    headers: { 'x-custom': 'yes' },
    dispatcher: d
  } as RequestInit)
  say('literal', optsLine + ' body=' + (await res.text()))
}

/* ── 10. the OTHER `dispatch` spelling ──────────────────────── */

/** `dispatch(opts, handler)` with two fixed parameters rather than a rest
 * array. It is a DIFFERENT C signature and the compiler proves which one
 * it is; calling a closure through the wrong one is undefined behaviour
 * rather than a diagnosable failure, so both arms are exercised here and
 * not only the one zapo writes. */
interface TwoArg {
  dispatch(opts: unknown, handler: unknown): boolean
}

async function twoArg(): Promise<void> {
  let seen = ''
  const d: TwoArg = {
    dispatch: (opts: unknown, handler: unknown): boolean => {
      const o = opts as Record<string, unknown>
      const h = handler as Handler
      seen = String(o.method) + ' ' + String(o.path)
      h.onConnect((): void => {})
      h.onHeaders(200, ['content-type', 'text/plain'], null, 'OK')
      h.onData('TWO')
      h.onComplete(null)
      return true
    }
  }
  const init: RequestInit = {}
  ;(init as { dispatcher?: unknown }).dispatcher = d
  const res = await fetch(BASE + '/two-arg', init)
  say('two-arg', seen + ' body=' + (await res.text()))
}

async function main(): Promise<void> {
  await honoured()
  await notConfigured()
  await nonOk()
  await headerJoin()
  await gzipped()
  await redirected()
  await throwing()
  await erroring()
  await silent()
  await abandoned()
  await aborted()
  await preAborted()
  await reused()
  await atTheLiteral()
  await twoArg()
  say('END', 'done')
}

void main()
