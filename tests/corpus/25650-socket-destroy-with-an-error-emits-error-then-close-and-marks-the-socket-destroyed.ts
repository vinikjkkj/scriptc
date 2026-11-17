// socket.destroy(err) destroys the socket at once and queues 'error' with that very object, then 'close' (hadError true).
import * as net from "node:net";
const s = new net.Socket();
const boom = new Error("boom");
s.on("error", (e: Error) => {
  console.log("error event:", e.message, e === boom);
});
s.on("close", (hadError: boolean) => {
  console.log("closed, hadError:", hadError);
});
console.log("destroyed before", s.destroyed);
s.destroy(boom);
console.log("destroyed after", s.destroyed);
