// pg's connection-timeout idiom: a feature check on a Timeout handle's
// method, then the call. The handle lives on a class field, the shape of pg's
// Client and pg-pool's checkout timer.
class Client {
  constructor(timeoutMs) {
    this.handle = setTimeout(function () {}, timeoutMs);
    this.timeoutMs = timeoutMs;
  }
  arm() {
    if (this.handle.unref) {
      this.handle.unref();
    }
    return this.handle.hasRef();
  }
}
function main() {
  var c = new Client(60000);
  console.log("armed", c.arm(), c.timeoutMs);
  clearTimeout(c.handle);
}
main();
