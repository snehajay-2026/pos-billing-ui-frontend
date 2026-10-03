// Tests for subscriptionService.
//
// The backend is the source of truth for tenant, pricing, and provider
// plan selection. These tests pin the request contract: the frontend may
// send ONLY planId + billingCycle on create, and never amount, provider
// plan IDs, tenant email, or store scope.

const postCalls = [];
const getCalls = [];

jest.mock("../api", () => ({
  apiGet: (...args) => {
    getCalls.push(args);
    return Promise.resolve(null);
  },
  apiPost: (...args) => {
    postCalls.push(args);
    return Promise.resolve({ id: 1, status: "trialing" });
  },
}));

import {
  getActivePlans,
  getMySubscription,
  createSubscription,
  cancelSubscription,
} from "../subscriptionService";

describe("subscriptionService", () => {
  beforeEach(() => {
    postCalls.length = 0;
    getCalls.length = 0;
  });

  test("loads active plans from the catalogue endpoint", async () => {
    await getActivePlans();
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0][0]).toBe("/api/subscriptions/plans/active");
  });

  test("loads the current tenant subscription", async () => {
    await getMySubscription();
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0][0]).toBe("/api/subscriptions/my");
  });

  test("create sends only planId and billingCycle", async () => {
    await createSubscription({ planId: 5, billingCycle: "monthly" });
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0][0]).toBe("/api/subscriptions");
    expect(postCalls[0][1]).toEqual({ planId: 5, billingCycle: "monthly" });
  });

  test("create body never carries amount, provider IDs, tenant email, or store scope", async () => {
    await createSubscription({ planId: 5, billingCycle: "yearly" });
    const body = postCalls[0][1];
    for (const forbidden of [
      "amount",
      "price",
      "providerPlanId",
      "provider_plan_id",
      "providerPlanIdYearly",
      "tenantEmail",
      "tenant_email",
      "storeId",
      "storeType",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(body).sort()).toEqual(["billingCycle", "planId"]);
  });

  test("cancel uses the existing cancellation endpoint with no body payload", async () => {
    await cancelSubscription(42);
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0][0]).toBe("/api/subscriptions/42/cancel");
    expect(postCalls[0][1]).toEqual({});
  });
});

describe("hosted-checkout verify helper", () => {
  const { verifySubscriptionPayment } = require("../subscriptionService");

  test("verify posts only the three provider params to /api/subscriptions/verify", async () => {
    await verifySubscriptionPayment({
      razorpay_payment_id: "pay_AAA",
      razorpay_subscription_id: "sub_X",
      razorpay_signature: "sig",
    });
    const last = postCalls[postCalls.length - 1];
    expect(last[0]).toBe("/api/subscriptions/verify");
    expect(last[1]).toEqual({
      razorpay_payment_id: "pay_AAA",
      razorpay_subscription_id: "sub_X",
      razorpay_signature: "sig",
    });
  });

  test("verify body never carries local ids, tenant email, or secrets", async () => {
    await verifySubscriptionPayment({
      razorpay_payment_id: "pay_AAA",
      razorpay_subscription_id: "sub_X",
      razorpay_signature: "sig",
    });
    const body = postCalls[postCalls.length - 1][1];
    for (const forbidden of [
      "subscriptionId",
      "tenantEmail",
      "tenant_email",
      "keyId",
      "keySecret",
      "secret",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(body).sort()).toEqual([
      "razorpay_payment_id",
      "razorpay_signature",
      "razorpay_subscription_id",
    ]);
  });
});
