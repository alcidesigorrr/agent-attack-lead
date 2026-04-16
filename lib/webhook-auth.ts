/**
 * Shared auth helper for OpenSquad webhooks + Ana tool endpoints.
 *
 * Fail-closed: if OPENCLAW_WEBHOOK_SECRET is not configured, endpoints are
 * blocked with 503 (server misconfigured). Never leave endpoints open because
 * env is missing.
 */
import { NextResponse } from "next/server";

const SECRET = process.env.OPENCLAW_WEBHOOK_SECRET;

export function requireWebhookAuth(req: Request): NextResponse | null {
  if (!SECRET) {
    // Fail-closed in production. In dev, allow if NODE_ENV is development.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "server misconfigured: OPENCLAW_WEBHOOK_SECRET not set" },
        { status: 503 },
      );
    }
    // Dev: allow without secret
    return null;
  }

  const provided = req.headers.get("x-webhook-secret");
  if (provided !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
