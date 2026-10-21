// Static constants installed with Object.defineProperty after the class, as
// ws's WebSocket does for CONNECTING / OPEN / CLOSING / CLOSED.
const readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];

class Socket {
  constructor() {
    this.state = Socket.CONNECTING;
  }

  open() {
    this.state = Socket.OPEN;
    return this.state === Socket.OPEN;
  }

  label() {
    return readyStates[this.state];
  }
}

Object.defineProperty(Socket, 'CONNECTING', {
  enumerable: true,
  value: readyStates.indexOf('CONNECTING')
});
Object.defineProperty(Socket, 'OPEN', {
  enumerable: true,
  value: readyStates.indexOf('OPEN')
});
Object.defineProperty(Socket, 'CLOSED', { value: readyStates.indexOf('CLOSED'), writable: true });
Object.defineProperty(Socket, 'NAME', { value: 'socket' });

const s = new Socket();
console.log(Socket.CONNECTING, Socket.OPEN, Socket.CLOSED, Socket.NAME, s.label());
console.log(s.open(), s.label(), s.state === Socket.OPEN);
Socket.CLOSED = 9;
console.log(Socket.CLOSED);
