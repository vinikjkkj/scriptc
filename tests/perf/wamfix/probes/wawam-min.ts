// The smallest program that puts the newly-mapped @vinikjkkj/wa-wam source
// into a binary: nothing else in the graph, no zapo-js. If this crashes the
// fault is in the 28,725-line frozen table's initialization; if it runs, the
// fault in wam-entry2-be.exe is somewhere else.
import {
    WA_WAM_CHANNEL_WIRE_CODES,
    WA_WAM_ENUMS,
    WA_WAM_PROTOCOL_VERSION
} from '@vinikjkkj/wa-wam'

console.log('protocol=' + String(WA_WAM_PROTOCOL_VERSION))
console.log('wire.regular=' + String(WA_WAM_CHANNEL_WIRE_CODES.regular))
console.log('wire.private=' + String(WA_WAM_CHANNEL_WIRE_CODES.private))
console.log('CHAT_OPEN=' + String(WA_WAM_ENUMS.UI_ACTION_TYPE.values.CHAT_OPEN))
console.log('LT128=' + String(WA_WAM_ENUMS.SIZE_BUCKET.values.LT128))
console.log('WAWAM-MIN: reached the end')
