import { z } from "zod";
import {
  COMMISSION_SOURCES,
  PAYMENT_TYPES,
  PURCHASE_STATUSES,
  SUBSCRIPTION_STATUSES,
  type PurchaseEventName,
} from "../events.js";
import { envelopeShape, lenientEnum, moneySchema, timestampSchema } from "./shared.js";

// Source: https://developers.hotmart.com/docs/en/2.0.0/webhook/purchase-webhook/
// The page documents three views of the same payload (producer, co-producer,
// affiliate). Affiliates do not receive `buyer`, `price` or `full_price`, which
// is why most fields below are optional. Required fields are the ones every
// view documents and that integrations depend on.

export const bundleProductSchema = z.looseObject({
  id: z.number(),
  ucode: z.string().optional(),
  name: z.string().optional(),
  is_physical_product: z.boolean().optional(),
});

export const productSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  ucode: z.string().optional(),
  has_co_production: z.boolean().optional(),
  /** ISO 8601 date-time string. */
  warranty_date: z.string().optional(),
  support_email: z.string().optional(),
  is_physical_product: z.boolean().optional(),
  sku: z.string().optional(),
  external_id: z.string().optional(),
  content: z
    .looseObject({
      has_physical_products: z.boolean().optional(),
      products: z.array(bundleProductSchema).optional(),
    })
    .optional(),
});
export type Product = z.infer<typeof productSchema>;

export const addressSchema = z.looseObject({
  country_iso: z.string().optional(),
  country: z.string().optional(),
  zipcode: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  neighborhood: z.string().optional(),
  /** The field table calls it `street`; the official example sends `address`. Both are modelled. */
  street: z.string().optional(),
  address: z.string().optional(),
  complement: z.string().optional(),
  number: z.string().optional(),
});

export const buyerSchema = z.looseObject({
  /** Only returned when the checkout collected it; in practice present for producers. */
  email: z.string().optional(),
  name: z.string().optional(),
  ucode: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  checkout_phone: z.string().optional(),
  /** Area code (DDD), Brazilian buyers only. */
  checkout_phone_code: z.string().optional(),
  document: z.string().optional(),
  document_type: z.string().optional(),
  address: addressSchema.optional(),
});
export type Buyer = z.infer<typeof buyerSchema>;

export const producerSchema = z.looseObject({
  name: z.string().optional(),
  document: z.string().optional(),
  legal_nature: z.string().optional(),
});

export const affiliateSchema = z.looseObject({
  affiliate_code: z.string().optional(),
  name: z.string().optional(),
});

export const commissionSchema = z.looseObject({
  value: z.number(),
  currency_value: z.string(),
  source: lenientEnum(COMMISSION_SOURCES).optional(),
  currency_conversion: z
    .looseObject({
      converted_value: z.number().optional(),
      converted_to_currency: z.string().optional(),
      conversion_rate: z.number().optional(),
    })
    .optional(),
});

export const paymentSchema = z.looseObject({
  type: lenientEnum(PAYMENT_TYPES).optional(),
  installments_number: z.number().optional(),
  billet_barcode: z.string().optional(),
  billet_url: z.string().optional(),
  pix_code: z.string().optional(),
  pix_expiration_date: timestampSchema.optional(),
  pix_qrcode: z.string().optional(),
  refusal_reason: z.string().optional(),
});

/**
 * High Ticket ("FlexPay") plan. The field table places it at
 * `purchase.flexPayPlan`, while the official JSON example places it at
 * `data.flexPayPlan`. It is accepted in both places.
 */
export const flexPayPlanSchema = z.looseObject({
  checkoutKey: z.string().optional(),
  originFeature: z.string().optional(),
  signupTransactionReference: z.string().optional(),
  enrollmentStatus: z.string().optional(),
  nextBillingDate: z.string().nullable().optional(),
  planCharges: z
    .array(
      z.looseObject({
        stepOrder: z.number().optional(),
        stepLimit: z.number().optional(),
        stepRecurrence: z.number().optional(),
        status: z.string().optional(),
        currencyCodeTo: z.string().optional(),
        value: z.number().optional(),
        paidValue: z.number().optional(),
        installments: z.number().optional(),
        dueDate: z.string().optional(),
        lastTransaction: z
          .looseObject({
            createdAt: z.string().optional(),
            transaction: z.string().optional(),
            paymentType: z.string().optional(),
            isNegotiation: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export const purchaseSchema = z.looseObject({
  /** Transaction code, e.g. "HP17715690036014". */
  transaction: z.string().min(1),
  status: lenientEnum(PURCHASE_STATUSES),
  approved_date: timestampSchema.optional(),
  order_date: timestampSchema.optional(),
  date_next_charge: timestampSchema.optional(),
  price: moneySchema.optional(),
  full_price: moneySchema.optional(),
  original_offer_price: moneySchema.optional(),
  offer: z
    .looseObject({
      code: z.string().optional(),
      coupon_code: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      /** Subscription products only. Up to 10 string key/value pairs. */
      metadata: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  payment: paymentSchema.optional(),
  checkout_country: z.looseObject({ name: z.string().optional(), iso: z.string().optional() }).optional(),
  origin: z
    .looseObject({ src: z.string().optional(), sck: z.string().optional(), xcod: z.string().optional() })
    .optional(),
  order_bump: z
    .looseObject({
      is_order_bump: z.boolean().optional(),
      parent_purchase_transaction: z.string().optional(),
    })
    .optional(),
  recurrence_number: z.number().optional(),
  subscription_anticipation_purchase: z.boolean().optional(),
  invoice_by: z.string().optional(),
  is_funnel: z.boolean().optional(),
  event_tickets: z.looseObject({ amount: z.number().optional() }).optional(),
  /** "R", "A" or "I" (tax model). */
  business_model: z.string().optional(),
  variants: z
    .looseObject({
      sku: z.string().optional(),
      attributes: z.array(z.looseObject({ name: z.string(), value: z.string() })).optional(),
      price: moneySchema.optional(),
      external_id: z.string().optional(),
    })
    .optional(),
  flexPayPlan: flexPayPlanSchema.optional(),
});
export type Purchase = z.infer<typeof purchaseSchema>;

export const purchaseSubscriptionSchema = z.looseObject({
  status: lenientEnum(SUBSCRIPTION_STATUSES).optional(),
  plan: z.looseObject({ id: z.number().optional(), name: z.string().optional() }).optional(),
  subscriber: z.looseObject({ code: z.string().optional() }).optional(),
});

export const shippingSchema = z.looseObject({
  cost: moneySchema.optional(),
  estimated_delivery_days: z.number().optional(),
  carrier: z.looseObject({ name: z.string().optional(), service: z.string().optional() }).optional(),
  fulfillment: z.looseObject({ service: z.string().optional() }).optional(),
});

export const purchaseDataSchema = z.looseObject({
  product: productSchema,
  purchase: purchaseSchema,
  buyer: buyerSchema.optional(),
  producer: producerSchema.optional(),
  affiliates: z.array(affiliateSchema).optional(),
  commissions: z.array(commissionSchema).optional(),
  subscription: purchaseSubscriptionSchema.optional(),
  shipping: shippingSchema.optional(),
  flexPayPlan: flexPayPlanSchema.optional(),
});
export type PurchaseData = z.infer<typeof purchaseDataSchema>;

function purchaseEvent<const E extends PurchaseEventName>(event: E) {
  return z.looseObject({ ...envelopeShape, event: z.literal(event), data: purchaseDataSchema });
}

export const purchaseApprovedSchema = purchaseEvent("PURCHASE_APPROVED");
export const purchaseCompleteSchema = purchaseEvent("PURCHASE_COMPLETE");
export const purchaseCanceledSchema = purchaseEvent("PURCHASE_CANCELED");
export const purchaseRefundedSchema = purchaseEvent("PURCHASE_REFUNDED");
export const purchaseChargebackSchema = purchaseEvent("PURCHASE_CHARGEBACK");
export const purchaseBilletPrintedSchema = purchaseEvent("PURCHASE_BILLET_PRINTED");
export const purchaseProtestSchema = purchaseEvent("PURCHASE_PROTEST");
export const purchaseDelayedSchema = purchaseEvent("PURCHASE_DELAYED");
export const purchaseExpiredSchema = purchaseEvent("PURCHASE_EXPIRED");
