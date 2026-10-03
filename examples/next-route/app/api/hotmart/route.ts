// app/api/hotmart/route.ts (Next.js App Router, Node.js runtime)
import {
  createWebhookHandler,
  isApprovedPurchase,
  normalizePurchase,
  toMinorUnits,
} from "@trichains/hotmart-webhooks";
import { toNextRouteHandler } from "@trichains/hotmart-webhooks/adapters/next";

// Stand-ins for your own code.
declare const db: {
  grantAccess(input: { email: string; transaction: string; amountCents: number }): Promise<void>;
  revokeAccess(transaction: string): Promise<void>;
  processedEvents: { has(id: string): Promise<boolean>; add(id: string): Promise<void> };
};

const handler = createWebhookHandler({
  token: process.env.HOTMART_HOTTOK ?? "",
  idempotency: { has: (id) => db.processedEvents.has(id), set: (id) => db.processedEvents.add(id) },
  logger: console,
  handlers: {
    PURCHASE_APPROVED: async (event) => {
      if (!isApprovedPurchase(event)) return;
      const purchase = normalizePurchase(event);
      if (!purchase.buyerEmail) return;
      await db.grantAccess({
        email: purchase.buyerEmail,
        transaction: purchase.transaction,
        amountCents: event.data.purchase.price ? toMinorUnits(event.data.purchase.price) : 0,
      });
    },
    PURCHASE_REFUNDED: (event) => db.revokeAccess(event.data.purchase.transaction),
    PURCHASE_CHARGEBACK: (event) => db.revokeAccess(event.data.purchase.transaction),
  },
});

export const runtime = "nodejs";
export const POST = toNextRouteHandler(handler);
