// Edit API_BASE after deploying the Cloudflare Worker.
// Example: https://temp-mail-worker.your-account.workers.dev
window.TEMP_MAIL_CONFIG = {
  API_BASE: "https://temp-mail-worker.maittechcompany.workers.dev",
  DOMAINS: ["toolkitgen.xyz"],
  REFRESH_MS: 10000,
  INBOX_TTL_MINUTES: 60
};
