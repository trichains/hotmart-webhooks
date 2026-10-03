/**
 * Fake but realistic v2.0.0 payloads for every supported event, for tests and
 * local development. Every name, e-mail, document and transaction code here is
 * made up (`@example.com`, `HP00000000xx`, all-zero documents).
 *
 * Shapes follow the official examples (see docs/REFERENCES.md). The
 * `purchase.status` chosen for each purchase event is a plausible pairing, not
 * something Hotmart documents per event.
 */
import type { WebhookEventName } from "../events.js";
// Duplicated from verify.ts so this entry does not pull in node:crypto.
const HOTTOK_HEADER = "x-hotmart-hottok";
import type { PurchaseData, PurchaseEvent, WebhookEventOf } from "../schemas/index.js";
import { deepMerge, type DeepPartial } from "./merge.js";

export { deepMerge, setPath, type DeepPartial } from "./merge.js";

const CREATED = 1767272400000; // 2026-01-01T13:00:00.000Z
const ORDERED = CREATED - 120_000;
const APPROVED = CREATED - 60_000;

const fakeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const transaction = (n: number) => `HP${String(n).padStart(10, "0")}`;

function purchaseData(n: number, purchase: Partial<PurchaseData["purchase"]>, extra: Partial<PurchaseData> = {}) {
  const data = {
    product: {
      id: 1000001,
      ucode: "00000000-0000-4000-a000-000000000101",
      name: "Curso Exemplo de Marketing Digital",
      has_co_production: false,
      warranty_date: "2026-01-08T13:00:00Z",
      support_email: "suporte@example.com",
      is_physical_product: false,
    },
    affiliates: [{ affiliate_code: "X000000000", name: "Afiliado Exemplo" }],
    buyer: {
      ucode: "00000000-0000-4000-b000-000000000201",
      email: "maria.exemplo@example.com",
      name: "Maria Exemplo da Silva",
      first_name: "Maria",
      last_name: "Exemplo da Silva",
      checkout_phone: "999990000",
      checkout_phone_code: "11",
      document: "00000000000",
      document_type: "CPF",
      address: {
        country: "Brasil",
        country_iso: "BR",
        zipcode: "01000000",
        state: "SP",
        city: "Sao Paulo",
        neighborhood: "Centro",
        address: "Rua Exemplo",
        number: "100",
        complement: "Apto 1",
      },
    },
    producer: { name: "Produtora Exemplo LTDA", document: "00000000000000", legal_nature: "Pessoa Juridica" },
    commissions: [
      { value: 9.79, currency_value: "BRL", source: "MARKETPLACE" },
      { value: 82.51, currency_value: "BRL", source: "PRODUCER" },
    ],
    purchase: {
      transaction: transaction(n),
      status: "APPROVED",
      order_date: ORDERED,
      approved_date: APPROVED,
      price: { value: 97.9, currency_value: "BRL" },
      full_price: { value: 97.9, currency_value: "BRL" },
      original_offer_price: { value: 97.9, currency_value: "BRL" },
      offer: { code: "test0001", name: "Oferta principal" },
      payment: { type: "CREDIT_CARD", installments_number: 1 },
      checkout_country: { name: "Brasil", iso: "BR" },
      origin: { src: "instagram", sck: "bio" },
      order_bump: { is_order_bump: false },
      is_funnel: false,
      business_model: "I",
      invoice_by: "HOTMART",
      ...purchase,
    },
    ...extra,
  };
  return data as PurchaseData;
}

function purchaseEvent<E extends PurchaseEvent["event"]>(
  event: E,
  n: number,
  purchase: Partial<PurchaseData["purchase"]>,
  extra: Partial<PurchaseData> = {},
): WebhookEventOf<E> {
  return {
    id: fakeId(n),
    creation_date: CREATED,
    event,
    version: "2.0.0",
    data: purchaseData(n, purchase, extra),
  } as WebhookEventOf<E>;
}

const notApproved = { approved_date: undefined };
const billet = {
  type: "BILLET",
  billet_barcode: "00000.00000 00000.000000 00000.000000 0 00000000009790",
  billet_url: "https://example.com/boleto/HP0000000006",
};

const subscription = {
  status: "DELAYED",
  plan: { id: 2000001, name: "Plano Mensal" },
  subscriber: { code: "SUB00001" },
};

/** One fixture per supported event. Treat as read-only; use `createFixture` to get a copy. */
export const fixtures: { readonly [E in WebhookEventName]: WebhookEventOf<E> } = {
  PURCHASE_APPROVED: purchaseEvent("PURCHASE_APPROVED", 1, {}),
  PURCHASE_COMPLETE: purchaseEvent("PURCHASE_COMPLETE", 2, { status: "COMPLETE" }),
  PURCHASE_CANCELED: purchaseEvent("PURCHASE_CANCELED", 3, {
    ...notApproved,
    status: "CANCELLED",
    payment: { type: "CREDIT_CARD", installments_number: 1, refusal_reason: "Transaction declined by issuer" },
  }),
  PURCHASE_REFUNDED: purchaseEvent("PURCHASE_REFUNDED", 4, { status: "REFUNDED" }),
  PURCHASE_CHARGEBACK: purchaseEvent("PURCHASE_CHARGEBACK", 5, { status: "CHARGEBACK" }),
  PURCHASE_BILLET_PRINTED: purchaseEvent("PURCHASE_BILLET_PRINTED", 6, {
    ...notApproved,
    status: "PRINTED_BILLET",
    payment: billet,
  }),
  PURCHASE_PROTEST: purchaseEvent("PURCHASE_PROTEST", 7, { status: "DISPUTE" }),
  PURCHASE_DELAYED: purchaseEvent(
    "PURCHASE_DELAYED",
    8,
    {
      ...notApproved,
      status: "OVERDUE",
      recurrence_number: 3,
      date_next_charge: CREATED + 3 * 86_400_000,
      offer: { code: "plan0001" },
      payment: { type: "CREDIT_CARD", installments_number: 1 },
    },
    { subscription },
  ),
  PURCHASE_EXPIRED: purchaseEvent("PURCHASE_EXPIRED", 9, {
    ...notApproved,
    status: "EXPIRED",
    payment: { ...billet, billet_url: "https://example.com/boleto/HP0000000009" },
  }),
  PURCHASE_OUT_OF_SHOPPING_CART: {
    id: fakeId(11),
    creation_date: CREATED,
    event: "PURCHASE_OUT_OF_SHOPPING_CART",
    version: "2.0.0",
    data: {
      affiliate: false,
      product: { id: 1000001, name: "Curso Exemplo de Marketing Digital" },
      buyer: { name: "Joao Exemplo", email: "joao.exemplo@example.com", phone: "5511999990001" },
      offer: { code: "test0001" },
      checkout_country: { name: "Brasil", iso: "BR" },
    },
  },
  SUBSCRIPTION_CANCELLATION: {
    id: fakeId(12),
    creation_date: CREATED,
    event: "SUBSCRIPTION_CANCELLATION",
    version: "2.0.0",
    data: {
      date_next_charge: CREATED + 10 * 86_400_000,
      cancellation_date: CREATED - 1_000,
      actual_recurrence_value: 49.9,
      product: { id: 1000002, name: "Clube Exemplo" },
      subscriber: {
        code: "SUB00002",
        name: "Ana Exemplo",
        email: "ana.exemplo@example.com",
        phone: { dddCell: "11", cell: "999990002" },
      },
      subscription: { id: 3000001, plan: { id: 2000001, name: "Plano Mensal" } },
    },
  },
  SWITCH_PLAN: {
    id: fakeId(13),
    creation_date: CREATED,
    event: "SWITCH_PLAN",
    version: "2.0.0",
    data: {
      switch_plan_date: CREATED - 1_000,
      subscription: {
        subscriber_code: "SUB00003",
        status: "ACTIVE",
        date_next_charge: CREATED + 30 * 86_400_000,
        product: { id: 1000002, name: "Clube Exemplo" },
        user: { email: "carlos.exemplo@example.com" },
      },
      plans: [
        { id: 2000002, name: "Plano Anual", offer: { key: "plan0002" }, current: true },
        { id: 2000001, name: "Plano Mensal", offer: { key: "plan0001" }, current: false },
      ],
    },
  },
  UPDATE_SUBSCRIPTION_CHARGE_DATE: {
    id: fakeId(14),
    creation_date: CREATED,
    event: "UPDATE_SUBSCRIPTION_CHARGE_DATE",
    version: "2.0.0",
    data: {
      subscriber: { code: "SUB00004", name: "Beatriz Exemplo", email: "beatriz.exemplo@example.com" },
      subscription: {
        product: { id: 1000002, name: "Clube Exemplo" },
        old_charge_day: 5,
        new_charge_day: 15,
        date_next_charge: "2026-01-15T12:00:00.000Z",
        status: "ACTIVE",
      },
      plan: { id: 2000001, name: "Plano Mensal", offer: { code: "plan0001" } },
    },
  },
  CLUB_FIRST_ACCESS: {
    id: fakeId(15),
    creation_date: CREATED,
    event: "CLUB_FIRST_ACCESS",
    version: "2.0.0",
    data: {
      product: { id: 1000001, name: "Curso Exemplo de Marketing Digital" },
      user: { name: "Maria Exemplo da Silva", email: "maria.exemplo@example.com" },
    },
  },
  CLUB_MODULE_COMPLETED: {
    id: fakeId(16),
    creation_date: CREATED,
    event: "CLUB_MODULE_COMPLETED",
    version: "2.0.0",
    data: {
      product: { id: 1000001, name: "Curso Exemplo de Marketing Digital" },
      user: { name: "Maria Exemplo da Silva", email: "maria.exemplo@example.com" },
      module: { id: "mod0000001", name: "Modulo 1 - Fundamentos" },
    },
  },
  ORDER_FULFILLMENT: {
    id: fakeId(17),
    creation_date: CREATED,
    event: "ORDER_FULFILLMENT",
    version: "2.0.0",
    data: {
      purchase: {
        id: 40000001,
        transaction: transaction(10),
        status: "APPROVED",
        order_date: ORDERED,
        approved_date: APPROVED,
        price: { value: 89.9, currency_value: "BRL" },
        full_price: { value: 105.8, currency_value: "BRL" },
        shopper: {
          name: "Pedro Exemplo",
          email: "pedro.exemplo@example.com",
          phone: "11999990003",
          document: "00000000000",
          country: "Brasil",
          locale: "pt_BR",
          time_zone: "America/Sao_Paulo",
          address: {
            address: "Rua Exemplo",
            number: "200",
            neighborhood: "Centro",
            city: "Sao Paulo",
            state: "SP",
            zip_code: "01000000",
            country: "Brasil",
          },
        },
      },
      line_items: [
        {
          quantity: 1,
          offer: { code: "phys0001", price: { value: 89.9, currency_value: "BRL" } },
          product: { id: 1000003, name: "Livro Exemplo (impresso)", sku: "LIVRO-001", format: "PHYSICAL" },
          variant: { id: "var0001", name: "Capa comum", sku: "LIVRO-001-CC" },
        },
      ],
      delivery: {
        method_type: "SHIPPING",
        delivery_time: 7,
        shipping_processing_time: 2,
        destination: {
          address: "Rua Exemplo",
          number: "200",
          city: "Sao Paulo",
          state: "SP",
          zip_code: "01000000",
          country: "Brasil",
        },
      },
      shipping: { shipping_total_value: { value: 15.9, currency_value: "BRL" } },
      fulfillment_service: { service_type: "MANUAL" },
    },
  },
};

/** Names of every event that has a fixture (all supported events). */
export const fixtureEventNames = Object.keys(fixtures) as WebhookEventName[];

/**
 * A fresh, deep-cloned fixture with optional deep overrides. Arrays in
 * `overrides` replace the fixture's arrays.
 *
 * ```ts
 * const event = createFixture("PURCHASE_APPROVED", {
 *   data: { purchase: { price: { value: 197 } } },
 * });
 * ```
 */
export function createFixture<E extends WebhookEventName>(
  event: E,
  overrides?: DeepPartial<WebhookEventOf<E>>,
): WebhookEventOf<E> {
  const base = fixtures[event] as WebhookEventOf<E> | undefined;
  if (!base) throw new Error(`No fixture for event "${String(event)}"`);
  return deepMerge(base, overrides);
}

export interface FixtureRequestOptions<E extends WebhookEventName> {
  /** Sent as the X-HOTMART-HOTTOK header. */
  token: string;
  /** Default: http://localhost/api/hotmart */
  url?: string;
  overrides?: DeepPartial<WebhookEventOf<E>>;
}

/**
 * A Web `Request` carrying a fixture, ready to pass to a route handler in tests:
 * `await POST(createFixtureRequest("PURCHASE_APPROVED", { token }))`.
 */
export function createFixtureRequest<E extends WebhookEventName>(
  event: E,
  options: FixtureRequestOptions<E>,
): Request {
  const body = JSON.stringify(createFixture(event, options.overrides));
  return new Request(options.url ?? "http://localhost/api/hotmart", {
    method: "POST",
    headers: { "content-type": "application/json", [HOTTOK_HEADER]: options.token },
    body,
  });
}
