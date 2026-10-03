import { isPurchaseEventName, type PurchaseEventName } from "./events.js";
import type {
  PurchaseApprovedEvent,
  PurchaseCompleteEvent,
  PurchaseEvent,
  WebhookEvent,
} from "./schemas/index.js";

/** True for any of the nine purchase events (they share `data.purchase`). */
export function isPurchaseEvent(event: WebhookEvent): event is PurchaseEvent {
  return isPurchaseEventName(event.event);
}

const PAID_EVENTS: ReadonlySet<PurchaseEventName> = new Set(["PURCHASE_APPROVED", "PURCHASE_COMPLETE"]);
const PAID_STATUSES: ReadonlySet<string> = new Set(["APPROVED", "COMPLETE"]);

/**
 * True only when both the event name and `purchase.status` say the purchase is
 * paid. Checking one alone is not enough: Hotmart's own example pairs
 * PURCHASE_APPROVED with status "STARTED", and PURCHASE_COMPLETE/APPROVED
 * are the only events that represent money received.
 *
 * This says nothing about ordering: a retried PURCHASE_APPROVED can arrive after
 * a PURCHASE_REFUNDED for the same transaction. Keep per-transaction state on
 * your side and compare `creation_date` before granting access.
 */
export function isApprovedPurchase(event: WebhookEvent): event is PurchaseApprovedEvent | PurchaseCompleteEvent {
  return (
    isPurchaseEvent(event) &&
    PAID_EVENTS.has(event.event) &&
    PAID_STATUSES.has(event.data.purchase.status.toUpperCase())
  );
}

export interface BuyerInfo {
  email?: string;
  name?: string;
  phone?: string;
}

function compact(info: BuyerInfo): BuyerInfo | undefined {
  const out: BuyerInfo = {};
  if (info.email) out.email = info.email;
  if (info.name) out.name = info.name;
  if (info.phone) out.phone = info.phone;
  return Object.keys(out).length > 0 ? out : undefined;
}

function joinPhone(code: string | undefined, phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  return code ? `${code}${phone}` : phone;
}

/**
 * The person behind the event, whatever the event calls them (buyer, lead,
 * subscriber, student or shopper). Returns `undefined` when the payload has no
 * personal data (e.g. affiliate views of a purchase).
 */
export function getBuyer(event: WebhookEvent): BuyerInfo | undefined {
  switch (event.event) {
    case "PURCHASE_OUT_OF_SHOPPING_CART": {
      const b = event.data.buyer;
      return b ? compact({ email: b.email, name: b.name, phone: b.phone }) : undefined;
    }
    case "SUBSCRIPTION_CANCELLATION": {
      const s = event.data.subscriber;
      const phone = joinPhone(s.phone?.dddCell, s.phone?.cell) ?? joinPhone(s.phone?.dddPhone, s.phone?.phone);
      return compact({ email: s.email, name: s.name, phone });
    }
    case "UPDATE_SUBSCRIPTION_CHARGE_DATE":
      return compact({ email: event.data.subscriber.email, name: event.data.subscriber.name });
    case "SWITCH_PLAN":
      return compact({ email: event.data.subscription.user?.email });
    case "CLUB_FIRST_ACCESS":
    case "CLUB_MODULE_COMPLETED":
      return compact({ email: event.data.user.email, name: event.data.user.name });
    case "ORDER_FULFILLMENT": {
      const s = event.data.purchase.shopper;
      return s ? compact({ email: s.email, name: s.name, phone: s.phone }) : undefined;
    }
    default: {
      const b = event.data.buyer;
      if (!b) return undefined;
      return compact({
        email: b.email,
        name: b.name ?? ([b.first_name, b.last_name].filter(Boolean).join(" ") || undefined),
        phone: joinPhone(b.checkout_phone_code, b.checkout_phone),
      });
    }
  }
}

/** Hotmart transaction code (e.g. "HP0000000001") for purchase and logistics events. */
export function getTransactionId(event: WebhookEvent): string | undefined {
  if (isPurchaseEvent(event) || event.event === "ORDER_FULFILLMENT") return event.data.purchase.transaction;
  return undefined;
}

/** Subscriber code for subscription purchases and subscription events. */
export function getSubscriberCode(event: WebhookEvent): string | undefined {
  switch (event.event) {
    case "SUBSCRIPTION_CANCELLATION":
    case "UPDATE_SUBSCRIPTION_CHARGE_DATE":
      return event.data.subscriber.code;
    case "SWITCH_PLAN":
      return event.data.subscription.subscriber_code;
    default:
      return isPurchaseEvent(event) ? event.data.subscription?.subscriber?.code : undefined;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Convert a Hotmart timestamp to a `Date`.
 *
 * - Numbers and numeric strings are milliseconds, except values below 1e11,
 *   which are read as seconds (the switch-plan docs say "unix timestamp").
 * - ISO 8601 strings are parsed; a date-time without an offset (e.g. the
 *   FlexPay "2025-03-15T00:00:00") is read as UTC, not as the server's local time.
 * - Anything else, zero, negative or missing values return `null`.
 */
export function toDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  let ms: number;
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    if (!(n > 0)) return null;
    ms = n < 1e11 ? n * 1000 : n;
  } else {
    const match = ISO_DATE.exec(value);
    if (!match) return null;
    const hasTime = value.length > 10;
    const iso = value.replace(" ", "T");
    ms = Date.parse(hasTime && !match[1] ? `${iso}Z` : iso);
  }
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A flat, storage-friendly view of a purchase event. Missing values are `null`. */
export interface NormalizedPurchase {
  event: PurchaseEventName;
  eventId: string;
  transaction: string;
  status: string;
  offerCode: string | null;
  productId: number;
  productName: string;
  buyerEmail: string | null;
  buyerName: string | null;
  /** `purchase.price.value`: offer price at purchase time, in major units. */
  priceValue: number | null;
  currency: string | null;
  /** `purchase.full_price.value`: what the buyer paid including fees and interest. */
  fullPriceValue: number | null;
  paymentType: string | null;
  installments: number | null;
  approvedAt: Date | null;
  orderedAt: Date | null;
  isOrderBump: boolean;
  parentTransaction: string | null;
  subscriberCode: string | null;
  recurrenceNumber: number | null;
}

export function normalizePurchase(event: PurchaseEvent): NormalizedPurchase {
  const { purchase, product } = event.data;
  const buyer = getBuyer(event);
  return {
    event: event.event,
    eventId: event.id,
    transaction: purchase.transaction,
    status: purchase.status,
    offerCode: purchase.offer?.code ?? null,
    productId: product.id,
    productName: product.name,
    buyerEmail: buyer?.email ?? null,
    buyerName: buyer?.name ?? null,
    priceValue: purchase.price?.value ?? null,
    currency: purchase.price?.currency_value ?? purchase.full_price?.currency_value ?? null,
    fullPriceValue: purchase.full_price?.value ?? null,
    paymentType: purchase.payment?.type ?? null,
    installments: purchase.payment?.installments_number ?? null,
    approvedAt: toDate(purchase.approved_date),
    orderedAt: toDate(purchase.order_date),
    isOrderBump: purchase.order_bump?.is_order_bump === true,
    parentTransaction: purchase.order_bump?.parent_purchase_transaction || null,
    subscriberCode: event.data.subscription?.subscriber?.code ?? null,
    recurrenceNumber: purchase.recurrence_number ?? null,
  };
}
