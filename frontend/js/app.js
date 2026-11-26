const cfg = window.TEMP_MAIL_CONFIG;
const $ = (id) => document.getElementById(id);

const WORDS = ["blue", "swift", "quiet", "brave", "lucky", "happy", "clever", "rapid", "calm", "wild", "sunny", "frosty"];
const ANIMALS = ["tiger", "fox", "panda", "eagle", "otter", "wolf", "falcon", "koala", "raven", "badger"];

let address = "";
let timer = null;
let expiresAt = null;

function randomLocal() {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${w}-${a}-${n}`;
}

function currentDomain() { return $("domainSelect").value; }

function setAddress(local) {
  address = `${local}@${currentDomain()}`;
  $("address").value = address;
  localStorage.setItem("tempMailAddress", address);
  expiresAt = Date.now() + cfg.INBOX_TTL_MINUTES * 60 * 1000;
  localStorage.setItem("tempMailExpiresAt", String(expiresAt));
  fetchInbox();
}

function newAddress() {
  setAddress(randomLocal());
  $("status").textContent = "New inbox created.";
}

async function fetchInbox() {
  if (!cfg.API_BASE) {
    $("status").textContent = "API not configured yet — inbox generation works, mail receive needs the Worker URL in js/config.js.";
    return;
  }
  try {
    const res = await fetch(`${cfg.API_BASE}/api/inbox?address=${encodeURIComponent(address)}`);
    if (!res.ok) throw new Error("API " + res.status);
    const data = await res.json();
    renderMessages(data.messages || []);
    $("status").textContent = data.messages && data.messages.length
      ? `${data.messages.length} message(s)` : "Waiting for mail…";
  } catch (e) {
    $("status").textContent = "Could not reach the mail API. Retrying…";
  }
}

function renderMessages(messages) {
  $("msgCount").textContent = String(messages.length);
  $("emptyState").style.display = messages.length ? "none" : "block";
  const list = $("msgList");
  list.innerHTML = "";
  messages.forEach((m) => {
    const li = document.createElement("li");
    const subj = document.createElement("div");
    subj.className = "subj";
    subj.textContent = m.subject || "(no subject)";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${m.from || "unknown"} · ${m.date ? new Date(m.date).toLocaleString() : ""}`;
    li.append(subj, meta);
    li.onclick = () => openMessage(m);
    list.appendChild(li);
  });
}

function openMessage(m) {
  $("viewer").classList.remove("hidden");
  $("viewSubject").textContent = m.subject || "(no subject)";
  $("viewFrom").textContent = m.from || "unknown";
  $("viewDate").textContent = m.date ? new Date(m.date).toLocaleString() : "";
  const body = $("viewBody");
  body.innerHTML = "";
  if (m.html) {
    // Render HTML in a sandboxed iframe to avoid scripts in mail running on this page.
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "");
    frame.style.cssText = "width:100%;border:0;background:#fff;min-height:300px";
    body.appendChild(frame);
    frame.srcdoc = m.html;
  } else {
    body.textContent = m.text || "(empty message)";
  }
  window.scrollTo({ top: $("viewer").offsetTop, behavior: "smooth" });
}

function tickCountdown() {
  if (!expiresAt) return;
  const left = Math.max(0, expiresAt - Date.now());
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  $("countdown").textContent = `Expires in ${mins}m ${String(secs).padStart(2, "0")}s.`;
  if (left <= 0) newAddress();
}

$("copyBtn").onclick = async () => {
  try { await navigator.clipboard.writeText(address); $("status").textContent = "Copied!"; }
  catch { $("address").select(); document.execCommand("copy"); }
};
$("refreshBtn").onclick = fetchInbox;
$("newBtn").onclick = newAddress;
$("domainSelect").onchange = () => { if (address) setAddress(address.split("@")[0]); };
$("deleteBtn").onclick = async () => {
  if (cfg.API_BASE) {
    try { await fetch(`${cfg.API_BASE}/api/inbox?address=${encodeURIComponent(address)}`, { method: "DELETE" }); } catch {}
  }
  localStorage.removeItem("tempMailAddress");
  localStorage.removeItem("tempMailExpiresAt");
  newAddress();
};
$("closeViewer").onclick = () => $("viewer").classList.add("hidden");

// Restore saved inbox, or create a fresh one.
const saved = localStorage.getItem("tempMailAddress");
const savedExp = Number(localStorage.getItem("tempMailExpiresAt") || 0);
if (saved && savedExp > Date.now() && cfg.DOMAINS.some((d) => saved.endsWith("@" + d))) {
  const [local, domain] = saved.split("@");
  $("domainSelect").value = domain;
  address = saved;
  $("address").value = address;
  expiresAt = savedExp;
  fetchInbox();
} else {
  newAddress();
}
timer = setInterval(fetchInbox, cfg.REFRESH_MS);
setInterval(tickCountdown, 1000);
