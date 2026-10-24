// A nullable timer field (`NodeJS.Timeout | null`) on a class whose
// instance is held through another nullable field, with method calls
// through the optional holder: the reconnectTimer / getComms()?.stop shape.
class Socket {
  private closed: boolean

  constructor() {
    this.closed = false
  }

  isOpen(): boolean {
    return !this.closed
  }

  close(): void {
    this.closed = true
    console.log('socket closed')
  }
}

class Link {
  private reconnectTimer: NodeJS.Timeout | null
  private socket: Socket | null
  private attempts: number

  constructor() {
    this.reconnectTimer = null
    this.socket = null
    this.attempts = 0
  }

  connect(): void {
    this.socket = new Socket()
    console.log('connected', this.socket.isOpen())
  }

  scheduleReconnect(ms: number): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.attempts++
      console.log('reconnect attempt', this.attempts)
    }, ms)
  }

  getSocket(): Socket | null {
    return this.socket
  }

  disconnect(): void {
    this.getSocket()?.close()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket = null
  }

  hasPendingReconnect(): boolean {
    return this.reconnectTimer !== null
  }
}

const link = new Link()
link.connect()
link.scheduleReconnect(1000)
console.log('pending', link.hasPendingReconnect())
link.scheduleReconnect(5)
setTimeout(() => {
  console.log('pending after fire', link.hasPendingReconnect())
  link.disconnect()
  console.log('pending after disconnect', link.hasPendingReconnect())
}, 40)
