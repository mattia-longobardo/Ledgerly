"use client";

import { useTranslations } from "next-intl";
import { profile } from "@ledgerly/api-contract/settings";
import { subscriptions } from "@ledgerly/api-contract/subscriptions";
import { numberStyle } from "@ledgerly/format/format";
import { buttonClassName } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { DownloadLink } from "@ledgerly/ui/download";
import { subscriptionsCsv } from "./export-csv";

/** «Export CSV»: the file of the subscriptions as the page reads them, saved by the browser. */
export function ExportLink() {
  const text = useTranslations("subscriptions");
  const view = useApi(subscriptions.listSubscriptions, {}).data;
  const prefs = useApi(profile.getPreferences, {}).data;
  return (
    <DownloadLink
      name="subscriptions.csv"
      type="text/csv;charset=utf-8"
      content={view && prefs ? subscriptionsCsv(view, text, numberStyle(prefs)) : null}
      className={buttonClassName("ghost", "sm")}
    >
      {text("export")}
    </DownloadLink>
  );
}
