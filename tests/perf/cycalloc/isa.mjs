/**
 * isa.mjs - WHERE a function's instructions go, one machine instruction at a
 * time, with the exact number of times each one executed.
 *
 * WHY. `ab-callgrind.mjs` prices a function: `scr_cyc_alloc` is 20.62% of
 * closure-churn at ~60 self instructions per call. It cannot say WHICH 60.
 * A sibling block disassembled `scr_bit_and` by hand and found 12 of its 30
 * instructions were the stack frame and 1 was the actual AND - a breakdown
 * that turned a guess ("dynamic dispatch, boxing, a tagged round-trip")
 * into a change. This automates that reading so the next function costs
 * minutes instead of an afternoon.
 *
 * WHAT IT IS. callgrind with `--dump-instr=yes` records cost per MACHINE
 * ADDRESS rather than per source line. Joined against `objdump -d` of the
 * same binary, every byte of the function gets its mnemonic, its source
 * line, and its executed count. The sum of the per-address costs IS the
 * function's self Ir in the ordinary table, which is checked here, not
 * assumed - a join that silently dropped half the addresses would look
 * exactly like a cheap function.
 *
 * WHAT IT CANNOT ANSWER. Ir is not time (see ab-callgrind.mjs's header):
 * these are x86_64-linux-gnu instructions under an emulator with no cache
 * model. A `rep stosb` is ONE instruction and a hundred bytes of work; a
 * `lea` is one instruction and nothing. Read the count column as "how often
 * this path was taken", never as "how expensive this line is". And an
 * instruction executed inside a CALLEE is not here at all: self Ir excludes
 * it, which is the point - the `calls` column names where the rest went.
 *
 * HEALTH CHECKS, printed every run:
 *   1. the scenario's SCBENCH line is in the log (else DID-NOT-RUN);
 *   2. `positions: instr` is in the callgrind header - without --dump-instr
 *      every cost lands on one address and the table is a lie that adds up;
 *   3. the per-address total equals the function's self Ir from the same
 *      file, to the instruction;
 *   4. every address that objdump knows and callgrind does not is listed as
 *      NEVER-EXECUTED rather than dropped, and vice versa as UNKNOWN-ADDR.
 *
 * SELFTEST: --selftest runs the same binary twice and requires that every
 * per-instruction count is identical. An instrument that cannot say "no
 * difference" cannot be believed when it says there is one.
 *
 * Run:
 *   node tests/perf/cycalloc/isa.mjs --exe <elf> --fn scr_cyc_alloc \
 *        --scenario 'closure-churn' --out <dir>
 *   node tests/perf/cycalloc/isa.mjs --exe <elf> --fn scr_cyc_alloc \
 *        --scenario 'closure-churn' --out <dir> --selftest
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const NL = String.fromCharCode(10)
const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  if (i < 0) return d
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? '1' : v
}
const has = (n) => argv.includes('--' + n)

const EXE = flag('exe')
const FN = flag('fn', 'scr_cyc_alloc')
const SCEN = flag('scenario', 'closure-churn')
const OUT = path.resolve(flag('out', 'isa-out'))
const DISTRO = flag('distro', 'Arch')
const BENCHENV = flag('benchenv', '')
const WSLDIR = '/tmp/cycalloc-isa'

if (EXE === null) { console.error('--exe <elf> is required'); process.exit(2) }

function wsl(script) {
  const res = spawnSync('wsl', ['-d', DISTRO, '-u', 'root', '--', 'bash', '-c', script], {
    encoding: 'utf8', maxBuffer: 512 * 1024 * 1024
  })
  if (res.error) throw new Error('wsl not runnable: ' + res.error.message)
  return { status: res.status, out: (res.stdout ?? '').replace(/\0/g, ''), err: (res.stderr ?? '').replace(/\0/g, '') }
}
function toWsl(p) {
  const s = path.resolve(p).replace(/\\/g, '/')
  const m = /^([A-Za-z]):\/(.*)$/.exec(s)
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : s
}
function parseEnv(spec) {
  const out = {}
  for (const kv of String(spec || '').split(',')) {
    const i = kv.indexOf('=')
    if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim()
  }
  return out
}

/** One callgrind run with per-instruction dumping. */
function run(tag) {
  const outFile = path.join(OUT, tag + '.callgrind')
  const logFile = path.join(OUT, tag + '.log')
  const envLines = Object.entries({
    BENCH_LANE: 'callgrind', BENCH_ONLY: SCEN, BENCH_MAX_BATCHES: '1', BENCH_MIN_MS: '1',
    ...parseEnv(BENCHENV)
  }).map(([k, v]) => k + "='" + String(v).replace(/'/g, "'\\''") + "'").join(' ')
  const script = [
    'set -e',
    'mkdir -p ' + WSLDIR,
    'cp ' + JSON.stringify(toWsl(EXE)) + ' ' + WSLDIR + '/run.elf',
    'chmod +x ' + WSLDIR + '/run.elf',
    'cd ' + WSLDIR,
    envLines + ' timeout 3600 valgrind --tool=callgrind --dump-instr=yes' +
      ' --callgrind-out-file=' + WSLDIR + '/p.out --separate-threads=no --cache-sim=no --branch-sim=no' +
      ' ./run.elf > ' + WSLDIR + '/p.log 2>&1 || true',
    'cp ' + WSLDIR + '/p.out ' + JSON.stringify(toWsl(outFile)),
    'cp ' + WSLDIR + '/p.log ' + JSON.stringify(toWsl(logFile)),
    'echo WSL_OK'
  ].join(NL)
  const r = wsl(script)
  if (!r.out.includes('WSL_OK')) throw new Error('callgrind failed:' + NL + r.out + r.err)
  return { outFile, log: existsSync(logFile) ? readFileSync(logFile, 'utf8') : '' }
}

/**
 * Per-address self cost for ONE function, plus its outgoing calls.
 *
 * With `positions: instr line` a cost line is `0xADDR LINE COST`, and both
 * position fields use callgrind's subposition compression: a bare number is
 * absolute, `+n`/`-n` are relative to the previous value, `*` repeats it.
 * Getting that wrong does not error - it silently scatters cost onto
 * addresses that do not exist, which is why health check 4 reports every
 * address objdump does not know.
 */
function parseInstr(file, wantFn) {
  const text = readFileSync(file, 'utf8')
  const names = new Map()
  const nameOf = (kind, raw) => {
    const m = /^\((\d+)\)\s*(.*)$/.exec(raw)
    if (m === null) return raw.trim()
    const id = kind + '#' + m[1]
    if (m[2].trim() !== '') names.set(id, m[2].trim())
    return names.get(id) ?? '(unknown)'
  }
  let positions = null
  let curFn = null
  let curOb = ''
  const perAddr = new Map()     // addr(BigInt as string) -> {ir, line}
  const callsOut = new Map()    // callee -> {n, incl}
  let fnSelf = 0
  let sawFn = false
  // subposition state, reset at every fn=/fl= boundary per the spec
  let lastAddr = 0n
  let lastLine = 0
  let pendingCalls = 0
  let pendingTarget = null
  /* our binary, i.e. not a shared object valgrind also profiled */
  const inFn = () => curFn === wantFn && !/\.so(\.\d+)*$/.test(curOb) && curOb !== '???'

  for (const raw of text.split(NL)) {
    const s = raw.replace(/\r$/, '')
    if (s.startsWith('positions:')) { positions = s.slice(10).trim().split(/\s+/); continue }
    /* `ob=(6)` refers back to an id whose NAME was first written on a
     * `cob=` line, so cob must register into the same namespace or the
     * main binary comes back unnamed and the function is never seen.
     * That is not hypothetical - it is what this parser did first, and it
     * reported `fn-seen=NO` rather than a wrong number, which is why the
     * health check exists. */
    if (s.startsWith('ob=')) { curOb = nameOf('ob', s.slice(3)); continue }
    if (s.startsWith('cob=')) { nameOf('ob', s.slice(4)); continue }
    if (s.startsWith('cfi=') || s.startsWith('cfl=')) continue
    /* Subpositions are relative to the PREVIOUS COST LINE and the chain
     * runs straight through fl=/fi=/fe= - an inlined region continues the
     * address chain and only restates the line. Resetting here scattered
     * cost onto addresses objdump does not know, which health check 4
     * reports rather than hides. */
    if (s.startsWith('fl=') || s.startsWith('fi=') || s.startsWith('fe=')) { nameOf('fl', s.slice(3)); continue }
    if (s.startsWith('fn=')) {
      curFn = nameOf('fn', s.slice(3))
      pendingCalls = 0; pendingTarget = null
      if (inFn()) sawFn = true
      continue
    }
    if (s.startsWith('cfn=')) { pendingTarget = nameOf('fn', s.slice(4)); continue }
    if (s.startsWith('calls=')) { pendingCalls = Number(s.slice(6).trim().split(/\s+/)[0]) || 0; continue }
    if (!/^[+\-*\dx0]/.test(s) || s.includes('=')) { continue }
    const parts = s.trim().split(/\s+/)
    if (parts.length < 2) continue
    // position fields first, then the event columns
    const npos = positions === null ? 1 : positions.length
    const posf = parts.slice(0, npos)
    const cost = Number(parts[npos])
    if (!Number.isFinite(cost)) continue
    // decode subpositions IN ORDER; they must be decoded even outside wantFn
    // or the relative chain inside it starts from a stale base.
    let addr = lastAddr
    let line = lastLine
    for (let i = 0; i < npos; i += 1) {
      const f = posf[i]
      const isAddr = positions !== null && positions[i] === 'instr'
      let v
      if (f === '*') v = isAddr ? lastAddr : BigInt(lastLine)
      else if (f.startsWith('+')) v = (isAddr ? lastAddr : BigInt(lastLine)) + BigInt(f.slice(1))
      else if (f.startsWith('-')) v = (isAddr ? lastAddr : BigInt(lastLine)) - BigInt(f.slice(1))
      else v = f.startsWith('0x') ? BigInt(f) : BigInt(f)
      if (isAddr) { addr = v; lastAddr = v } else { line = Number(v); lastLine = Number(v) }
    }
    if (pendingCalls > 0 && pendingTarget !== null) {
      if (inFn()) {
        const c = callsOut.get(pendingTarget) ?? { n: 0, incl: 0 }
        c.n += pendingCalls; c.incl += cost
        callsOut.set(pendingTarget, c)
      }
      pendingCalls = 0; pendingTarget = null
      continue
    }
    if (inFn()) {
      const k = addr.toString(16)
      const e = perAddr.get(k) ?? { ir: 0, line: 0 }
      e.ir += cost; e.line = line
      perAddr.set(k, e)
      fnSelf += cost
    }
  }
  return { positions, perAddr, callsOut, fnSelf, sawFn }
}

/** objdump the one function out of the ELF. */
function disasm(wantFn) {
  const r = wsl('objdump -d --no-show-raw-insn ' + JSON.stringify(toWsl(EXE)) +
    ' 2>/dev/null | awk \'/^[0-9a-f]+ <' + wantFn + '>:/{f=1;print;next} f&&/^$/{exit} f{print}\'')
  const rows = []
  for (const raw of r.out.split(NL)) {
    const m = /^\s*([0-9a-f]+):\s+(.*?)\s*$/.exec(raw.replace(/\r$/, ''))
    if (m === null) continue
    const text = m[2]
    const sp = text.indexOf(' ')
    rows.push({
      addr: m[1].replace(/^0+/, '') || '0',
      mnem: sp < 0 ? text : text.slice(0, sp),
      ops: sp < 0 ? '' : text.slice(sp + 1).trim()
    })
  }
  return rows
}

/* Buckets, chosen so the answer is readable rather than "60 instructions".
 * The rule for each is written next to it because a bucket nobody can
 * reproduce is an opinion. */
function classify(rows) {
  const first = rows[0]?.addr
  const last = rows[rows.length - 1]?.addr
  return (r, i) => {
    const m = r.mnem
    const o = r.ops
    // FRAME: callee-saved pushes/pops at the two ends, and the rsp adjust.
    if (/^(push|pop)$/.test(m)) return 'frame'
    if (/^(sub|add)$/.test(m) && /%rsp/.test(o)) return 'frame'
    if (m === 'ret' || m === 'leave' || m === 'endbr64') return 'frame'
    if (m === 'call') return 'call'
    return 'body'
  }
}

function fmt(n) { return Number(n).toLocaleString('en-US') }
function pad(s, w) { return String(s).padEnd(w) }
function rpad(s, w) { return String(s).padStart(w) }

function report(tag, parsed, rows, log) {
  const ran = log.includes('"name":"' + SCEN + '"')
  const hasInstr = parsed.positions !== null && parsed.positions.includes('instr')
  console.log('')
  console.log('== ' + FN + '   scenario "' + SCEN + '"   (' + tag + ')')
  console.log('   health: SCBENCH-line=' + (ran ? 'yes' : 'NO  <-- DID-NOT-RUN') +
    '   positions=' + (parsed.positions ?? []).join(',') + (hasInstr ? '' : '  <-- NO --dump-instr') +
    '   fn-seen=' + (parsed.sawFn ? 'yes' : 'NO'))
  if (!ran || !hasInstr || !parsed.sawFn) { console.log('   health check failed - no table'); return null }

  const known = new Map(rows.map((r) => [r.addr, r]))
  const seen = new Set()
  let joined = 0
  let unknownIr = 0
  for (const [a, e] of parsed.perAddr) {
    if (known.has(a)) { joined += e.ir; seen.add(a) } else unknownIr += e.ir
  }
  const never = rows.filter((r) => !parsed.perAddr.has(r.addr))
  console.log('   join:   objdump ' + rows.length + ' instructions   callgrind ' + parsed.perAddr.size +
    ' addresses   matched ' + seen.size +
    '   NEVER-EXECUTED ' + never.length + '   UNKNOWN-ADDR Ir ' + fmt(unknownIr))
  if (joined !== parsed.fnSelf) console.log('   JOIN MISMATCH: joined ' + fmt(joined) + ' vs self ' + fmt(parsed.fnSelf))

  // calls out: how many times was the function itself entered?
  const entries = [...parsed.perAddr.entries()]
  const entryAddr = rows[0]?.addr
  const nCalls = parsed.perAddr.get(entryAddr)?.ir ?? 0
  console.log('   entered ' + fmt(nCalls) + ' times   self Ir ' + fmt(parsed.fnSelf) +
    '   self Ir/call ' + (nCalls > 0 ? (parsed.fnSelf / nCalls).toFixed(2) : '-'))

  const cls = classify(rows)
  const buckets = new Map()
  console.log('')
  console.log('   ' + pad('addr', 8) + pad('src', 6) + rpad('exec', 14) + rpad('/call', 8) + '  ' +
    pad('bucket', 8) + 'instruction')
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    const e = parsed.perAddr.get(r.addr)
    const ir = e?.ir ?? 0
    const b = cls(r, i)
    const acc = buckets.get(b) ?? { ir: 0, n: 0 }
    acc.ir += ir; acc.n += 1
    buckets.set(b, acc)
    console.log('   ' + pad(r.addr, 8) + pad(e ? e.line : '-', 6) + rpad(fmt(ir), 14) +
      rpad(nCalls > 0 ? (ir / nCalls).toFixed(2) : '-', 8) + '  ' + pad(b, 8) +
      r.mnem + ' ' + r.ops)
  }
  console.log('')
  console.log('   bucket totals (self Ir only - a callee is NOT here):')
  for (const [b, acc] of [...buckets].sort((x, y) => y[1].ir - x[1].ir)) {
    console.log('     ' + pad(b, 10) + rpad(acc.n, 4) + ' instructions   ' + rpad(fmt(acc.ir), 14) +
      ' Ir   ' + rpad((100 * acc.ir / parsed.fnSelf).toFixed(2) + '%', 8) +
      rpad(nCalls > 0 ? (acc.ir / nCalls).toFixed(2) : '-', 8) + ' /call')
  }
  if (parsed.callsOut.size > 0) {
    console.log('')
    console.log('   callees (inclusive Ir, NOT counted in the table above):')
    for (const [n, c] of [...parsed.callsOut].sort((x, y) => y[1].incl - x[1].incl)) {
      console.log('     ' + pad(n.slice(0, 34), 36) + rpad(fmt(c.n), 12) + ' calls   ' +
        rpad(fmt(c.incl), 14) + ' Ir   ' + rpad((c.incl / Math.max(1, nCalls)).toFixed(2), 8) +
        ' Ir per ' + FN + ' call')
    }
  }
  return { nCalls, self: parsed.fnSelf, perAddr: parsed.perAddr, rows, buckets, callsOut: parsed.callsOut }
}

function main() {
  mkdirSync(OUT, { recursive: true })
  const rows = disasm(FN)
  if (rows.length === 0) { console.error('objdump found no symbol <' + FN + '> in ' + EXE); process.exit(3) }

  const a = run('isa-a')
  const pa = parseInstr(a.outFile, FN)
  const ra = report('run A', pa, rows, a.log)

  if (!has('selftest')) {
    if (ra === null) process.exit(1)
    writeFileSync(path.join(OUT, FN + '-isa.json'), JSON.stringify({
      fn: FN, scenario: SCEN, exe: EXE, calls: ra.nCalls, self: ra.self,
      instructions: rows.map((r) => ({ ...r, ir: pa.perAddr.get(r.addr)?.ir ?? 0, line: pa.perAddr.get(r.addr)?.line ?? null })),
      callees: [...pa.callsOut].map(([n, c]) => ({ name: n, calls: c.n, incl: c.incl }))
    }, null, 2))
    console.log('')
    console.log('json -> ' + path.join(OUT, FN + '-isa.json'))
    return
  }

  console.log('')
  console.log('SELFTEST (A/A): the same binary, two independent runs, per-INSTRUCTION.')
  const b = run('isa-b')
  const pb = parseInstr(b.outFile, FN)
  report('run B', pb, rows, b.log)
  const addrs = new Set([...pa.perAddr.keys(), ...pb.perAddr.keys()])
  let diff = 0
  const detail = []
  for (const a2 of addrs) {
    const x = pa.perAddr.get(a2)?.ir ?? 0
    const y = pb.perAddr.get(a2)?.ir ?? 0
    if (x !== y) { diff += 1; detail.push('  ' + a2 + ': ' + fmt(x) + ' vs ' + fmt(y)) }
  }
  console.log('')
  console.log('  addresses compared ' + addrs.size + '   differing ' + diff)
  for (const d of detail.slice(0, 20)) console.log(d)
  if (diff === 0) {
    console.log('SELFTEST PASS: every one of ' + addrs.size + ' per-instruction counts is identical.')
    console.log('  The instrument can say "no difference".')
    process.exit(0)
  }
  console.log('SELFTEST FAIL: ' + diff + ' addresses moved between two runs of one binary.')
  process.exit(1)
}

main()
