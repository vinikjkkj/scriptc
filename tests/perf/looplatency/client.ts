export {}
// Same loopback echo, but with a PIPELINE DEPTH knob. If the per-round-trip
// cost is a fixed per-event-loop-TURN latency, then issuing K requests before
// awaiting them should divide the per-request cost by K. If it is per-BYTE or
// per-syscall, depth changes nothing.
import { connect } from 'node:net'
import { performance } from 'node:perf_hooks'

const port = Number(process.env.RTT_PORT ?? '0')
const rounds = Number(process.env.RTT_ROUNDS ?? '2000')
const inflight = Number(process.env.RTT_INFLIGHT ?? '1')

async function main(): Promise<void> {
  const sock = connect(port, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    sock.on('connect', () => { resolve() })
    sock.on('error', reject)
  })
  sock.setNoDelay(true)

  const waiters: ((v: string) => void)[] = []
  let buf = ''
  sock.on('data', (c: Buffer) => {
    buf += c.toString()
    for (;;) {
      const i = buf.indexOf('\n')
      if (i < 0) break
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      const w = waiters.shift()
      if (w === undefined) break
      w(line)
    }
  })

  const t0 = performance.now()
  let done = 0
  while (done < rounds) {
    const k = Math.min(inflight, rounds - done)
    const batch: Promise<string>[] = []
    for (let j = 0; j < k; j += 1) {
      batch.push(new Promise<string>((resolve) => { waiters.push(resolve) }))
      sock.write('ping ' + (done + j) + '\n')
    }
    await Promise.all(batch)
    done += k
  }
  const total = performance.now() - t0
  console.log(
    'inflight ' + inflight + '  rounds ' + rounds + '  total ' + total.toFixed(0) +
    ' ms  per-rt ' + (total / rounds).toFixed(4) + ' ms  per-batch ' +
    (total / Math.ceil(rounds / inflight)).toFixed(3) + ' ms'
  )
  sock.end()
}
void main()
