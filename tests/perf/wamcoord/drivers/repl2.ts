// voip's exact shape: a string PARAMETER, guarded by a regex test, then replace.
function ensureDeviceJid(jid: string): string {
    if (/:\d+@/.test(jid)) return jid
    return jid.replace('@', ':0@')
}
console.log('a=' + ensureDeviceJid('u@s'))
console.log('b=' + ensureDeviceJid('u:1@s'))

// the same without the regex guard
function plain(jid: string): string {
    return jid.replace('@', ':0@')
}
console.log('c=' + plain('u@s'))

// literal receiver, isolated
console.log('d=' + 'x@y'.replace('@', '-'))
