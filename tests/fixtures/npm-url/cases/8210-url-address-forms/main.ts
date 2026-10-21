// A plain-JS package that takes `string | URL`, builds the URL through its
// require('url') binding, types an initializer-less `let` from the two
// assignments of an instanceof test, and rewrites the protocol in place.
// `--npm-static` compiles the body once per argument-type instance, so the
// string instance has a dead `address instanceof URL` arm and the URL
// instance a dead `new URL(address)` arm; neither may fence.
import { describeAddress, kind } from "urladdr"
console.log(describeAddress("http://user:pw@example.com:8080/a/b#frag"))
console.log(describeAddress("https://example.org/secure"))
console.log(describeAddress(new URL("http://example.net:80/plain")))
console.log(describeAddress(new URL("wss://example.io/already")))
console.log(kind("x"), kind(new URL("http://k.example/")))
try {
  describeAddress("not a url")
} catch (e) {
  console.log((e as Error).message)
}
