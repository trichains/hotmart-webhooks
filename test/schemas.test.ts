import { describe, expect, it } from "vitest";
import {
  WEBHOOK_EVENT_NAMES,
  eventCategories,
  eventSchemas,
  getEventCategory,
  isPurchaseEventName,
  isWebhookEventName,
  webhookEventSchema,
} from "../src/index.js";
import { createFixture, fixtureEventNames, fixtures } from "../src/fixtures/index.js";

const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe("fixtures vs schemas", () => {
  it("has a fixture for every supported event", () => {
    expect([...fixtureEventNames].sort()).toEqual([...WEBHOOK_EVENT_NAMES].sort());
  });

  it.each(WEBHOOK_EVENT_NAMES)("%s fixture parses with the union and its own schema", (name) => {
    const payload = roundTrip(fixtures[name]);
    const union = webhookEventSchema.safeParse(payload);
    expect(union.success, JSON.stringify(union.error?.issues)).toBe(true);
    expect(eventSchemas[name].safeParse(payload).success).toBe(true);
  });
});

describe("discriminated union", () => {
  it("rejects a payload whose event does not match its data shape", () => {
    // Club payload labelled as a purchase: data.purchase is missing.
    const payload = { ...roundTrip(fixtures.CLUB_FIRST_ACCESS) as object, event: "PURCHASE_APPROVED" };
    const result = webhookEventSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join(".").startsWith("data"))).toBe(true);
  });

  it("rejects an unknown event discriminant", () => {
    const payload = { ...roundTrip(fixtures.PURCHASE_APPROVED) as object, event: "PURCHASE_SOMETHING_NEW" };
    expect(webhookEventSchema.safeParse(payload).success).toBe(false);
  });

  it("each per-event schema rejects other event names", () => {
    const payload = roundTrip(fixtures.PURCHASE_REFUNDED);
    expect(eventSchemas.PURCHASE_APPROVED.safeParse(payload).success).toBe(false);
  });
});

describe("leniency", () => {
  it("keeps unknown fields (loose objects)", () => {
    const event = createFixture("PURCHASE_APPROVED");
    const payload = roundTrip(event) as Record<string, any>;
    payload.brand_new_top_level = 1;
    payload.data.purchase.brand_new_field = { nested: true };
    const result = webhookEventSchema.parse(payload) as Record<string, any>;
    expect(result.brand_new_top_level).toBe(1);
    expect(result.data.purchase.brand_new_field).toEqual({ nested: true });
  });

  it("accepts enum values Hotmart has not documented yet", () => {
    const event = createFixture("PURCHASE_APPROVED", {
      data: { purchase: { status: "SOME_NEW_STATUS", payment: { type: "NEW_WALLET" } } },
    });
    expect(webhookEventSchema.safeParse(roundTrip(event)).success).toBe(true);
  });

  it("accepts the quirks seen in the official examples", () => {
    // Mirrors the official purchase example: string order_date, data-level
    // flexPayPlan, `address` instead of `street`, MARKETPLACE commission and an
    // affiliate-style payload with no buyer or price.
    const payload = roundTrip(fixtures.PURCHASE_APPROVED) as Record<string, any>;
    payload.data.purchase.order_date = "123243546";
    payload.data.flexPayPlan = { enrollmentStatus: "ACTIVE", nextBillingDate: null, planCharges: [] };
    payload.data.commissions = [{ value: 0.65, currency_value: "BRL", source: "MARKETPLACE" }];
    delete payload.data.buyer;
    delete payload.data.purchase.price;
    delete payload.data.purchase.full_price;
    expect(webhookEventSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts an ISO string date_next_charge on UPDATE_SUBSCRIPTION_CHARGE_DATE", () => {
    const event = createFixture("UPDATE_SUBSCRIPTION_CHARGE_DATE");
    expect(typeof event.data.subscription.date_next_charge).toBe("string");
    expect(webhookEventSchema.safeParse(roundTrip(event)).success).toBe(true);
  });
});

describe("required fields", () => {
  it.each([
    ["id", (p: any) => delete p.id],
    ["creation_date", (p: any) => (p.creation_date = "yesterday")],
    ["data.purchase.transaction", (p: any) => delete p.data.purchase.transaction],
    ["data.purchase.status", (p: any) => delete p.data.purchase.status],
    ["data.product.id", (p: any) => (p.data.product.id = "1000001")],
    ["data.purchase.price.value", (p: any) => (p.data.purchase.price.value = "97.90")],
  ])("fails when %s is missing or has the wrong type", (path, mutate) => {
    const payload = roundTrip(fixtures.PURCHASE_APPROVED) as Record<string, any>;
    mutate(payload);
    const result = webhookEventSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain(path);
  });
});

describe("event metadata", () => {
  it("assigns every event to exactly one category", () => {
    const all = Object.values(eventCategories).flat();
    expect(all.sort()).toEqual([...WEBHOOK_EVENT_NAMES].sort());
    expect(getEventCategory("PURCHASE_APPROVED")).toBe("purchase");
    expect(getEventCategory("SWITCH_PLAN")).toBe("subscription");
    expect(getEventCategory("CLUB_MODULE_COMPLETED")).toBe("club");
    expect(getEventCategory("PURCHASE_OUT_OF_SHOPPING_CART")).toBe("abandonment");
    expect(getEventCategory("ORDER_FULFILLMENT")).toBe("logistics");
  });

  it("type guards", () => {
    expect(isWebhookEventName("PURCHASE_APPROVED")).toBe(true);
    expect(isWebhookEventName("NOPE")).toBe(false);
    expect(isWebhookEventName(42)).toBe(false);
    expect(isPurchaseEventName("PURCHASE_EXPIRED")).toBe(true);
    expect(isPurchaseEventName("SWITCH_PLAN")).toBe(false);
    expect(isPurchaseEventName(undefined)).toBe(false);
  });
});
