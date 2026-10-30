// createServer's timeout options validate at construction with Node's messages.
import * as http from "http";
try {
  http.createServer({ requestTimeout: -1 }, () => {});
  console.log("negative request ok");
} catch (e: any) {
  console.log("negative request", e.code, JSON.stringify(e.message));
}
try {
  http.createServer({ headersTimeout: 1.5 }, () => {});
  console.log("fractional header ok");
} catch (e: any) {
  console.log("fractional header", e.code, JSON.stringify(e.message));
}
try {
  http.createServer({ headersTimeout: 500, requestTimeout: 300 }, () => {});
  console.log("header over request ok");
} catch (e: any) {
  console.log("header over request", e.code, JSON.stringify(e.message));
}
try {
  http.createServer({ connectionsCheckingInterval: -5 }, () => {});
  console.log("interval negative ok");
} catch (e: any) {
  console.log("interval negative", e.code, JSON.stringify(e.message));
}
try {
  http.createServer({ requestTimeout: 0, headersTimeout: 5 }, () => {});
  console.log("zero request header 5 ok");
} catch (e: any) {
  console.log("zero request header 5", e.code, JSON.stringify(e.message));
}
try {
  http.createServer({ requestTimeout: 100 }, () => {});
  console.log("request only ok");
} catch (e: any) {
  console.log("request only", e.code, JSON.stringify(e.message));
}
console.log("done");
