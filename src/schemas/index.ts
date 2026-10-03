import { z } from "zod";
import type { WebhookEventName } from "../events.js";
import {
  clubFirstAccessSchema,
  clubModuleCompletedSchema,
  orderFulfillmentSchema,
  purchaseOutOfShoppingCartSchema,
  subscriptionCancellationSchema,
  switchPlanSchema,
  updateSubscriptionChargeDateSchema,
} from "./other.js";
import {
  purchaseApprovedSchema,
  purchaseBilletPrintedSchema,
  purchaseCanceledSchema,
  purchaseChargebackSchema,
  purchaseCompleteSchema,
  purchaseDelayedSchema,
  purchaseExpiredSchema,
  purchaseProtestSchema,
  purchaseRefundedSchema,
} from "./purchase.js";

export * from "./other.js";
export * from "./purchase.js";
export { moneySchema, timestampSchema, type Money } from "./shared.js";

/** Discriminated union of every supported v2.0.0 event, keyed on `event`. */
export const webhookEventSchema = z.discriminatedUnion("event", [
  purchaseApprovedSchema,
  purchaseCompleteSchema,
  purchaseCanceledSchema,
  purchaseRefundedSchema,
  purchaseChargebackSchema,
  purchaseBilletPrintedSchema,
  purchaseProtestSchema,
  purchaseDelayedSchema,
  purchaseExpiredSchema,
  purchaseOutOfShoppingCartSchema,
  subscriptionCancellationSchema,
  switchPlanSchema,
  updateSubscriptionChargeDateSchema,
  clubFirstAccessSchema,
  clubModuleCompletedSchema,
  orderFulfillmentSchema,
]);

/** Any supported, validated Hotmart webhook event. */
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

/** Narrow `WebhookEvent` to one event name: `WebhookEventOf<"PURCHASE_APPROVED">`. */
export type WebhookEventOf<E extends WebhookEventName> = Extract<WebhookEvent, { event: E }>;

/** The schema for a single event name. */
export const eventSchemas = {
  PURCHASE_APPROVED: purchaseApprovedSchema,
  PURCHASE_COMPLETE: purchaseCompleteSchema,
  PURCHASE_CANCELED: purchaseCanceledSchema,
  PURCHASE_REFUNDED: purchaseRefundedSchema,
  PURCHASE_CHARGEBACK: purchaseChargebackSchema,
  PURCHASE_BILLET_PRINTED: purchaseBilletPrintedSchema,
  PURCHASE_PROTEST: purchaseProtestSchema,
  PURCHASE_DELAYED: purchaseDelayedSchema,
  PURCHASE_EXPIRED: purchaseExpiredSchema,
  PURCHASE_OUT_OF_SHOPPING_CART: purchaseOutOfShoppingCartSchema,
  SUBSCRIPTION_CANCELLATION: subscriptionCancellationSchema,
  SWITCH_PLAN: switchPlanSchema,
  UPDATE_SUBSCRIPTION_CHARGE_DATE: updateSubscriptionChargeDateSchema,
  CLUB_FIRST_ACCESS: clubFirstAccessSchema,
  CLUB_MODULE_COMPLETED: clubModuleCompletedSchema,
  ORDER_FULFILLMENT: orderFulfillmentSchema,
} as const satisfies { [K in WebhookEventName]: z.ZodType<{ event: K }> };

export type PurchaseApprovedEvent = WebhookEventOf<"PURCHASE_APPROVED">;
export type PurchaseCompleteEvent = WebhookEventOf<"PURCHASE_COMPLETE">;
export type PurchaseCanceledEvent = WebhookEventOf<"PURCHASE_CANCELED">;
export type PurchaseRefundedEvent = WebhookEventOf<"PURCHASE_REFUNDED">;
export type PurchaseChargebackEvent = WebhookEventOf<"PURCHASE_CHARGEBACK">;
export type PurchaseBilletPrintedEvent = WebhookEventOf<"PURCHASE_BILLET_PRINTED">;
export type PurchaseProtestEvent = WebhookEventOf<"PURCHASE_PROTEST">;
export type PurchaseDelayedEvent = WebhookEventOf<"PURCHASE_DELAYED">;
export type PurchaseExpiredEvent = WebhookEventOf<"PURCHASE_EXPIRED">;
export type PurchaseOutOfShoppingCartEvent = WebhookEventOf<"PURCHASE_OUT_OF_SHOPPING_CART">;
export type SubscriptionCancellationEvent = WebhookEventOf<"SUBSCRIPTION_CANCELLATION">;
export type SwitchPlanEvent = WebhookEventOf<"SWITCH_PLAN">;
export type UpdateSubscriptionChargeDateEvent = WebhookEventOf<"UPDATE_SUBSCRIPTION_CHARGE_DATE">;
export type ClubFirstAccessEvent = WebhookEventOf<"CLUB_FIRST_ACCESS">;
export type ClubModuleCompletedEvent = WebhookEventOf<"CLUB_MODULE_COMPLETED">;
export type OrderFulfillmentEvent = WebhookEventOf<"ORDER_FULFILLMENT">;

/** Any of the nine purchase events (they share `data.purchase`, `data.buyer`, ...). */
export type PurchaseEvent =
  | PurchaseApprovedEvent
  | PurchaseCompleteEvent
  | PurchaseCanceledEvent
  | PurchaseRefundedEvent
  | PurchaseChargebackEvent
  | PurchaseBilletPrintedEvent
  | PurchaseProtestEvent
  | PurchaseDelayedEvent
  | PurchaseExpiredEvent;
