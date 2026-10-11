import { test, expect } from "@playwright/test";
test("local demo needs no account, persists reload, has no service calls and signs out", async ({
  page,
}) => {
  const serviceCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") || r.url().includes("supabase.co"))
      serviceCalls.push(r.url());
  });
  await page.goto("http://127.0.0.1:3100/login");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Enter DEMO MODE" }).click();
  await expect(page).toHaveURL(/dashboard$/);
  await expect(
    page.getByRole("status").filter({ hasText: "DEMO MODE" }),
  ).toBeVisible();
  await expect(
    page.getByText("NEXORA Demo Workspace", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your spending, in focus." }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:3100/expenses");
  await expect(
    page.getByRole("button", { name: "Add expense" }),
  ).toBeDisabled();
  await page.goto("http://127.0.0.1:3100/receipts");
  await expect(page.getByLabel("Upload receipt")).toBeDisabled();
  await page.goto("http://127.0.0.1:3100/settings");
  await expect(
    page.getByRole("button", { name: "Save profile" }),
  ).toBeDisabled();
  for (const plan of ["Starter", "Pro", "Business"]) {
    await expect(
      page.getByRole("article", { name: `${plan} plan` }).getByRole("button"),
    ).toBeDisabled();
  }
  expect(serviceCalls).toEqual([]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/login$/);
  await page.goto("http://127.0.0.1:3100/dashboard");
  await expect(page).toHaveURL(/login$/);
});
test("production rejects forged demo state and exposes no demo login", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3104/login");
  await page.evaluate(() =>
    sessionStorage.setItem("nexora_local_demo_v1", "active"),
  );
  await page.goto("http://127.0.0.1:3104/dashboard");
  await expect(page).toHaveURL(/login$/);
  await expect(
    page.getByRole("button", { name: "Enter DEMO MODE" }),
  ).toHaveCount(0);
});
test("configured real Auth never offers demo fallback", async ({ page }) => {
  await page.goto("http://127.0.0.1:3101/login");
  await expect(
    page.getByRole("button", { name: "Enter DEMO MODE" }),
  ).toHaveCount(0);
});
test("expired email link errors are visible", async ({ page }) => {
  await page.goto(
    "http://127.0.0.1:3100/reset-password#error=access_denied&error_description=Email+link+has+expired",
  );
  await expect(page.getByRole("alert")).toContainText("Email link has expired");
});
