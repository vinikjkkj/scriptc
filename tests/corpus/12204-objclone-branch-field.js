class C {
  constructor(o) {
    this.host = o.host;
    if (o.t) { this.tz = o.t; } else { this.tz = "local"; }
    this.ssl = o.ssl || false;
  }
}
class P {
  constructor(o) { this.config = { connectionConfig: new C(o), limit: 1 }; }
  dup() {
    const { connectionConfig } = this.config;
    return Object.create(Object.getPrototypeOf(connectionConfig), Object.getOwnPropertyDescriptors(connectionConfig));
  }
}
const p = new P({ host: "h", t: "Z" });
const a = p.dup();
console.log(a instanceof C, a.host, a.tz, a.ssl, Object.keys(a).join(","));
