import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RegisterScreen } from "./register-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("payroll"))("title") };
}

/** Payroll reads everything it shows from `/api/v1` (rewrite plan R3). */
export default function PayrollPage() {
  return <RegisterScreen />;
}
