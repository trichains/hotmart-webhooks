# References

Sources used to model the payloads, checked on 2026-10-02. The developer portal is a static site; its pages and JSON examples were read from the published page data. Hotmart can change these pages at any time; if something here disagrees with what your endpoint actually receives, trust the real payload and open an issue.

## Official Hotmart docs (webhook v2.0.0)

| Topic | URL |
| --- | --- |
| Purchase events ("Request events"): PURCHASE_APPROVED, _COMPLETE, _CANCELED, _REFUNDED, _CHARGEBACK, _BILLET_PRINTED, _PROTEST, _DELAYED, _EXPIRED | https://developers.hotmart.com/docs/en/2.0.0/webhook/purchase-webhook/ |
| Cart abandonment: PURCHASE_OUT_OF_SHOPPING_CART | https://developers.hotmart.com/docs/en/2.0.0/webhook/cart-abandonment-webhook/ |
| Subscription cancellation: SUBSCRIPTION_CANCELLATION | https://developers.hotmart.com/docs/en/2.0.0/webhook/cancel-subscription-webhook/ |
| Plan change: SWITCH_PLAN | https://developers.hotmart.com/docs/en/2.0.0/webhook/switch-plan-webhook/ |
| Billing date change: UPDATE_SUBSCRIPTION_CHARGE_DATE | https://developers.hotmart.com/docs/en/2.0.0/webhook/update-subscription-charge-date/ |
| Club first access: CLUB_FIRST_ACCESS | https://developers.hotmart.com/docs/en/2.0.0/webhook/club-first-access/ |
| Club module completed: CLUB_MODULE_COMPLETED | https://developers.hotmart.com/docs/en/2.0.0/webhook/club-module-completed/ |
| Logistics data (physical products): ORDER_FULFILLMENT | https://developers.hotmart.com/docs/en/2.0.0/webhook/order-fulfillment-webhook/ |
| Using webhooks for subscriptions (hottok in `X-HOTMART-HOTTOK`) | https://developers.hotmart.com/docs/en/tutorials/use-webhook-for-subscriptions/ |
| HTTP response codes and how Hotmart reads them | https://developers.hotmart.com/docs/en/1.0.0/webhook/http-response-codes-webhook/ |
| v1.0.0 purchase webhook (legacy, `hottok` as a field) | https://developers.hotmart.com/docs/en/1.0.0/webhook/purchase-webhook/ |
| Changelog | https://developers.hotmart.com/docs/en/changelog |

## Hotmart help center

| Topic | URL |
| --- | --- |
| Setting up webhooks: failed posts are resent automatically up to five times, manual resend from the history tab, configuration auto-deactivated when the URL keeps failing | https://help.hotmart.com/en/article/360001491352/how-to-set-up-your-api-through-webhook-postback- (pt-BR: https://suportehotmart.zendesk.com/hc/pt-br/articles/360001491352) |

Portuguese versions live under `/docs/pt-BR/` with the same paths.

## Notes and inconsistencies found in the docs

These are the reasons some fields are optional or accept more than one type.

- **Token location.** v2.0.0 sends the hottok in the `X-HOTMART-HOTTOK` HTTP header. The v1.0.0 page documents `hottok` as a payload field. Some old integrations pass it as a `?hottok=` query string; the library supports that only behind `allowQueryToken: true`.
- **Three views of the purchase payload.** The purchase page has separate tables for producer, co-producer and affiliate. Affiliates do not get `buyer`, `purchase.price` or `purchase.full_price`, so those are optional.
- **`purchase.order_date`.** Documented as milliseconds, but the official example sends the string `"123243546"`. Timestamps accept `number | string`; `toDate()` normalises them.
- **`flexPayPlan`.** The field table says `purchase.flexPayPlan`; the example JSON has it at `data.flexPayPlan`. Both are accepted.
- **Buyer address.** The table names the street field `street`; the example sends `address`. Both are modelled.
- **Commission sources.** The table lists PRODUCER, COPRODUCER, AFFILIATE and ADDON; the example uses MARKETPLACE. Enum-like fields are typed with the known values but accept any string.
- **Payment types.** The producer table and the co-producer/affiliate tables list different values (e.g. HOTCARD, WALLET vs DEBIT, BALANCE_HOTMART). `PAYMENT_TYPES` is the union.
- **Subscription statuses.** Spelled `CANCELLED_BY_SELLER` on the purchase page, `CANCELED_BY_VENDOR` on the plan-change page, and the tutorial mentions `PAST_DUE`. All are listed; any string is accepted.
- **`UNDER_ANALISYS`.** The purchase status is spelled this way in the docs and kept as-is.
- **Invalid JSON in examples.** The SUBSCRIPTION_CANCELLATION and UPDATE_SUBSCRIPTION_CHARGE_DATE examples are missing a comma after `"version"`; the field tables were used instead.
- **`UPDATE_SUBSCRIPTION_CHARGE_DATE.date_next_charge`** is an ISO string in the example, while other events use milliseconds.
- **`SWITCH_PLAN.switch_plan_date`** is described as a "unix timestamp", but the example value is in milliseconds. `toDate()` treats values below 1e11 as seconds.
- **ORDER_FULFILLMENT** was added to the docs in June 2026. Only the commonly used fields are typed; the rest passes through untouched.

## Not covered

- Events not listed in the v2.0.0 docs above (for example any event Hotmart adds later). They are acknowledged with `200 { ignored: "unsupported_event" }` and exposed via `error.payload` in `parseWebhook`.
- Hotmart's REST APIs (sales history, subscriptions, refunds). This package only handles incoming webhooks.

## Other standards

- ISO 4217 minor units (for `toMinorUnits`): https://www.six-group.com/en/products-services/financial-information/data-standards.html
