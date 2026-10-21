// dgram.Socket.send in the shapes the typed lowering does not take: offset
// and length slices, a buffer LIST (concatenated), completion callbacks
// (err null, bytes), the connected-socket spellings (send(buf), send(buf,
// cb), send(buf, offset, length, cb)). Messages are received on a second
// socket and printed in arrival order, the sends chained so the order is
// deterministic. Node is the oracle.
const dgram = require("dgram");
const rx = dgram.createSocket("udp4");
const tx = dgram.createSocket("udp4");
// Callbacks and datagrams are collected and printed together at the end: their
// interleaving across the loop's phases is not what this program pins.
const got = [];
const cbs = [];
let want = 0;
const finish = () => {
  if (got.length === want && cbs.length === 5) {
    console.log(cbs.sort().join("\n"));
    console.log(got.join("\n"));
    tx.close();
    rx.close();
  }
};
rx.on("message", (msg, rinfo) => {
  got.push(msg.toString() + "@" + rinfo.address);
  finish();
});
rx.bind(0, "127.0.0.1", () => {
  const port = rx.address().port;
  want = 8;
  tx.send("plain", port, "127.0.0.1", (err, bytes) => {
    cbs.push(`cb1 ${err} ${bytes}`);
    tx.send(Buffer.from("0123456789"), 2, 4, port, "127.0.0.1", (err2, bytes2) => {
      cbs.push(`cb2 ${err2} ${bytes2}`);
      tx.send([Buffer.from("ab"), "cd", Buffer.from("ef")], port, "127.0.0.1", (err3, bytes3) => {
        cbs.push(`cb3 ${err3} ${bytes3}`);
        tx.send("no-callback", port);
        tx.send("slice-no-address", 1, 5, port);
        tx.connect(port, "127.0.0.1", () => {
          tx.send("conn");
          tx.send("conn-cb", (e, n) => { cbs.push(`cb4 ${e} ${n}`); finish(); });
          tx.send("xxconn-slice", 2, 10, (e, n) => { cbs.push(`cb5 ${e} ${n}`); finish(); });
        });
      });
    });
  });
});
