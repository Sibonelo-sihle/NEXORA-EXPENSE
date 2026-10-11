import { test, expect, type Page } from "@playwright/test";
const user = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "owner@example.com",
  user_metadata: { full_name: "Owner", business_name: "Test business" },
  aud: "authenticated",
  role: "authenticated",
  email_confirmed_at: "2026-10-09T00:00:00Z",
};
const bid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const jwt = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
async function api(page: Page, expired = false) {
  let expenses: any[] = [
    {
      id: "expense-1",
      business_id: bid,
      merchant: "Office supplies",
      amount: 69.1,
      date: "2026-10-09",
      description: "Paper",
      category_id: "cat-1",
      receipt_url: null,
      status: "Approved",
    },
  ];
  await page.route("https://nexora-test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let response: any = null;
    if (url.pathname === "/auth/v1/token") {
      if (req.postDataJSON().password === "wrongpass") {
        await route.fulfill({
          status: 400,
          json: { msg: "Invalid login credentials" },
        });
        return;
      }
      response = {
        access_token: jwt,
        refresh_token: "refresh-test",
        expires_in: 3600,
        token_type: "bearer",
        user,
      };
    } else if (url.pathname === "/auth/v1/signup")
      response = { user, session: null };
    else if (
      url.pathname === "/auth/v1/resend" ||
      url.pathname === "/auth/v1/recover" ||
      url.pathname === "/auth/v1/logout"
    )
      response = {};
    else if (url.pathname === "/rest/v1/rpc/bootstrap_business") response = bid;
    else if (url.pathname === "/rest/v1/rpc/billing_access")
      response = [
        {
          business_id: bid,
          trial_days: expired ? 0 : 30,
          trial_ends_at: "2026-11-08T00:00:00Z",
          status: "trial",
          paid_until: null,
          cancel_at_period_end: false,
          can_write: !expired,
          has_subscription: false,
        },
      ];
    else if (url.pathname === "/rest/v1/businesses")
      response = { id: bid, name: "Test business" };
    else if (url.pathname === "/rest/v1/categories")
      response = [{ id: "cat-1", name: "Supplies", color: "#7c3aed" }];
    else if (url.pathname === "/rest/v1/payment_events") response = [];
    else if (url.pathname === "/rest/v1/profiles")
      response = { full_name: "Owner" };
    else if (url.pathname === "/rest/v1/expenses") {
      if (req.method() === "POST")
        expenses.push({ ...req.postDataJSON(), id: "expense-2" });
      if (req.method() === "PATCH")
        expenses = expenses.map((e) =>
          url.searchParams.get("id") === "eq." + e.id
            ? { ...e, ...req.postDataJSON() }
            : e,
        );
      if (req.method() === "DELETE")
        expenses = expenses.filter(
          (e) => url.searchParams.get("id") !== "eq." + e.id,
        );
      response = req.method() === "GET" ? expenses : null;
    } else if (url.pathname.startsWith("/storage/v1/object/list"))
      response = [];
    else if (url.pathname === "/auth/v1/user") response = user;
    else
      throw new Error(
        "Unexpected mock API " + req.method() + " " + url.pathname,
      );
    await route.fulfill({ status: 200, json: response });
  });
}
async function login(page: Page) {
  await page.goto("http://127.0.0.1:3101/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("correctpass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your spending, in focus." }),
  ).toBeVisible();
}
test("landing and auth fit mobile and desktop; official artwork loads", async ({
  page,
}) => {
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3100/");
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    for (const [name, price] of [
      ["Starter", "$5.00"],
      ["Pro", "$12.00"],
      ["Business", "$25.00"],
    ]) {
      const plan = page.getByRole("article", { name: `${name} plan` });
      await expect(plan).toContainText(price);
      await expect(plan).toContainText("/ month");
    }
    await expect(
      page.getByRole("article", { name: "Pro plan" }).getByText("Recommended"),
    ).toBeVisible();
    await page.locator('a[href="/signup?plan=business"]').click();
    await expect(page).toHaveURL(/\/signup\?plan=business$/);
    await expect(
      page.getByText(/Plan selected: Business at \$25\.00/),
    ).toBeVisible();
    await page.goto("http://127.0.0.1:3100");
    await expect(
      page.getByRole("heading", { name: "Big ambitions. Clearer expenses." }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(
      await page
        .locator("img")
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0);
    await page.goto("http://127.0.0.1:3100/signup");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "Start my free trial" }),
    ).toBeDisabled();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "docs/mobile-signup.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:3100");
  await page.screenshot({ path: "docs/desktop-landing.png", fullPage: true });
});
test("fake prototype localStorage session cannot unlock app", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3100");
  await page.evaluate(() =>
    localStorage.setItem(
      "nexora_session",
      JSON.stringify({ user: { id: "user-1" } }),
    ),
  );
  await page.goto("http://127.0.0.1:3100/expenses");
  await expect(page).toHaveURL(/\/login$/);
});
test("authentication surfaces errors, persists session, and signs out", async ({
  page,
}) => {
  await api(page);
  await page.goto("http://127.0.0.1:3101/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("wrongpass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid login");
  await page.getByLabel("Password", { exact: true }).fill("correctpass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your spending, in focus." }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator(".recharts-bar-rectangle")
        .last()
        .evaluate((el) => el.getBoundingClientRect().height),
    )
    .toBeGreaterThan(180);
  await page.screenshot({ path: "docs/desktop-dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/login/);
});
test("signup requires email confirmation and password recovery submits to Auth", async ({
  page,
}) => {
  await api(page);
  await page.goto("http://127.0.0.1:3101/signup");
  await page.getByLabel("Full name").fill("Owner");
  await page.getByLabel("Business name").fill("Business");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("correctpass");
  await page.getByRole("button", { name: "Start my free trial" }).click();
  await expect(page.getByRole("status")).toContainText("verify your account");
  await page.goto("http://127.0.0.1:3101/forgot-password");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByRole("button", { name: "Send recovery link" }).click();
  await expect(page.getByRole("status")).toContainText("recovery link");
});
test("expense CRUD, search, calculations and export connect to data APIs", async ({
  page,
}) => {
  await api(page);
  await login(page);
  await page.goto("http://127.0.0.1:3101/expenses");
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.getByLabel("Merchant", { exact: true }).fill("Taxi");
  await page.getByLabel("Amount (ZAR)").fill("10.20");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(
    page.getByRole("cell", { name: "Taxi", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search merchants" }).fill("Taxi");
  await expect(page.getByRole("cell", { name: "Office supplies" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Edit", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByLabel("Merchant", { exact: true }).fill("Uber");
  await page.getByRole("button", { name: "Save expense" }).click();
  await page.getByRole("textbox", { name: "Search merchants" }).fill("");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("nexora-expenses.csv");
  await page
    .getByRole("button", { name: "Delete", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Delete expense", exact: true })
    .click();
  await expect(page.getByRole("cell", { name: "Office supplies" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("cell", { name: "Uber", exact: true }),
  ).toBeVisible();
});
test("expired mobile workspace retains export and billing, blocks editing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await api(page, true);
  await login(page);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Expenses", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add expense" }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("button", { name: "Edit", exact: true })
      .filter({ visible: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "docs/mobile-expenses.png", fullPage: true });
  await page.goto("http://127.0.0.1:3101/settings");
  await expect(
    page.getByRole("heading", { name: "NEXORA Expense subscription" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export all expenses" }),
  ).toBeEnabled();
  for (const [name, price] of [
    ["Starter", "$5.00"],
    ["Pro", "$12.00"],
    ["Business", "$25.00"],
  ]) {
    const plan = page.getByRole("article", { name: `${name} plan` });
    await expect(plan).toContainText(price);
    await expect(plan.getByRole("button")).toBeDisabled();
  }
});
test("recovery session can update password", async ({ page }) => {
  await api(page);
  await login(page);
  await page.goto("http://127.0.0.1:3101/reset-password");
  await page.getByLabel("Password", { exact: true }).fill("newsecurepassword");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/auth/v1/user") && r.method() === "PUT",
  );
  await page.getByRole("button", { name: "Update password" }).click();
  expect((await request).postDataJSON().password).toBe("newsecurepassword");
  await expect(page.getByRole("status")).toContainText("Password updated");
});
test("receipts validate type, upload privately and can download", async ({
  page,
}) => {
  await api(page);
  let stored: any[] = [];
  await page.route(
    "https://nexora-test.supabase.co/storage/v1/**",
    async (route) => {
      const r = route.request();
      if (r.url().includes("/object/list/")) {
        await route.fulfill({ json: stored });
        return;
      }
      if (r.method() === "POST") {
        const name = decodeURIComponent(
          new URL(r.url()).pathname.split("/").at(-1)!,
        );
        stored.push({ id: "file-1", name, metadata: { size: 100 } });
        await route.fulfill({ json: { Key: "receipts/" + bid + "/" + name } });
        return;
      }
      if (r.method() === "GET") {
        await route.fulfill({
          contentType: "application/pdf",
          body: "%PDF-1.4 test receipt",
        });
        return;
      }
      throw new Error("Unexpected receipt request");
    },
  );
  await login(page);
  await page.goto("http://127.0.0.1:3101/receipts");
  await page.getByLabel("Upload receipt").setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("bad"),
  });
  await expect(page.getByRole("alert")).toContainText("JPG, PNG or PDF");
  await page.getByLabel("Upload receipt").setInputFiles({
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  });
  await expect(page.getByText("invoice.pdf", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("invoice.pdf");
  await page.goto("http://127.0.0.1:3101/expenses");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(
    page
      .getByLabel("Attached receipt")
      .getByRole("option", { name: "invoice.pdf" }),
  ).toHaveCount(1);
});
test("reports filter real rows by date and keep export available", async ({
  page,
}) => {
  await api(page);
  await login(page);
  await page.goto("http://127.0.0.1:3101/reports");
  await expect(page.getByText("Selected period · 1 expenses")).toBeVisible();
  await page.getByLabel("From", { exact: true }).fill("2026-11-01");
  await expect(page.getByText("Selected period · 0 expenses")).toBeVisible();
  await expect(page.getByText("No expenses in this period.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
});

test("signup verification can be resent without opening an unconfirmed workspace", async ({
  page,
}) => {
  await api(page);
  await page.goto("http://127.0.0.1:3101/signup");
  await page.getByLabel("Full name").fill("Owner");
  await page.getByLabel("Business name").fill("Business");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("correctpass");
  await page.getByRole("button", { name: "Start my free trial" }).click();
  await expect(
    page.getByRole("link", { name: "Continue", exact: true }),
  ).toHaveCount(0);
  const request = page.waitForRequest((r) =>
    r.url().includes("/auth/v1/resend"),
  );
  await page.getByRole("button", { name: "Resend verification email" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    type: "signup",
    email: user.email,
  });
  await expect(page.getByRole("status")).toContainText(
    "Verification email requested",
  );
});

test("missing billing RPC identifies dashboard failure after UUID onboarding succeeds", async ({
  page,
}) => {
  await api(page);
  await page.route(
    "https://nexora-test.supabase.co/rest/v1/rpc/billing_access",
    (route) =>
      route.fulfill({
        status: 404,
        json: {
          code: "PGRST202",
          message:
            "Could not find the function public.billing_access without parameters in the schema cache",
        },
      }),
  );
  const operations: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/rest/v1/"))
      operations.push(new URL(request.url()).pathname);
  });
  await page.goto("http://127.0.0.1:3101/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("correctpass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "billing_access failed (PGRST202)",
  );
  expect(operations).toContain("/rest/v1/rpc/bootstrap_business");
  expect(operations).toContain("/rest/v1/rpc/billing_access");
  expect(operations).not.toContain("/rest/v1/expenses");
  await expect(
    page.getByRole("heading", { name: "Your spending, in focus." }),
  ).toHaveCount(0);
});
