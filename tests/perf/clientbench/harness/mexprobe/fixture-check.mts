import { encode } from 'argo-codec'
import { decodeMexArgoResponse } from './argo-decoder-copy'

const value = {
  xwa2_fetch_account_reachout_timelock: {
    is_active: true,
    enforcement_type: 'SOFT_BLOCK',
    time_enforcement_ends: 1767225600
  }
}
for (const opts of [{}, { inlineEverything: true }, { selfDescribing: true }, { noDeduplication: true }]) {
  try {
    const bytes = encode({ type: 'DESC' } as never, value, opts as never)
    const out = await decodeMexArgoResponse(bytes)
    console.log('OPTS', JSON.stringify(opts), 'bytes', bytes.length, '->', JSON.stringify(out.data))
  } catch (e) {
    console.log('OPTS', JSON.stringify(opts), 'FAILED:', (e as Error).message)
  }
}
