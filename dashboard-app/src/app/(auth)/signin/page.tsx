import { PROVIDER_ID } from "@/auth";
import { BrandMark } from "@/components/ui/Brand";
import { SignInButton } from "./SignInButton";

export const metadata = { title: "Sign in" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeCallbackUrl(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const error = first(params.error);
  const callbackUrl = safeCallbackUrl(first(params.callbackUrl));
  const denied = error === "AccessDenied";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-6 text-fg">
      <div className="w-full max-w-sm rounded-md border border-border bg-surface p-8">
        <BrandMark className="h-8 w-8 text-fg" />
        <h1 className="mt-4 text-heading-sm tracking-tight">
          <span className="font-semibold">Finance</span>
          <span className="text-fg-muted"> Dashboard</span>
        </h1>
        <p className="mt-2 text-body-sm text-fg-muted">
          Single-user access. Sign in with Authentik to continue.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-sm border border-border px-3 py-2 text-body-sm"
          >
            {denied ? (
              <>
                This account is not authorised.{" "}
                <span className="text-fg-muted">Sign in with the owner account.</span>
              </>
            ) : (
              <>
                Sign-in failed.{" "}
                <span className="text-fg-muted">Try again — the error was logged.</span>
              </>
            )}
          </p>
        ) : null}

        <SignInButton provider={PROVIDER_ID} callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
