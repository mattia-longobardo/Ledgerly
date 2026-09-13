// test/mailpit.ts — reads the dev SMTP catcher (compose.dev.yml) through its REST API.
// Imports nothing, so Playwright's e2e code (Task 21) reuses it as well as Vitest.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:58025";

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
}

export async function waitForMail(to: string, timeoutMs = 5000): Promise<{ Subject: string; Text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
      return (await message.json()) as { Subject: string; Text: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No email to ${to} within ${timeoutMs} ms`);
}
