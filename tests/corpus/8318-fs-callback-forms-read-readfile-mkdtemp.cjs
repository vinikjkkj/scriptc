// The callback fs forms over runtime arguments, chained so completion order
// is deterministic: readFile (Buffer, utf8, other encodings, the options
// object, an fd, a missing file), mkdtemp (callback in the options slot,
// encodings), fs.read (positional, options, bufferless and default-buffer
// forms, a position that leaves the file offset alone), and mkdtempSync's
// option forms. Node is the oracle.
const fs = require("fs");
const os = require("os");
const path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scr-8080-"));
const file = path.join(dir, "data.txt");
fs.writeFileSync(file, "héllo world");
const out = [];
const rec = (...a) => out.push(a.join("|"));

function step1() {
  fs.readFile(file, (e, d) => {
    rec("buffer", e, typeof d, d.length);
    fs.readFile(file, "utf8", (e2, d2) => {
      rec("utf8", e2, d2);
      fs.readFile(file, { encoding: "hex" }, (e3, d3) => {
        rec("hex", e3, d3);
        fs.readFile(file, "latin1", (e4, d4) => {
          rec("latin1", e4, d4);
          fs.readFile(path.join(dir, "missing"), (e5, d5) => {
            rec("missing", e5 && e5.code, d5);
            fs.readFile(file, "base64", (e6, d6) => {
              rec("b64", e6, d6);
              step2();
            });
          });
        });
      });
    });
  });
}

function step2() {
  const fd = fs.openSync(file, "r");
  const b = Buffer.alloc(5);
  fs.read(fd, b, 0, 5, 1, (e, n, buf) => {
    rec("pread", e, n, buf.length, buf[0], buf[4]);
    fs.read(fd, b, 0, 5, null, (e2, n2, buf2) => {
      rec("read-cur", e2, n2, buf2[0], buf2[4]);
      fs.read(fd, b, { offset: 1, length: 3, position: 0 }, (e3, n3) => {
        rec("opts", e3, n3, b[0], b[1], b[2], b[3]);
        fs.read(fd, b, 0, 0, 0, (e4, n4) => {
          rec("zero", e4, n4);
          fs.read(fd, (e5, n5, big) => {
            rec("default", e5, n5, big.length);
            fs.readFile(fd, "utf8", (e6, d6) => {
              rec("fd-readFile", e6, d6.length);
              fs.closeSync(fd);
              fs.read(fd, b, 0, 5, 0, (e7) => {
                rec("closed", e7 && e7.code);
                step3();
              });
            });
          });
        });
      });
    });
  });
}

function step3() {
  fs.mkdtemp(path.join(dir, "a-"), (e, p) => {
    rec("mkdtemp", e, typeof p, p.startsWith(path.join(dir, "a-")), fs.existsSync(p));
    fs.mkdtemp(path.join(dir, "b-"), { encoding: "buffer" }, (e2, p2) => {
      rec("mkdtemp-buffer", e2, typeof p2, p2.length > 0);
      fs.mkdtemp(path.join(dir, "no", "such", "x-"), (e3) => {
        rec("mkdtemp-missing", e3.code);
        const s1 = fs.mkdtempSync(path.join(dir, "c-"), { encoding: "utf8" });
        const s2 = fs.mkdtempSync(path.join(dir, "d-"), { encoding: "hex" });
        rec("sync", s1.length > dir.length, s2.length > dir.length, /^[0-9a-f]+$/.test(s2));
        console.log(out.join("\n").split(dir).join("<dir>"));
        fs.rmSync(dir, { recursive: true, force: true });
      });
    });
  });
}
step1();
