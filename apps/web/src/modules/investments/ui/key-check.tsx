import { useTranslations } from "next-intl";
import { Badge } from "@/ui/badge";

/**
 * The key's last check on the service page, with a warning when Binance says the key is not
 * restricted by IP (design §5.2, B1; PERS-87 SEC-02). `null` (the provider does not say) shows nothing.
 */
export function KeyCheckLine({ text, ipRestricted }: { text: string; ipRestricted: boolean | null }) {
  const t = useTranslations("investments");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {text}
      {ipRestricted === false && <Badge tone="warn">{t("sync.ipUnrestricted")}</Badge>}
    </span>
  );
}
