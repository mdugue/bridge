// The building BVH's worker (city-bvh.ts): one job at a time, each answered
// with the arrays it was lent (city-bvh-job.ts). `ready` says the module
// has loaded — before it, the main thread lends it nothing: a worker that
// fails to load would keep the arrays.
import { type BvhJob, buildJob, replyTransfer } from "./city-bvh-job";

self.onmessage = (event: MessageEvent<BvhJob>) => {
  const reply = buildJob(event.data);
  self.postMessage(reply, { transfer: replyTransfer(reply) });
};

self.postMessage({ ready: true });
