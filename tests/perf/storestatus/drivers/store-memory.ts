// pkgstatus lane-A driver for the objective's "store-memory".
// There is NO @zapo-js/store-memory package on npm. The in-memory store
// ships INSIDE zapo-js core (src/store/memory, published as dist/store/
// memory) and a consumer reaches it through the 'zapo-js/store' subpath.
// Every memory store class that subpath exports is CONSTRUCTED here.
import {
    WaAppStateMemoryStore,
    WaAuthMemoryStore,
    WaSignalMemoryStore,
    WaPreKeyMemoryStore,
    WaSessionMemoryStore,
    WaIdentityMemoryStore,
    SenderKeyMemoryStore,
    WaRetryMemoryStore,
    WaGroupMetadataMemoryStore,
    WaChatMetadataMemoryStore,
    WaDeviceListMemoryStore,
    WaContactMemoryStore,
    WaMessageSecretMemoryStore,
    WaMessageMemoryStore,
    WaThreadMemoryStore,
    WaPrivacyTokenMemoryStore
} from 'zapo-js/store'

console.log('WaAppStateMemoryStore=' + typeof new WaAppStateMemoryStore())
console.log('WaAuthMemoryStore=' + typeof new WaAuthMemoryStore())
console.log('WaSignalMemoryStore=' + typeof new WaSignalMemoryStore())
console.log('WaPreKeyMemoryStore=' + typeof new WaPreKeyMemoryStore())
console.log('WaSessionMemoryStore=' + typeof new WaSessionMemoryStore())
console.log('WaIdentityMemoryStore=' + typeof new WaIdentityMemoryStore())
console.log('SenderKeyMemoryStore=' + typeof new SenderKeyMemoryStore())
console.log('WaRetryMemoryStore=' + typeof new WaRetryMemoryStore())
console.log('WaGroupMetadataMemoryStore=' + typeof new WaGroupMetadataMemoryStore())
console.log('WaChatMetadataMemoryStore=' + typeof new WaChatMetadataMemoryStore())
console.log('WaDeviceListMemoryStore=' + typeof new WaDeviceListMemoryStore())
console.log('WaContactMemoryStore=' + typeof new WaContactMemoryStore())
console.log('WaMessageSecretMemoryStore=' + typeof new WaMessageSecretMemoryStore())
console.log('WaMessageMemoryStore=' + typeof new WaMessageMemoryStore())
console.log('WaThreadMemoryStore=' + typeof new WaThreadMemoryStore())
console.log('WaPrivacyTokenMemoryStore=' + typeof new WaPrivacyTokenMemoryStore())
