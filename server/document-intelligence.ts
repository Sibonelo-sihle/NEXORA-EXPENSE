const API_VERSION = "2024-11-30";
const POLL_INTERVAL_MS = 750;
const MAX_POLLS = 40;

function providerConfiguration() {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key || endpoint !== endpoint.trim() || key !== key.trim())
    throw new Error("provider_unavailable");

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("provider_unavailable");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    key.startsWith("your_")
  )
    throw new Error("provider_unavailable");

  return { endpoint: parsed, key };
}

export function documentIntelligenceConfigured() {
  try {
    providerConfiguration();
    return true;
  } catch {
    return false;
  }
}

async function responseJson(response: Response) {
  if (!response.ok) throw new Error("provider_failed");
  try {
    return await response.json();
  } catch {
    throw new Error("provider_failed");
  }
}

export async function analyzeReceiptDocument(content: Uint8Array) {
  const { endpoint, key } = providerConfiguration();
  const analyzeUrl = new URL(
    `/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=${API_VERSION}`,
    endpoint,
  );
  const response = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": key,
    },
    body: JSON.stringify({
      base64Source: Buffer.from(content).toString("base64"),
    }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => {
    throw new Error("provider_unavailable");
  });

  if (response.status === 200) return responseJson(response);
  if (response.status !== 202) throw new Error("provider_failed");

  const operationLocation = response.headers.get("operation-location");
  if (!operationLocation) throw new Error("provider_failed");

  let operationUrl: URL;
  try {
    operationUrl = new URL(operationLocation);
  } catch {
    throw new Error("provider_failed");
  }
  if (
    operationUrl.protocol !== "https:" ||
    operationUrl.origin !== endpoint.origin ||
    !operationUrl.pathname.includes("/documentintelligence/documentModels/")
  )
    throw new Error("provider_failed");

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const poll = await fetch(operationUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key },
      signal: AbortSignal.timeout(10000),
    }).catch(() => {
      throw new Error("provider_unavailable");
    });
    const result = await responseJson(poll);
    if (result.status === "succeeded") return result;
    if (result.status === "failed") throw new Error("provider_failed");
  }

  throw new Error("provider_timeout");
}
