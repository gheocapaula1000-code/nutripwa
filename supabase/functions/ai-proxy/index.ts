// Proxy FACOLTATIVO per NutriPWA – Supabase Edge Function (Deno).
// Serve a tenere la chiave Gemini sul server invece che nel browser.
// NON è necessario: l'app funziona anche senza (chiave personale nel browser, BYOK).
//
// Deploy (vedi README):
//   supabase functions deploy ai-proxy --no-verify-jwt
//   supabase secrets set GEMINI_API_KEY=la_tua_chiave ALLOWED_ORIGIN=https://tuo-sito.example
//
// Contratto: POST con il corpo di Gemini generateContent + campo "model" (facoltativo).
// Risposta: la risposta di Gemini, invariata.

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*"; // IN PRODUZIONE: imposta il tuo dominio!
const MODELS = (Deno.env.get("ALLOWED_MODELS") ?? "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite").split(",");
const MAX_BYTES = 4_000_000; // ~4 MB: le foto arrivano già compresse dal client

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: { message: "Metodo non consentito" } }, 405);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: { message: "GEMINI_API_KEY non configurata sul server" } }, 500);

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json({ error: { message: "Immagine troppo grande" } }, 413);

  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json({ error: { message: "JSON non valido" } }, 400); }

  const model = String(body.model ?? MODELS[0]);
  if (!MODELS.includes(model)) return json({ error: { message: "Modello non consentito" } }, 400);
  delete body.model;

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
