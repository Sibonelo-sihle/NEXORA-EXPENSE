import { db, check } from "./supabase";
export const RECEIPT_BUCKET = "nexora-receipts";

export async function listReceipts(businessId: string) {
  async function listDirectory(path: string): Promise<any[]> {
    const files: any[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data } = check(
        await db()
          .storage.from(RECEIPT_BUCKET)
          .list(path, {
            limit: 100,
            offset,
            sortBy: { column: "created_at", order: "desc" },
          }),
      );
      for (const item of data ?? []) {
        if (!item.id && item.metadata == null) {
          files.push(...(await listDirectory(`${path}/${item.name}`)));
        } else {
          files.push({ ...item, path: `${path}/${item.name}` });
        }
      }
      if ((data?.length ?? 0) < 100) break;
    }
    return files;
  }
  return listDirectory(businessId);
}
export async function uploadReceipt(businessId: string, file: File) {
  if (
    file.size > 5242880 ||
    !["image/jpeg", "image/png", "application/pdf"].includes(file.type)
  )
    throw new Error("Choose a JPG, PNG or PDF no larger than 5MB.");
  const ext =
    file.type === "application/pdf"
      ? "pdf"
      : file.type === "image/png"
        ? "png"
        : "jpg";
  const name =
    file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80) || "receipt";
  const path = `${businessId}/${crypto.randomUUID()}_${name}.${ext}`;
  check(
    await db()
      .storage.from(RECEIPT_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false }),
  );
  return path;
}
export const receiptName = (name: string) =>
  name.replace(/^[a-f0-9-]{36}_/i, "");
