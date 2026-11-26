import PostalMime from "postal-mime";

// Cloudflare Worker for Temp Mail.
// 1) email() — called by Email Routing catch-all for toolkitgen.xyz / toolkithub.site.
//    Parses the message and stores it in KV under the recipient address.
// 2) fetch() — tiny JSON API used by the frontend:
//    GET    /api/inbox?address=a@b.xyz   -> list messages for that inbox
//    DELETE /api/inbox?address=a@b.xyz   -> delete that inbox

const TTL = 3600; // seconds
const ALLOWED = ["toolkitgen.xyz", "toolkithub.site"];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function validAddress(address) {
  if (!address || typeof address !== "string") return false;
  const parts = address.toLowerCase().split("@");
  return parts.length === 2 && parts[0].length > 0 && ALLOWED.includes(parts[1]);
}

export default {
  // Called by Cloudflare Email Routing when mail arrives for the Worker.
  async email(message, env) {
    try {
      const to = (message.to || "").toLowerCase();
      if (!validAddress(to)) return;

      const raw = await new Response(message.raw).arrayBuffer();
      const parsed = await PostalMime.parse(raw);

      const msg = {
        id: crypto.randomUUID(),
        from: message.from,
        to,
        subject: message.headers.get("subject") || parsed.subject || "",
        date: message.headers.get("date") || new Date().toISOString(),
        text: parsed.text || "",
        html: parsed.html || "",
      };

      const key = `inbox:${to}`;
      const existing = await env.TEMP_MAIL.get(key, "json");
      const list = Array.isArray(existing) ? existing : [];
      list.unshift(msg);
      // Keep at most 50 messages per inbox.
      await env.TEMP_MAIL.put(key, JSON.stringify(list.slice(0, 50)), {
        expirationTtl: TTL,
      });
    } catch (err) {
      console.error("temp-mail email handler failed", err);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/api/inbox") {
      const address = (url.searchParams.get("address") || "").toLowerCase();
      if (!validAddress(address)) {
        return json({ error: "Invalid address. Use @toolkitgen.xyz or @toolkithub.site." }, 400);
      }

      if (request.method === "DELETE") {
        await env.TEMP_MAIL.delete(`inbox:${address}`);
        return json({ ok: true });
      }

      if (request.method === "GET") {
        const messages = (await env.TEMP_MAIL.get(`inbox:${address}`, "json")) || [];
        return json({ address, messages });
      }
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "temp-mail-worker", domains: ALLOWED });
    }

    return json({ error: "Not found" }, 404);
  },
};
