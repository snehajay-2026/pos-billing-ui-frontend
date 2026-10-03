// superOwnerService.js
//
// Data layer for the Super Owner console. getPlatformOverview() calls the
// SUPER_OWNER-only GET /api/super/overview (platform aggregates — no
// personal data, no payment rows). The remaining helpers are pass-throughs
// to existing public services for the below-the-cards panels.

import { apiGet } from "./api";
import { getActivePlans, getMySubscription } from "./subscriptionService";
import { getUsers } from "./userService";
import { getAuditLog } from "./auditLogService";
import { getDashboardSummary } from "./dashboardService";

/**
 * Platform-wide aggregates for the nine dashboard cards. Response shape:
 * { tenants: { total }, stores: { total, branches: null },
 *   users: { total }, subscriptions: { total, trialing, active, past_due,
 *   cancelled, expired }, revenue: { monthly, yearly, currency: "INR",
 *   definition }, meta: { generatedAt, branchesUnavailable } }
 * branches is always null — no branch registry table exists (see
 * meta.branchesUnavailable). Revenue is gross captured rupees, calendar
 * month/year-to-date; see revenue.definition in the response.
 */
export const getPlatformOverview = () => apiGet("/api/super/overview");

/**
 * Read the Super Owner's own subscription context. Mirrors the
 * SubscriptionPage flow so the dashboard can render an honest "your own
 * subscription" card alongside the cross-tenant empty cards.
 */
export const getSuperOwnerContext = async () => {
  const [plans, mine] = await Promise.all([getActivePlans(), getMySubscription()]);
  return { plans: Array.isArray(plans) ? plans : [], subscription: mine || null };
};

/**
 * Recent audit-log entries for the dashboard's "platform activity" tile.
 * Limit is small so the dashboard call stays cheap.
 */
export const getRecentPlatformActivity = async (limit = 5) => {
  const res = await getAuditLog({ limit });
  return Array.isArray(res?.rows) ? res.rows.slice(0, limit) : [];
};

/**
 * Unscoped dashboard summary shown in the "Available Data Today" tile.
 * For SUPER_OWNER without a store scope this reflects unscoped
 * (platform-wide) figures, not just the Super Owner's own tenant.
 */
export const getOwnDashboardSummary = async () => {
  const res = await getDashboardSummary({});
  return res || null;
};

/**
 * Platform payment history for the Super Owner Payments page.
 * GET /api/super/payment-records (SUPER_OWNER only). Response shape:
 * { records: [{ id, tenantEmail, subscriptionId, providerPaymentId,
 *   amount, currency, status, createdAt }], total, page, limit }
 * Supported statuses are the payment_records ENUM: created, authorized,
 * captured, failed, refunded. Page size is capped server-side at 100.
 */
export const listPlatformPaymentRecords = ({ status, page, limit } = {}) =>
  apiGet("/api/super/payment-records", { status, page, limit });

/**
 * Platform subscription-event history for the Super Owner Payments page.
 * GET /api/super/subscription-events (SUPER_OWNER only). Response shape:
 * { events: [{ id, tenantEmail, subscriptionId, eventType, createdAt }],
 *   total, page, limit }
 * The raw payload JSON is never exposed — event_type IS the lifecycle
 * marker, so no status filter is offered. Page size capped at 100 server-side.
 */
export const listPlatformSubscriptionEvents = ({ page, limit } = {}) =>
  apiGet("/api/super/subscription-events", { page, limit });

/**
 * Platform tenant directory for the Super Owner Tenants page.
 * GET /api/super/tenants (SUPER_OWNER only). Response shape:
 * { tenants: [{ tenantEmail, userCount, storeCount, subscriptionStatus,
 *   planName, firstSeen }], total, page, limit }
 * Tenants are distinct business-owner identities (root_owner_email ||
 * owner_email || email); branch users fold into their owner's tenant.
 * Page size capped at 100 server-side.
 */
export const listPlatformTenants = ({ page, limit } = {}) =>
  apiGet("/api/super/tenants", { page, limit });

/**
 * Single-tenant detail for the Super Owner Tenants page.
 * GET /api/super/tenants/:tenantEmail (SUPER_OWNER only). Response shape:
 * { tenant: { tenantEmail, userCount, storeCount,
 *   subscription: { status, planName, billingCycle } | null, firstSeen },
 *   users: [{ email, role, storeType, storeId, createdAt }], stores: [...] }
 * The email is URL-encoded so branch-style addresses survive the path.
 */
export const getTenantDetail = (tenantEmail) =>
  apiGet(`/api/super/tenants/${encodeURIComponent(tenantEmail)}`);

/**
 * Platform user list from the existing GET /api/users, which for
 * SUPER_OWNER returns the platform-wide rows. No dedicated pagination or
 * per-tenant enrichment until GET /api/super/tenants lands.
 */
export const listSuperOwnerUsers = async () => {
  const res = await getUsers();
  return Array.isArray(res) ? res : [];
};
