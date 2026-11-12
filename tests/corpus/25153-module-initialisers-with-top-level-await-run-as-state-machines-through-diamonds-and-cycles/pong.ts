import "./ping.ts";
import { note } from "./shared.ts";

note("pong:body");
await Promise.resolve();
note("pong:end");
export {};
