import type { IncomingMessage, ServerResponse } from "node:http";

// The bot's serverless functions run on Node — these are the request/response
// shapes the handler receives from the Vercel Node runtime.
export type Req = IncomingMessage;
export type Res = ServerResponse;
