"use client";

import messages from "../../messages/en.json";
import { ErrorState } from "@/ui/states";
import "./globals.css";

/**
 * The root layout itself failed, so neither the user's language nor the translations provider is
 * available: the generic error copy comes straight from the English catalogue.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="grid min-h-dvh place-items-center bg-bg p-4">
          <div className="w-[480px] max-w-full">
            <ErrorState
              title={messages.errors.generic.title}
              description={messages.errors.generic.description}
              onRetry={reset}
              retryLabel={messages.common.retry}
            />
          </div>
        </main>
      </body>
    </html>
  );
}
