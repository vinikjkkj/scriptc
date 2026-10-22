// A checker-`any` const holding an object literal that the scope writes
// members through (pg-protocol's parseAuthenticationResponse shape).
interface BackendMessage {
  name: string;
  length: number;
}

function parse(code: number, length: number) {
  const message: BackendMessage & any = { name: "ok", length };
  switch (code) {
    case 3:
      if (message.length === 8) {
        message.name = "cleartext";
      }
      break;
    case 10: {
      message.name = "sasl";
      message.mechanisms = [];
      let m: string;
      let i = 0;
      do {
        m = i < 2 ? "m" + i : "";
        if (m) message.mechanisms.push(m);
        i++;
      } while (m);
      break;
    }
    case 11:
      message.name = "cont";
      message["data"] = "payload";
      break;
    default:
      throw new Error("unknown " + code);
  }
  return message;
}

for (const c of [3, 10, 11]) {
  const r = parse(c, 8);
  console.log(r.name, r.length, r.mechanisms, r.data);
}
try {
  parse(1, 8);
} catch (e) {
  console.log((e as Error).message);
}
