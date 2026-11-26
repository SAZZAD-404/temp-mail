// Cloudflare Worker for Temp Mail — NO npm dependencies.
// The Cloudflare dashboard editor cannot install packages, so this file
// parses MIME mail itself instead of importing postal-mime.
//
// 1) email() — called by Email Routing catch-all for toolkitgen.xyz.
//    Parses the message and stores it in KV under the recipient address.
// 2) fetch() — tiny JSON API used by the frontend:
//    GET    /api/inbox?address=a@toolkitgen.xyz -> list messages for that inbox
//    DELETE /api/inbox?address=a@toolkitgen.xyz -> delete that inbox

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

// --- Minimal MIME decoding -------------------------------------------------

function decodeBytes(str) {
  // atob gives a binary string; turn it into UTF-8 text.
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  try {
    return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);
  } catch {
    return str;
  }
}

function decodeQuotedPrintable(str) {
  // Soft line breaks first, then =XX hex escapes.
  const noSoft = str.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < noSoft.length; i++) {
    if (noSoft[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(noSoft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(noSoft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(noSoft.charCodeAt(i) & 0xff);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(new Uint8Array(bytes));
  } catch {
    return noSoft;
  }
}

function decodeBody(body, encoding) {
  const enc = (encoding || "").toLowerCase().trim();
  if (enc === "base64") {
    try {
      return decodeBytes(atob(body.replace(/\s/g, "")));
    } catch {
      return body;
    }
  }
  if (enc === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

function parseHeaders(headerText) {
  const headers = {};
  const lines = headerText.split(/\r?\n/);
  let current = "";
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] += " " + line.trim();
    } else {
      const idx = line.indexOf(":");
      if (idx > 0) {
        current = line.slice(0, idx).trim().toLowerCase();
        headers[current] = line.slice(idx + 1).trim();
      }
    }
  }
  return headers;
}

function splitHeaderBody(text) {
  const idx = text.search(/\r?\n\r?\n/);
  if (idx === -1) return [{}, text];
  const sep = text.slice(idx).startsWith("\r\n\r\n") ? 4 : 2;
  return [parseHeaders(text.slice(0, idx)), text.slice(idx + sep)];
}

function parsePart(text, out) {
  const [headers, body] = splitHeaderBody(text);
  const contentType = (headers["content-type"] || "text/plain").toLowerCase();
  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = body.split("--" + boundary);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === "--") continue;
      parsePart(trimmed.replace(/--\s*$/, ""), out);
    }
    return;
  }
  const decoded = decodeBody(body, headers["content-transfer-encoding"]);
  if (contentType.includes("text/html")) {
    if (!out.html) out.html = decoded;
  } else if (contentType.includes("text/plain")) {
    if (!out.text) out.text = decoded;
  } else if (!out.text) {
    out.text = decoded;
  }
}

function parseMessage(rawText) {
  const out = { text: "", html: "", subject: "" };
  parsePart(rawText, out);
  const [headers] = splitHeaderBody(rawText);
  out.subject = headers["subject"] || "";
  return out;
}

// --- Worker -----------------------------------------------------------------

export default {
  // Called by Cloudflare Email Routing when mail arrives for the Worker.
  async email(message, env) {
    try {
      const to = (message.to || "").toLowerCase();
      if (!validAddress(to)) return;

      const rawText = await new Response(message.raw).text();
      // Parse, but NEVER let a parse failure drop the mail:
      // fall back to the raw body so the inbox always shows something.
      let parsed = { text: "", html: "", subject: "" };
      try {
        parsed = parseMessage(rawText);
      } catch (parseErr) {
        console.error("temp-mail parse failed, storing raw", parseErr);
        parsed = { text: rawText.slice(0, 20000), html: "", subject: "" };
      }
      if (!parsed.text && !parsed.html) {
        parsed.text = rawText.slice(0, 20000);
      }

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
      // Last-resort store: try again with minimal data so mail is not lost.
      try {
        const to = (message.to || "").toLowerCase();
        if (validAddress(to)) {
          const key = `inbox:${to}`;
          const existing = await env.TEMP_MAIL.get(key, "json");
          const list = Array.isArray(existing) ? existing : [];
          list.unshift({
            id: crypto.randomUUID(),
            from: message.from,
            to,
            subject: message.headers.get("subject") || "(no subject)",
            date: new Date().toISOString(),
            text: "(This message could not be parsed, but it was received.)",
            html: "",
          });
          await env.TEMP_MAIL.put(key, JSON.stringify(list.slice(0, 50)), {
            expirationTtl: TTL,
          });
        }
      } catch {}
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
