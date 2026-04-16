/**
 * POST /api/agents/ana/tools/transcribe-audio
 *
 * Recebe audio base64 do WhatsApp (via Evolution getBase64FromMediaMessage)
 * e retorna transcrição via OpenAI Whisper.
 *
 * Body: { base64: string, mimetype?: string }
 * Returns: { text: string }
 */
import { NextResponse } from "next/server";
import { requireWebhookAuth } from "@/lib/opensquad/webhook-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPENAI_KEY = process.env.OPENAI_API_KEY;

export const POST = async (req: Request) => {
  const authErr = requireWebhookAuth(req);
  if (authErr) return authErr;

  if (!OPENAI_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({})) as { base64?: string; mimetype?: string };
  if (!body.base64) {
    return NextResponse.json({ error: "base64 obrigatório" }, { status: 400 });
  }

  const buffer = Buffer.from(body.base64, "base64");
  const mime = body.mimetype || "audio/ogg";
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("mpeg") ? "mp3" : "ogg";

  // Build multipart form data manually
  const boundary = `----Boundary${Date.now()}`;
  const parts: Buffer[] = [];

  // File part
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`
  ));
  parts.push(buffer);

  // Model part
  parts.push(Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1`
  ));

  // Language part
  parts.push(Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\npt`
  ));

  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const formBody = Buffer.concat(parts);

  try {
    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: formBody,
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return NextResponse.json({ error: `whisper_${resp.status}`, details: errText.slice(0, 200) }, { status: 502 });
    }

    const data = await resp.json();
    return NextResponse.json({ text: data.text || "" });
  } catch (e) {
    return NextResponse.json(
      { error: "whisper_timeout", details: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
};
