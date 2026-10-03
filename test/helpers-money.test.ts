import { describe, expect, it } from "vitest";
import {
  currencyDecimals,
  fromMinorUnits,
  getBuyer,
  getSubscriberCode,
  getTransactionId,
  isApprovedPurchase,
  isPurchaseEvent,
  normalizePurchase,
  toDate,
  toMinorUnits,
  type PurchaseEvent,
} from "../src/index.js";
import { createFixture, fixtures } from "../src/fixtures/index.js";

describe("toMinorUnits", () => {
  it.each([
    [97.9, "BRL", 9790],
    [97.0, "BRL", 9700],
    [0.1 + 0.2, "BRL", 30],
    [1.005, "BRL", 101],
    [1.015, "USD", 102],
    [19.999, "BRL", 2000],
    [0, "BRL", 0],
    [1500, "JPY", 1500],
    [1500.5, "JPY", 1501],
    [12000, "CLP", 12000],
    [1.2345, "KWD", 1235],
    [10, "CLF", 100000],
    [1e-7, "BRL", 0],
    [123456789.12, "BRL", 12345678912],
    [-97.9, "BRL", -9790],
    [-1.005, "BRL", -101],
    [-0.001, "BRL", 0],
  ])("%d %s -> %d", (value, currency, expected) => {
    expect(toMinorUnits(value, currency)).toBe(expected);
  });

  it("accepts a Hotmart money object", () => {
    expect(toMinorUnits({ value: 97.9, currency_value: "BRL" })).toBe(9790);
    expect(toMinorUnits(fixtures.PURCHASE_APPROVED.data.purchase.price!)).toBe(9790);
  });

  it("normalises the currency code", () => {
    expect(toMinorUnits(10, " jpy ")).toBe(10);
  });

  it("rejects invalid input", () => {
    expect(() => toMinorUnits(Number.NaN, "BRL")).toThrow(RangeError);
    expect(() => toMinorUnits(Infinity, "BRL")).toThrow(RangeError);
    expect(() => toMinorUnits(1, "REAL")).toThrow(RangeError);
    // @ts-expect-error -- runtime guard for JS callers
    expect(() => toMinorUnits(1)).toThrow(TypeError);
  });

  it("fromMinorUnits is the inverse", () => {
    expect(fromMinorUnits(9790, "BRL")).toBe(97.9);
    expect(fromMinorUnits(1500, "JPY")).toBe(1500);
    expect(fromMinorUnits(1235, "KWD")).toBe(1.235);
    expect(() => fromMinorUnits(1.5, "BRL")).toThrow(RangeError);
  });

  it("currencyDecimals", () => {
    expect(currencyDecimals("BRL")).toBe(2);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("BHD")).toBe(3);
    expect(currencyDecimals("UYW")).toBe(4);
  });
});

describe("isApprovedPurchase", () => {
  it("is true for APPROVED/COMPLETE events with a paid status", () => {
    expect(isApprovedPurchase(fixtures.PURCHASE_APPROVED)).toBe(true);
    expect(isApprovedPurchase(fixtures.PURCHASE_COMPLETE)).toBe(true);
  });

  it("is false when the status disagrees with the event name", () => {
    const started = createFixture("PURCHASE_APPROVED", { data: { purchase: { status: "STARTED" } } });
    expect(isApprovedPurchase(started)).toBe(false);
  });

  it("is false for other events, even with an APPROVED status", () => {
    const refunded = createFixture("PURCHASE_REFUNDED", { data: { purchase: { status: "APPROVED" } } });
    expect(isApprovedPurchase(refunded)).toBe(false);
    expect(isApprovedPurchase(fixtures.CLUB_FIRST_ACCESS)).toBe(false);
    expect(isApprovedPurchase(fixtures.ORDER_FULFILLMENT)).toBe(false);
  });

  it("isPurchaseEvent narrows the nine purchase events", () => {
    expect(isPurchaseEvent(fixtures.PURCHASE_EXPIRED)).toBe(true);
    expect(isPurchaseEvent(fixtures.PURCHASE_OUT_OF_SHOPPING_CART)).toBe(false);
  });
});

describe("getBuyer", () => {
  it("reads the buyer from every event family", () => {
    expect(getBuyer(fixtures.PURCHASE_APPROVED)).toEqual({
      email: "maria.exemplo@example.com",
      name: "Maria Exemplo da Silva",
      phone: "11999990000",
    });
    expect(getBuyer(fixtures.PURCHASE_OUT_OF_SHOPPING_CART)).toEqual({
      email: "joao.exemplo@example.com",
      name: "Joao Exemplo",
      phone: "5511999990001",
    });
    expect(getBuyer(fixtures.SUBSCRIPTION_CANCELLATION)).toEqual({
      email: "ana.exemplo@example.com",
      name: "Ana Exemplo",
      phone: "11999990002",
    });
    expect(getBuyer(fixtures.UPDATE_SUBSCRIPTION_CHARGE_DATE)).toEqual({
      email: "beatriz.exemplo@example.com",
      name: "Beatriz Exemplo",
    });
    expect(getBuyer(fixtures.SWITCH_PLAN)).toEqual({ email: "carlos.exemplo@example.com" });
    expect(getBuyer(fixtures.CLUB_FIRST_ACCESS)?.email).toBe("maria.exemplo@example.com");
    expect(getBuyer(fixtures.CLUB_MODULE_COMPLETED)?.name).toBe("Maria Exemplo da Silva");
    expect(getBuyer(fixtures.ORDER_FULFILLMENT)).toEqual({
      email: "pedro.exemplo@example.com",
      name: "Pedro Exemplo",
      phone: "11999990003",
    });
  });

  it("handles missing or partial personal data", () => {
    const affiliateView = createFixture("PURCHASE_APPROVED");
    delete (affiliateView.data as { buyer?: unknown }).buyer;
    expect(getBuyer(affiliateView)).toBeUndefined();

    const noName = createFixture("PURCHASE_APPROVED");
    noName.data.buyer = { first_name: "Ana", last_name: "Lima", checkout_phone: "999" };
    expect(getBuyer(noName)).toEqual({ name: "Ana Lima", phone: "999" });

    const empty = createFixture("PURCHASE_APPROVED");
    empty.data.buyer = {};
    expect(getBuyer(empty)).toBeUndefined();

    const lead = createFixture("PURCHASE_OUT_OF_SHOPPING_CART");
    delete (lead.data as { buyer?: unknown }).buyer;
    expect(getBuyer(lead)).toBeUndefined();

    const landline = createFixture("SUBSCRIPTION_CANCELLATION");
    landline.data.subscriber.phone = { dddPhone: "11", phone: "33330000" };
    expect(getBuyer(landline)?.phone).toBe("1133330000");

    const noShopper = createFixture("ORDER_FULFILLMENT");
    delete (noShopper.data.purchase as { shopper?: unknown }).shopper;
    expect(getBuyer(noShopper)).toBeUndefined();
  });
});

describe("ids", () => {
  it("getTransactionId", () => {
    expect(getTransactionId(fixtures.PURCHASE_REFUNDED)).toBe("HP0000000004");
    expect(getTransactionId(fixtures.ORDER_FULFILLMENT)).toBe("HP0000000010");
    expect(getTransactionId(fixtures.SWITCH_PLAN)).toBeUndefined();
  });

  it("getSubscriberCode", () => {
    expect(getSubscriberCode(fixtures.PURCHASE_DELAYED)).toBe("SUB00001");
    expect(getSubscriberCode(fixtures.SUBSCRIPTION_CANCELLATION)).toBe("SUB00002");
    expect(getSubscriberCode(fixtures.SWITCH_PLAN)).toBe("SUB00003");
    expect(getSubscriberCode(fixtures.UPDATE_SUBSCRIPTION_CHARGE_DATE)).toBe("SUB00004");
    expect(getSubscriberCode(fixtures.PURCHASE_APPROVED)).toBeUndefined();
    expect(getSubscriberCode(fixtures.CLUB_FIRST_ACCESS)).toBeUndefined();
  });
});

describe("toDate", () => {
  it.each([
    [1767272400000, "2026-01-01T13:00:00.000Z"],
    [1767272400, "2026-01-01T13:00:00.000Z"],
    ["1767272400000", "2026-01-01T13:00:00.000Z"],
    ["2022-09-01T12:00:00.000Z", "2022-09-01T12:00:00.000Z"],
  ])("%j -> %s", (input, iso) => {
    expect(toDate(input)?.toISOString()).toBe(iso);
  });

  it.each([null, undefined, "", "not a date"])("%j -> null", (input) => {
    expect(toDate(input)).toBeNull();
  });
});

describe("normalizePurchase", () => {
  it("flattens a purchase event", () => {
    expect(normalizePurchase(fixtures.PURCHASE_APPROVED)).toEqual({
      event: "PURCHASE_APPROVED",
      eventId: fixtures.PURCHASE_APPROVED.id,
      transaction: "HP0000000001",
      status: "APPROVED",
      offerCode: "test0001",
      productId: 1000001,
      productName: "Curso Exemplo de Marketing Digital",
      buyerEmail: "maria.exemplo@example.com",
      buyerName: "Maria Exemplo da Silva",
      priceValue: 97.9,
      currency: "BRL",
      fullPriceValue: 97.9,
      paymentType: "CREDIT_CARD",
      installments: 1,
      approvedAt: new Date(1767272340000),
      orderedAt: new Date(1767272280000),
      isOrderBump: false,
      parentTransaction: null,
      subscriberCode: null,
      recurrenceNumber: null,
    });
  });

  it("uses null for everything an affiliate view omits", () => {
    const event = createFixture("PURCHASE_DELAYED", {
      data: { purchase: { order_bump: { is_order_bump: true, parent_purchase_transaction: "HP0000000099" } } },
    }) as PurchaseEvent;
    delete (event.data as { buyer?: unknown }).buyer;
    const p = event.data.purchase as Record<string, unknown>;
    delete p.price;
    delete p.offer;
    delete p.payment;
    delete p.order_date;

    const normalized = normalizePurchase(event);
    expect(normalized).toMatchObject({
      buyerEmail: null,
      buyerName: null,
      priceValue: null,
      currency: "BRL", // falls back to full_price
      offerCode: null,
      paymentType: null,
      installments: null,
      approvedAt: null,
      orderedAt: null,
      isOrderBump: true,
      parentTransaction: "HP0000000099",
      subscriberCode: "SUB00001",
      recurrenceNumber: 3,
    });

    delete p.full_price;
    expect(normalizePurchase(event).currency).toBeNull();
  });
});
