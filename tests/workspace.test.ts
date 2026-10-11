import { test } from "node:test";
import assert from "node:assert/strict";
import {
  workspaceId,
  workspaceAccess,
  workspaceResult,
} from "../src/lib/workspace";
const bid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
test("onboarding expects a UUID scalar, not a JSON workspace object", () => {
  assert.equal(workspaceId(bid), bid);
  for (const value of [{ id: bid }, [bid], null, ""])
    assert.throws(() => workspaceId(value));
});
test("missing billing RPC identifies its exact failing operation", () => {
  assert.throws(
    () =>
      workspaceResult(
        {
          error: {
            code: "PGRST202",
            message: "Could not find function public.billing_access",
          },
        },
        "billing_access",
      ),
    /billing_access failed \(PGRST202\)/,
  );
});
test("billing must return exactly one entitlement for the current workspace", () => {
  assert.equal(
    workspaceAccess([{ business_id: bid, can_write: false }], bid).can_write,
    false,
  );
  for (const value of [
    [],
    null,
    {},
    [{ business_id: "other", can_write: true }],
    [{ business_id: bid }],
  ])
    assert.throws(() => workspaceAccess(value, bid));
});
