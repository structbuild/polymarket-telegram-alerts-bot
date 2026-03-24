async function importKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const encoderA = new TextEncoder().encode(a);
  const encoderB = new TextEncoder().encode(b);

  let result = 0;
  for (let i = 0; i < encoderA.length; i++) {
    result |= encoderA[i] ^ encoderB[i];
  }
  return result === 0;
}

export async function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const key = await importKey(secret);
  const encoder = new TextEncoder();
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = bufferToHex(signed);
  const rawSignature = signature.startsWith("sha256=")
    ? signature.slice(7)
    : signature;
  return timingSafeEqual(computed, rawSignature);
}
