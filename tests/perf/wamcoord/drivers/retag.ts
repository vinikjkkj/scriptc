// Minimal repro of voip's eleven-site cluster: a nominal handle flowing into a
// structural { close(): void } arm of a union.
declare const ch: RTCDataChannel
declare const pc: RTCPeerConnection | null
declare const sock: { close(): void } | null

function closeQuietly(c: { close(): void } | null | undefined): void {
    c?.close()
}

closeQuietly(sock)   // control: the structural arm itself must flow
closeQuietly(ch)     // the refusal
closeQuietly(pc)     // the refusal, through a null union
console.log('done')
