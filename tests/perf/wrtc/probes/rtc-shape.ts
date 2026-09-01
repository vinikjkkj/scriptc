/* Reproduces the three sites WaSctpRelay.ts hits, in isolation:
 *   :30/:31  type aliases naming the two global RTC types
 *   :66-:71  an interface with a field typed `RTCPeerConnection | null`
 *   :94      a Map keyed on that interface
 * plus closeQuietly's structural { close(): void } constraint at :22.
 */

type PeerConnectionClass = RTCPeerConnection
type DataChannelClass = RTCDataChannel

interface Connection {
    peerConnection: PeerConnectionClass | null
    channel: DataChannelClass | null
    incomingChannels: DataChannelClass[]
    id: string
}

function closeQuietly(closeable: { close(): void } | null | undefined): void {
    try {
        closeable?.close()
    } catch {
        // ignore
    }
}

const connections = new Map<string, Connection>()

export function make(id: string): Connection {
    const conn: Connection = {
        peerConnection: null,
        channel: null,
        incomingChannels: [],
        id
    }
    connections.set(id, conn)
    return conn
}

export function shut(conn: Connection): void {
    closeQuietly(conn.channel)
    for (const ch of conn.incomingChannels) closeQuietly(ch)
    closeQuietly(conn.peerConnection)
}

console.log('sites: ' + String(connections.size))
make('a')
console.log('sites: ' + String(connections.size))
