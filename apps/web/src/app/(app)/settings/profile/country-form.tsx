"use client";

// The person's country (rewrite plan R5a, E4): `PUT /country`. The format already chosen stays; what
// the country proposes from now on (the tax of a new interest rule) follows its pack, or nothing (D3).
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { ONBOARDING } from "@ledgerly/api-contract";
import { call } from "@ledgerly/api-client";
import { intlLocale } from "@ledgerly/format/format";
import { Button } from "@ledgerly/ui/button";
import { CardFooter } from "@ledgerly/ui/card";
import { invalidate } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { Select } from "@ledgerly/ui/input";
import { FIELD_GRID } from "@ledgerly/ui/section";
import { notify } from "@ledgerly/ui/toast";
import { countryOptions } from "@/platform/country";

export function CountryForm({ initial }: { initial: string | null }) {
  const text = useTranslations("settings.country");
  const locale = useLocale();
  const [countries] = useState(() => countryOptions(intlLocale(locale)));
  const [country, setCountry] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      try {
        await call(ONBOARDING.setCountry, { body: { country: country || null } });
        invalidate(ONBOARDING.getOnboarding);
        notify(text("saved"));
      } catch {
        notify(text("failed"), "error");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className={FIELD_GRID}>
      <Field label={text("label")} htmlFor="country" hint={text("hint")}>
        <Select id="country" value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="">{text("none")}</option>
          {countries.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <CardFooter>
        <Button type="submit" variant="primary" size="sm" disabled={pending || country === (initial ?? "")}>
          {text("save")}
        </Button>
      </CardFooter>
    </form>
  );
}
