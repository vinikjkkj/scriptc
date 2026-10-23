// decodeURI: decodeURIComponent except that an escape of a reserved character
// (; / ? : @ & = + $ , #) is left exactly as written, hex case included.
console.log(decodeURI("a%20b%2Fc%2fd%3Fe%3a%40%26%3D%2B%24%2C%23z"));
console.log(decodeURI("%41%42%43 %C3%A9%E2%82%AC%F0%9F%92%A9"));
console.log(decodeURI("no escapes at all"));
console.log(JSON.stringify(decodeURI("")));
console.log(decodeURIComponent("%2F%3f%23") + "|" + decodeURI("%2F%3f%23"));
// pg-connection-string's use: the path of a postgres URL
const pathname = "/my%20db%2Fname";
console.log(decodeURI(pathname));
// as a value, through a binding and a record field
const dec = decodeURI;
const table = { d: decodeURI };
console.log(dec("x%3Dy%20z"), table.d("p%26q%7Er"), dec === decodeURI);
for (const bad of ["%", "%2", "%zz", "%E0%A4%A", "%C0%AF", "%ED%A0%80", "%F8%80%80%80%80"]) {
  try {
    console.log(decodeURI(bad));
  } catch (e) {
    console.log((e as Error).name, (e as Error).message);
  }
}
