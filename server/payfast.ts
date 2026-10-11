import { createHash, timingSafeEqual } from "node:crypto";
export type Fields = Record<string, string>;
export const encode = (v: string) =>
  encodeURIComponent(v)
    .replace(
      /[!'()*~]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    )
    .replace(/%20/g, "+");
export const parameterString = (fields: Fields) =>
  Object.entries(fields)
    .filter(([k, v]) => k !== "signature" && v !== "")
    .map(([k, v]) => `${k}=${encode(v.trim())}`)
    .join("&");
export const signature = (fields: Fields, passphrase: string) =>
  createHash("md5")
    .update(parameterString(fields) + "&passphrase=" + encode(passphrase))
    .digest("hex");
export const notificationParameterString = (fields: Fields) =>
  Object.entries(fields)
    .filter(([k]) => k !== "signature")
    .map(([k, v]) => `${k}=${encode(v)}`)
    .join("&");
export const notificationSignature = (fields: Fields, passphrase: string) =>
  createHash("md5")
    .update(
      notificationParameterString(fields) + "&passphrase=" + encode(passphrase),
    )
    .digest("hex");
export function validSignature(fields: Fields, passphrase: string) {
  const provided = fields.signature ?? "";
  if (!/^[a-f0-9]{32}$/.test(provided)) return false;
  return timingSafeEqual(
    Buffer.from(provided),
    Buffer.from(notificationSignature(fields, passphrase)),
  );
}
export function apiSignature(fields: Fields, passphrase: string) {
  const sorted = Object.fromEntries(
    Object.entries({ ...fields, passphrase }).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  return createHash("md5").update(parameterString(sorted)).digest("hex");
}
export function parseNotification(raw: string) {
  const params = new URLSearchParams(raw);
  const fields: Fields = {};
  for (const [key, value] of params) {
    if (key in fields) throw new Error("Duplicate notification field");
    fields[key] = value;
  }
  return fields;
}
export function verifyNotification(
  fields: Fields,
  merchant: string,
  amount: number,
  passphrase: string,
) {
  if (!validSignature(fields, passphrase)) throw new Error("Invalid signature");
  if (fields.merchant_id !== merchant) throw new Error("Wrong merchant");
  if (!fields.m_payment_id) throw new Error("Missing order identifier");
  if (
    !["COMPLETE", "FAILED", "PENDING", "CANCELLED"].includes(
      fields.payment_status,
    )
  )
    throw new Error("Unknown payment status");
  if (
    fields.payment_status === "COMPLETE" ||
    fields.payment_status === "FAILED"
  ) {
    if (
      !/^\d+(\.\d{1,2})?$/.test(fields.amount_gross ?? "") ||
      Math.round(Number(fields.amount_gross) * 100) !== Math.round(amount * 100)
    )
      throw new Error("Wrong amount");
    if (!fields.pf_payment_id) throw new Error("Missing payment identifier");
  }
}
export function verifyPayment(
  fields: Fields,
  merchant: string,
  amount: number,
  passphrase: string,
) {
  verifyNotification(fields, merchant, amount, passphrase);
  if (fields.payment_status !== "COMPLETE")
    throw new Error("Payment is not complete");
  if (!/^[a-f0-9-]{36}$/i.test(fields.token ?? ""))
    throw new Error("Missing subscription token");
}
export function nextBillingDate(now = new Date()) {
  const next = new Date(now);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next.toISOString().slice(0, 10);
}
export async function validProviderIp(
  ip: string,
  resolve: (host: string) => Promise<{ address: string }[]>,
) {
  const hosts = [
    "www.payfast.co.za",
    "w1w.payfast.co.za",
    "w2w.payfast.co.za",
    "sandbox.payfast.co.za",
  ];
  const resolved = await Promise.allSettled(hosts.map(resolve));
  const normalized = ip.replace(/^::ffff:/, "");
  return resolved.some(
    (r) =>
      r.status === "fulfilled" && r.value.some((a) => a.address === normalized),
  );
}
