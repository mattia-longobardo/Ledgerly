// The new Funds home and a fund's new page are on `main` before they are connected (docs/design/funds-ux.md §8): Mattia
// must never see two designs. Their routes answer only where FUNDS_HOME_PREVIEW=1, which is the local
// preview the end-to-end specs run against, and never the deployed site, whose environment does not
// set it. The last phase (F5) moves the pages to /funds and removes this file.
export function fundsHomePreview(): boolean {
  return process.env.FUNDS_HOME_PREVIEW === "1";
}
