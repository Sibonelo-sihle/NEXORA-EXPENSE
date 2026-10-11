export function workspaceResult<T extends { error: any }>(
  result: T,
  operation: string,
): T {
  if (result.error) {
    const code = result.error.code ? ` (${result.error.code})` : "";
    throw new Error(
      `${operation} failed${code}: ${result.error.message || "Database request failed"}`,
    );
  }
  return result;
}
export function workspaceId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error(
      "bootstrap_business must return a UUID string. Check the installed RPC contract.",
    );
  return value;
}
export function workspaceAccess(value: unknown, bid: string) {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    value[0]?.business_id !== bid ||
    typeof value[0]?.can_write !== "boolean"
  )
    throw new Error(
      "billing_access returned no valid entitlement for this workspace. Check subscriptions and the installed RPC contract.",
    );
  return value[0];
}
