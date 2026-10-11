const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export function apiURL(path: string) {
  if (!path.startsWith("/api/")) throw new Error("Invalid API path");
  if (base) {
    const url = new URL(base);
    if (
      url.protocol !== "https:" &&
      !(
        import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      throw new Error("API URL must use HTTPS");
    return base + path;
  }
  return path;
}
