"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TwoFactorSetup } from "@/modules/users/ui/two-factor-setup";
import { authClient } from "@/platform/auth/client";
import { Button } from "@/ui/button";

/** The forced setup: on success the app opens; "Sign out" is the way out for the wrong account. */
export function SetupFlow({ account }: { account: string }) {
  const t = useTranslations("auth.twoFactor");
  const router = useRouter();
  return (
    <div className="flex flex-col gap-3">
      <TwoFactorSetup
        account={account}
        onDone={() => {
          router.push("/");
          router.refresh();
        }}
      />
      <Button
        variant="ghost"
        className="w-full"
        onClick={async () => {
          await authClient.signOut();
          router.push("/sign-in");
          router.refresh();
        }}
      >
        {t("signOut")}
      </Button>
    </div>
  );
}
