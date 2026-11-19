"use client";

// The shell of `packages/ui` with what only the web knows: how a session ends (the auth client).
import type { ComponentProps } from "react";
import { ShellProvider } from "@ledgerly/ui/shell/shell-context";
import { authClient } from "@/platform/auth/client";

async function signOut(): Promise<void> {
  await authClient.signOut();
}

export function AppShellProvider(props: Omit<ComponentProps<typeof ShellProvider>, "signOut">) {
  return <ShellProvider {...props} signOut={signOut} />;
}
