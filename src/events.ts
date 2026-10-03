/**
 * Event names, categories and the known enum values documented by Hotmart for
 * webhook version 2.0.0. See docs/REFERENCES.md for the source pages.
 */

/** Purchase events. All nine share the same payload shape ("Request events" page). */
export const PURCHASE_EVENTS = [
  "PURCHASE_APPROVED",
  "PURCHASE_COMPLETE",
  "PURCHASE_CANCELED",
  "PURCHASE_REFUNDED",
  "PURCHASE_CHARGEBACK",
  "PURCHASE_BILLET_PRINTED",
  "PURCHASE_PROTEST",
  "PURCHASE_DELAYED",
  "PURCHASE_EXPIRED",
] as const;

export const ABANDONMENT_EVENTS = ["PURCHASE_OUT_OF_SHOPPING_CART"] as const;

export const SUBSCRIPTION_EVENTS = [
  "SUBSCRIPTION_CANCELLATION",
  "SWITCH_PLAN",
  "UPDATE_SUBSCRIPTION_CHARGE_DATE",
] as const;

export const CLUB_EVENTS = ["CLUB_FIRST_ACCESS", "CLUB_MODULE_COMPLETED"] as const;

/** Physical products only. Added to the docs in June 2026 ("Logistics data event"). */
export const LOGISTICS_EVENTS = ["ORDER_FULFILLMENT"] as const;

export const WEBHOOK_EVENT_NAMES = [
  ...PURCHASE_EVENTS,
  ...ABANDONMENT_EVENTS,
  ...SUBSCRIPTION_EVENTS,
  ...CLUB_EVENTS,
  ...LOGISTICS_EVENTS,
] as const;

export type PurchaseEventName = (typeof PURCHASE_EVENTS)[number];
export type AbandonmentEventName = (typeof ABANDONMENT_EVENTS)[number];
export type SubscriptionEventName = (typeof SUBSCRIPTION_EVENTS)[number];
export type ClubEventName = (typeof CLUB_EVENTS)[number];
export type LogisticsEventName = (typeof LOGISTICS_EVENTS)[number];
export type WebhookEventName = (typeof WEBHOOK_EVENT_NAMES)[number];

export type EventCategory = "purchase" | "abandonment" | "subscription" | "club" | "logistics";

/** Event names grouped by category. */
export const eventCategories = {
  purchase: PURCHASE_EVENTS,
  abandonment: ABANDONMENT_EVENTS,
  subscription: SUBSCRIPTION_EVENTS,
  club: CLUB_EVENTS,
  logistics: LOGISTICS_EVENTS,
} as const satisfies Record<EventCategory, readonly WebhookEventName[]>;

const NAME_SET: ReadonlySet<string> = new Set(WEBHOOK_EVENT_NAMES);

export function isWebhookEventName(value: unknown): value is WebhookEventName {
  return typeof value === "string" && NAME_SET.has(value);
}

export function isPurchaseEventName(value: unknown): value is PurchaseEventName {
  return typeof value === "string" && (PURCHASE_EVENTS as readonly string[]).includes(value);
}

export function getEventCategory(event: WebhookEventName): EventCategory {
  for (const [category, names] of Object.entries(eventCategories)) {
    if ((names as readonly string[]).includes(event)) return category as EventCategory;
  }
  /* v8 ignore next 2 -- unreachable: every name belongs to a category */
  throw new Error(`Unknown event: ${String(event)}`);
}

/**
 * Metadata used by the README table and the CLI `list-events` command.
 * `paid` means "money moved into the producer's account" for that event. It is
 * a reading of the official descriptions, not a field Hotmart sends.
 */
export const EVENT_INFO: Record<WebhookEventName, { category: EventCategory; paid: boolean; description: string }> = {
  PURCHASE_APPROVED: { category: "purchase", paid: true, description: "Payment approved" },
  PURCHASE_COMPLETE: {
    category: "purchase",
    paid: true,
    description: "Purchase completed (warranty period is over)",
  },
  PURCHASE_CANCELED: { category: "purchase", paid: false, description: "Purchase canceled or payment declined" },
  PURCHASE_REFUNDED: { category: "purchase", paid: false, description: "Purchase refunded" },
  PURCHASE_CHARGEBACK: { category: "purchase", paid: false, description: "Chargeback opened by the buyer" },
  PURCHASE_BILLET_PRINTED: {
    category: "purchase",
    paid: false,
    description: "Boleto (bank slip) generated, waiting for payment",
  },
  PURCHASE_PROTEST: { category: "purchase", paid: false, description: "Refund request / dispute opened" },
  PURCHASE_DELAYED: { category: "purchase", paid: false, description: "Payment overdue (usually a renewal)" },
  PURCHASE_EXPIRED: { category: "purchase", paid: false, description: "Unpaid order expired (e.g. boleto past due date)" },
  PURCHASE_OUT_OF_SHOPPING_CART: {
    category: "abandonment",
    paid: false,
    description: "Checkout abandoned (lead data only)",
  },
  SUBSCRIPTION_CANCELLATION: { category: "subscription", paid: false, description: "Subscription canceled" },
  SWITCH_PLAN: { category: "subscription", paid: false, description: "Subscriber switched plans" },
  UPDATE_SUBSCRIPTION_CHARGE_DATE: {
    category: "subscription",
    paid: false,
    description: "Subscriber changed the billing day",
  },
  CLUB_FIRST_ACCESS: { category: "club", paid: false, description: "Student accessed the course for the first time" },
  CLUB_MODULE_COMPLETED: { category: "club", paid: false, description: "Student completed a module" },
  ORDER_FULFILLMENT: {
    category: "logistics",
    paid: false,
    description: "Logistics data for an approved physical order",
  },
};

/** `purchase.status` values listed on the "Request events" page. */
export const PURCHASE_STATUSES = [
  "APPROVED",
  "BLOCKED",
  "CANCELLED",
  "CHARGEBACK",
  "COMPLETE",
  "EXPIRED",
  "NO_FUNDS",
  "OVERDUE",
  "PARTIALLY_REFUNDED",
  "PRE_ORDER",
  "PRINTED_BILLET",
  "PROCESSING_TRANSACTION",
  "DISPUTE",
  "REFUNDED",
  "STARTED",
  "UNDER_ANALISYS", // sic: spelled this way in the official docs
  "WAITING_PAYMENT",
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/**
 * `purchase.payment.type` values. The docs list two different sets on the same
 * page (producer view vs co-producer/affiliate view); this is the union.
 */
export const PAYMENT_TYPES = [
  "BILLET",
  "CASH_PAYMENT",
  "CREDIT_CARD",
  "DIRECT_BANK_TRANSFER",
  "DIRECT_DEBIT",
  "FINANCED_BILLET",
  "FINANCED_INSTALLMENT",
  "GOOGLE_PAY",
  "HOTCARD",
  "HYBRID",
  "MANUAL_TRANSFER",
  "PAYPAL",
  "PAYPAL_INTERNACIONAL",
  "PICPAY",
  "PIX",
  "SAMSUNG_PAY",
  "WALLET",
  "DEBIT",
  "BALANCE_HOTMART",
  "INSTANT",
  "ECHECK",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

/**
 * Subscription status values. The docs are inconsistent between pages
 * (CANCELLED_BY_* vs CANCELED_BY_*, SELLER vs VENDOR, DELAYED vs PAST_DUE), so
 * every spelling seen is listed and the schema accepts any string.
 */
export const SUBSCRIPTION_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "DELAYED",
  "PAST_DUE",
  "OVERDUE",
  "STARTED",
  "EXPIRED",
  "CANCELLED_BY_CUSTOMER",
  "CANCELLED_BY_SELLER",
  "CANCELLED_BY_ADMIN",
  "CANCELED_BY_CUSTOMER",
  "CANCELED_BY_VENDOR",
  "CANCELED_BY_ADMIN",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** `commissions[].source`. The official example also uses MARKETPLACE, which the field table omits. */
export const COMMISSION_SOURCES = ["MARKETPLACE", "PRODUCER", "COPRODUCER", "AFFILIATE", "ADDON"] as const;
export type CommissionSource = (typeof COMMISSION_SOURCES)[number];
