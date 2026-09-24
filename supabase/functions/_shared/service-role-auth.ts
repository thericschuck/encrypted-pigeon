/**
 * Both pigeon edge functions are only ever meant to be called by the
 * database (pg_net triggers / cron, authenticated with the service-role key
 * from Vault). The gateway's verify_jwt only proves the caller holds *some*
 * valid project JWT — any signed-in user's access token passes that too —
 * so without this check any user could re-roll someone's flight or fire
 * pushes at other people.
 *
 * Decoding the payload without verifying the signature is fine here
 * precisely because verify_jwt is on: the gateway already rejected any
 * token not signed by this project before the function runs.
 */
export function isServiceRoleRequest(req: Request): boolean {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return false;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return true;

  const payloadPart = token.split(".")[1];
  if (!payloadPart) return false;
  try {
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
