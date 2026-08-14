// `lowerServerProperty` — the http request/response member reads — opened
// with a raw `questionDotToken` test, so every chained spelling of
// `req?.url` / `req?.method` / `res?.statusCode` fell through to the
// generic member fence ("'IncomingMessage.url' is part of the standard
// library types but has no scriptc lowering yet") while the plain
// spellings lower to their libCalls.
//
// The receiver here is a HANDLE (httpReq), which is the case the chain
// machinery binds rather than folds: an `IncomingMessage | undefined`
// receiver becomes a real optChain, tag test and all. Both arms are
// exercised — the nullish one has to answer undefined without touching
// the request, and the present one has to evaluate the receiver exactly
// once and then read the real member.

import * as http from "node:http";

let recvEvals = 0;

const server = http.createServer((req, res) => {
    // The chained reads, through a binding the checker types nullable.
    const maybe: typeof req | undefined = req;
    console.log("url:", maybe?.url);
    console.log("method:", maybe?.method);
    console.log("agrees with plain:", maybe?.url === req.url, maybe?.method === req.method);

    // A CALL receiver, so the evaluation count is observable: the chain
    // proves the receiver non-nullish once and reads the member from the
    // bound value.
    function pick(on: boolean): typeof req | undefined {
        recvEvals = recvEvals + 1;
        return on ? req : undefined;
    }
    console.log("present url:", pick(true)?.url);
    console.log("absent url:", pick(false)?.url);
    console.log("absent is undefined:", pick(false)?.url === undefined);
    console.log("receiver evals:", recvEvals);

    res.statusCode = 204;
    res.end();
});

server.listen(0, () => {
    const addr = server.address();
    const port = addr !== null && typeof addr !== "string" ? addr.port : 0;
    const req = http.get({ host: "127.0.0.1", port: port, path: "/probe?q=1" }, (res) => {
        // The RESPONSE side: statusCode is the `number | undefined` union,
        // and the chained read must produce the same arm as the plain one.
        const maybe: typeof res | undefined = res;
        console.log("status:", maybe?.statusCode);
        console.log("status agrees:", maybe?.statusCode === res.statusCode);
        res.on("data", () => {});
        res.on("end", () => {
            server.close();
        });
    });
    req.end();
});
