import { useTranslations } from "next-intl";
import { Page } from "@ledgerly/ui/shell/page";
import { LoadingState } from "@ledgerly/ui/states";

/** What the Time off pages show while their year is being read. */
export default function TimeOffLoading() {
  const t = useTranslations("timeoff");
  return (
    <Page title={t("title")}>
      <div data-testid="timeoff-loading">
        <LoadingState label={t("loading")} />
      </div>
    </Page>
  );
}
