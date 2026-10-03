// examples/express/server.ts
import express from "express";
import { createMemoryIdempotencyStore, createWebhookHandler, getBuyer } from "@trichains/hotmart-webhooks";
import { toExpressMiddleware } from "@trichains/hotmart-webhooks/adapters/express";

const handler = createWebhookHandler({
  token: process.env.HOTMART_HOTTOK ?? "",
  idempotency: createMemoryIdempotencyStore(), // swap for Redis/DB in production
  handlers: {
    PURCHASE_APPROVED: (event) => {
      console.log("paid", event.data.purchase.transaction, getBuyer(event)?.email);
    },
    SUBSCRIPTION_CANCELLATION: (event) => {
      console.log("canceled", event.data.subscriber.code);
    },
    "*": (event, ctx) => {
      console.log("received", event.event, ctx.category);
    },
  },
});

const app = express();
// No body parser needed; the middleware also works after express.json().
app.post("/webhooks/hotmart", toExpressMiddleware(handler));
app.listen(Number(process.env.PORT ?? 3104), () => {
  console.log("listening on", process.env.PORT ?? 3104);
});
