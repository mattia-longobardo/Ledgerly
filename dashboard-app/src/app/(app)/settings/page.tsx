import { redirect } from "next/navigation";

/** `/settings` is a group, not a page: its first area is the destination. */
export default function SettingsIndexPage() {
  redirect("/settings/personal");
}
