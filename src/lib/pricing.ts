export const subscriptionPlans = [
  {
    id: "starter",
    name: "Starter",
    audience: "For individuals",
    amountCents: 500,
    recommended: false,
    features: ["Expense tracking", "Receipt uploads", "Basic reports"],
  },
  {
    id: "pro",
    name: "Pro",
    audience: "For freelancers and small teams",
    amountCents: 1200,
    recommended: true,
    features: [
      "Advanced reports",
      "Multiple currencies: ZAR, USD, EUR",
      "Custom categories",
      "CSV exports",
    ],
  },
  {
    id: "business",
    name: "Business",
    audience: "For growing businesses",
    amountCents: 2500,
    recommended: false,
    features: [
      "Team access",
      "Advanced reports and insights",
      "Priority support",
      "More storage",
    ],
  },
] as const;

export type SubscriptionPlan = (typeof subscriptionPlans)[number];

export function formatUsdCents(amountCents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountCents / 100);
}

export function isSubscriptionPlanId(
  value: unknown,
): value is SubscriptionPlan["id"] {
  return (
    typeof value === "string" &&
    subscriptionPlans.some((plan) => plan.id === value)
  );
}
