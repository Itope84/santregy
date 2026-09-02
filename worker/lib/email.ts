import type { Env } from "../env";
import type { PickEntry } from "../types";

async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string; text: string },
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend request failed: ${res.status} ${await res.text()}`);
  }
}

export async function sendMagicLinkEmail(env: Env, to: string, url: string): Promise<void> {
  await sendEmail(env, {
    to,
    subject: "Your sign-in link",
    text: `Sign in: ${url}\n\nThis link expires in 15 minutes and can only be used once.`,
    html: `<p>Click below to sign in. This link expires in 15 minutes and can only be used once.</p>
           <p><a href="${url}">${url}</a></p>`,
  });
}

function formatPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function pickRow(p: PickEntry): string {
  return `${p.ticker} — ${p.name} (${p.sector}): ${formatPct(p.trailingReturn)}`;
}

export async function sendAnnualPicksEmail(
  env: Env,
  to: string,
  year: number,
  picks: PickEntry[],
  alternates: PickEntry[],
): Promise<void> {
  const text = [
    `Your ${year} momentum picks`,
    "",
    "Picks:",
    ...picks.map((p) => `  ${pickRow(p)}`),
    "",
    "Alternates:",
    ...alternates.map((p) => `  ${pickRow(p)}`),
  ].join("\n");

  const rowsHtml = (entries: PickEntry[]) =>
    entries
      .map(
        (p) =>
          `<tr><td>${p.ticker}</td><td>${p.name}</td><td>${p.sector}</td><td>${formatPct(p.trailingReturn)}</td></tr>`,
      )
      .join("");

  const html = `
    <h2>Your ${year} momentum picks</h2>
    <h3>Picks</h3>
    <table cellpadding="4"><tr><th>Ticker</th><th>Company</th><th>Sector</th><th>Trailing return</th></tr>
      ${rowsHtml(picks)}
    </table>
    <h3>Alternates</h3>
    <table cellpadding="4"><tr><th>Ticker</th><th>Company</th><th>Sector</th><th>Trailing return</th></tr>
      ${rowsHtml(alternates)}
    </table>
    <p>This is a decision prompt, not advice — go review and record what you actually buy.</p>
  `;

  await sendEmail(env, { to, subject: `Your ${year} momentum picks`, text, html });
}
