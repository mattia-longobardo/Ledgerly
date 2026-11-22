import { redirect } from "next/navigation";

/** "Export my data": the server's process writes it (`/api/export.zip`, rewrite plan R4). */
export function GET(): never {
  redirect("/api/export.zip");
}
