import { useTranslations } from "next-intl";
import { Page } from "@/ui/shell/page";
import { Skeleton } from "@ledgerly/ui/skeleton";

/** The shape of "To review" while it is read: the controls, three groups and the summary. */
export default function ReviewLoading() {
  const t = useTranslations("expenses");
  return (
    <Page title={t("review.title")} parent={{ href: "/expenses", label: t("title") }}>
      <div aria-busy className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-7 w-full max-w-xl" />
        <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
          <Skeleton className="h-32" />
        </div>
      </div>
    </Page>
  );
}
