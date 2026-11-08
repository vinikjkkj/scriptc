// fs callbacks with an annotated value slot (data: Buffer, data: string, folder: string, fd: number): on a failure Node calls back with the error
// alone, so the slot is undefined; a guarded read works, an unguarded member use is Node's TypeError, and the success path is unchanged.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-slot-"));
const present = path.join(dir, "present.txt");
const missing = path.join(dir, "missing.txt");
fs.writeFileSync(present, "hello world");
fs.readFile(missing, (err: NodeJS.ErrnoException | null, data: Buffer) => {
  console.log("buffer", err ? err.code : "ok", data, typeof data, data === undefined);
  fs.readFile(missing, (err2: NodeJS.ErrnoException | null, data2: Buffer) => {
    try {
      console.log(data2.length);
    } catch (e) {
      console.log((e as Error).constructor.name, (e as Error).message);
    }
    fs.readFile(missing, "utf8", (err3: NodeJS.ErrnoException | null, text: string) => {
      console.log("string", err3 ? err3.code : "ok", text, typeof text);
      try {
        console.log(text.toUpperCase());
      } catch (e) {
        console.log((e as Error).constructor.name, (e as Error).message);
      }
      fs.mkdtemp(path.join(missing, "x"), (err4: NodeJS.ErrnoException | null, folder: string) => {
        console.log("mkdtemp", err4 ? err4.code : "ok", folder, typeof folder);
        fs.open(missing, "r", (err5: NodeJS.ErrnoException | null, fd: number) => {
          console.log("open", err5 ? err5.code : "ok", fd, typeof fd);
          fs.readFile(missing, (err6: NodeJS.ErrnoException | null, data6: Buffer) => {
            if (data6) console.log("unexpected", data6.length);
            else console.log("guarded", err6 && err6.code);
            fs.readFile(present, (err7: NodeJS.ErrnoException | null, data7: Buffer) => {
              console.log("present", err7, data7.length, data7.toString(), data7[0], data7.subarray(1, 3).toString(), data7);
              fs.readFile(present, "utf8", (err8: NodeJS.ErrnoException | null, text8: string) => {
                console.log("present utf8", err8, text8.length, text8.toUpperCase());
                fs.unlinkSync(present);
                fs.rmdirSync(dir);
              });
            });
          });
        });
      });
    });
  });
});
