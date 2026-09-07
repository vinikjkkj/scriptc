// PROBE: are store-sqlite's six root blockers a v1.8.0-vs-1.8.2 skew, or do
// they reproduce against the zapo-js the driver actually installs?
// The store packages attest v1.8.0 and alias zapo-js INSIDE that checkout, so
// their lane never sees 1.8.2. This entry maps zapo-js@1.8.2 directly.
import { WaClient } from 'zapo-js'

console.log('WaClient=' + typeof WaClient)
