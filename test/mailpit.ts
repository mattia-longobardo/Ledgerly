// test/mailpit.ts — reads the dev SMTP catcher (compose.dev.yml) through its REST API.
// Imports nothing, so Playwright's e2e code (Task 21) reuses it as well as Vitest.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:58025";

interface MailpitSearchResult {
  messages: { ID: string; To: { Address: string }[] }[];
}

export async function clearMailbox(): Promise<void> {
  const response = await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Mailpit clear failed: HTTP ${response.status}`);
}

export async function waitForMail(to: string, timeoutMs = 5000): Promise<{ Subject: string; Text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (!search.ok) throw new Error(`Mailpit search failed: HTTP ${search.status}`);
    const { messages } = (await search.json()) as MailpitSearchResult;
    const match = messages.find((message) =>
      message.To.some((recipient) => recipient.Address.toLowerCase() === to.toLowerCase()),
    );
    if (match) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${match.ID}`);
      if (!message.ok) throw new Error(`Mailpit message fetch failed: HTTP ${message.status}`);
      return (await message.json()) as { Subject: string; Text: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No email to ${to} within ${timeoutMs} ms`);
}
