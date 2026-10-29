// The whatwg-url state machine shape: a dyn url record reached through this.url, with
// string appends to a field (password, username, path) and to the last path segment.
class Machine {
  url: any;
  passwordTokenSeenFlag: boolean = false;
  constructor(url: any) {
    this.url = url;
    if (!this.url) {
      this.url = { scheme: "", username: "", password: "", path: [] as string[], query: "" };
    }
  }
  feed(c: string): boolean {
    if (this.passwordTokenSeenFlag) {
      this.url.password += c;
    } else {
      this.url.username += c;
    }
    return true;
  }
}
const m = new Machine(null);
m.url.path.push("a");
m.feed("x");
m.passwordTokenSeenFlag = true;
m.feed("y");
console.log(JSON.stringify(m.url));
