import { z } from "zod";
import { SUBSCRIPTION_STATUSES } from "../events.js";
import { envelopeShape, lenientEnum, moneySchema, timestampSchema } from "./shared.js";

const idNameSchema = z.looseObject({ id: z.number(), name: z.string().optional() });

// ---------------------------------------------------------------------------
// Cart abandonment
// https://developers.hotmart.com/docs/en/2.0.0/webhook/cart-abandonment-webhook/
// ---------------------------------------------------------------------------

export const cartAbandonmentDataSchema = z.looseObject({
  /** True when the lead came from an affiliate link. */
  affiliate: z.boolean().optional(),
  product: idNameSchema,
  /** Lead data. Only what the checkout collected before the visitor left. */
  buyer: z
    .looseObject({
      name: z.string().optional(),
      email: z.string().optional(),
      /** Includes the country code. */
      phone: z.string().optional(),
    })
    .optional(),
  offer: z.looseObject({ code: z.string().optional() }).optional(),
  checkout_country: z.looseObject({ name: z.string().optional(), iso: z.string().optional() }).optional(),
});

export const purchaseOutOfShoppingCartSchema = z.looseObject({
  ...envelopeShape,
  event: z.literal("PURCHASE_OUT_OF_SHOPPING_CART"),
  data: cartAbandonmentDataSchema,
});

// ---------------------------------------------------------------------------
// Subscription cancellation
// https://developers.hotmart.com/docs/en/2.0.0/webhook/cancel-subscription-webhook/
// ---------------------------------------------------------------------------

export const subscriptionCancellationDataSchema = z.looseObject({
  /** Amount paid in the last processed charge. */
  actual_recurrence_value: z.number().optional(),
  /** Milliseconds since the Unix epoch. */
  cancellation_date: timestampSchema.optional(),
  /** Access normally ends at this date: the subscriber already paid until then. */
  date_next_charge: timestampSchema.optional(),
  product: idNameSchema,
  subscriber: z.looseObject({
    code: z.string(),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z
      .looseObject({
        dddPhone: z.string().optional(),
        phone: z.string().optional(),
        dddCell: z.string().optional(),
        cell: z.string().optional(),
      })
      .optional(),
  }),
  subscription: z.looseObject({
    id: z.number().optional(),
    plan: z.looseObject({ id: z.number().optional(), name: z.string().optional() }).optional(),
  }),
});

export const subscriptionCancellationSchema = z.looseObject({
  ...envelopeShape,
  event: z.literal("SUBSCRIPTION_CANCELLATION"),
  data: subscriptionCancellationDataSchema,
});

// ---------------------------------------------------------------------------
// Plan change
// https://developers.hotmart.com/docs/en/2.0.0/webhook/switch-plan-webhook/
// ---------------------------------------------------------------------------

export const switchPlanDataSchema = z.looseObject({
  /** Documented as "unix timestamp UTC"; the example uses milliseconds. */
  switch_plan_date: timestampSchema.optional(),
  subscription: z.looseObject({
    subscriber_code: z.string(),
    status: lenientEnum(SUBSCRIPTION_STATUSES).optional(),
    date_next_charge: timestampSchema.optional(),
    product: idNameSchema.optional(),
    user: z.looseObject({ email: z.string().optional() }).optional(),
  }),
  /** Old and new plans; the new one has `current: true`. */
  plans: z.array(
    z.looseObject({
      id: z.number().optional(),
      name: z.string().optional(),
      offer: z.looseObject({ key: z.string().optional() }).optional(),
      current: z.boolean().optional(),
    }),
  ),
});

export const switchPlanSchema = z.looseObject({
  ...envelopeShape,
  event: z.literal("SWITCH_PLAN"),
  data: switchPlanDataSchema,
});

// ---------------------------------------------------------------------------
// Billing date change
// https://developers.hotmart.com/docs/en/2.0.0/webhook/update-subscription-charge-date/
// ---------------------------------------------------------------------------

export const updateSubscriptionChargeDateDataSchema = z.looseObject({
  subscriber: z.looseObject({
    code: z.string(),
    name: z.string().optional(),
    email: z.string().optional(),
  }),
  subscription: z.looseObject({
    product: idNameSchema.optional(),
    old_charge_day: z.number().optional(),
    new_charge_day: z.number().optional(),
    /** The official example sends an ISO string here, unlike other events. */
    date_next_charge: timestampSchema.optional(),
    status: lenientEnum(SUBSCRIPTION_STATUSES).optional(),
  }),
  plan: z
    .looseObject({
      id: z.number().optional(),
      name: z.string().optional(),
      offer: z.looseObject({ code: z.string().optional() }).optional(),
    })
    .optional(),
});

export const updateSubscriptionChargeDateSchema = z.looseObject({
  ...envelopeShape,
  event: z.literal("UPDATE_SUBSCRIPTION_CHARGE_DATE"),
  data: updateSubscriptionChargeDateDataSchema,
});

// ---------------------------------------------------------------------------
// Hotmart Club (members area)
// https://developers.hotmart.com/docs/en/2.0.0/webhook/club-first-access/
// https://developers.hotmart.com/docs/en/2.0.0/webhook/club-module-completed/
// ---------------------------------------------------------------------------

const clubUserSchema = z.looseObject({ name: z.string().optional(), email: z.string() });

export const clubFirstAccessSchema = z.looseObject({
  ...envelopeShape,
  event: z.literal("CLUB_FIRST_ACCESS"),
  data: z.looseObject({ product: idNameSchema, user: clubUserSchema }),
});

export const clubModuleCompletedSchema = z.looseObject({
  ...envelopeShape,
  event: z.literal("CLUB_MODULE_COMPLETED"),
  data: z.looseObject({
    product: idNameSchema,
    user: clubUserSchema,
    module: z.looseObject({ id: z.string(), name: z.string().optional() }),
  }),
});

// ---------------------------------------------------------------------------
// Logistics data (physical products)
// https://developers.hotmart.com/docs/en/2.0.0/webhook/order-fulfillment-webhook/
// Only the fields most integrations need are typed; the rest passes through.
// ---------------------------------------------------------------------------

const fulfillmentAddressSchema = z.looseObject({
  address: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip_code: z.string().optional(),
  country: z.string().optional(),
});

const fulfillmentPersonSchema = z.looseObject({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  document: z.string().optional(),
  country: z.string().optional(),
  ucode: z.string().optional(),
  locale: z.string().optional(),
  time_zone: z.string().optional(),
  address: fulfillmentAddressSchema.optional(),
});

export const orderFulfillmentDataSchema = z.looseObject({
  purchase: z.looseObject({
    transaction: z.string().min(1),
    /** Always "APPROVED" for this event, per the docs. */
    status: z.string(),
    id: z.number().optional(),
    approved_date: timestampSchema.optional(),
    order_date: timestampSchema.optional(),
    price: moneySchema.optional(),
    full_price: moneySchema.optional(),
    shopper: fulfillmentPersonSchema.optional(),
  }),
  line_items: z.array(
    z.looseObject({
      quantity: z.number().optional(),
      offer: z.looseObject({ code: z.string().optional(), price: moneySchema.optional() }).optional(),
      product: z
        .looseObject({
          id: z.number(),
          name: z.string().optional(),
          sku: z.string().optional(),
          external_id: z.string().optional(),
          format: z.string().optional(),
        })
        .optional(),
      variant: z
        .looseObject({
          id: z.string().optional(),
          name: z.string().optional(),
          sku: z.string().optional(),
        })
        .optional(),
    }),
  ),
  delivery: z
    .looseObject({
      method_type: z.string().optional(),
      delivery_time: z.number().optional(),
      shipping_processing_time: z.number().optional(),
      destination: fulfillmentAddressSchema.optional(),
    })
    .optional(),
  shipping: z.looseObject({ shipping_total_value: moneySchema.optional() }).optional(),
  fulfillment_service: z.looseObject({ service_type: z.string().optional() }).optional(),
  billing: fulfillmentPersonSchema.optional(),
});

export const orderFulfillmentSchema = z.looseObject({
  ...envelopeShape,
  event: z.literal("ORDER_FULFILLMENT"),
  data: orderFulfillmentDataSchema,
});
