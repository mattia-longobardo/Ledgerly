// The new Funds home is on `main` before its pages are connected (docs/design/funds-ux.md §8): Mattia
// must never see two designs. Its route answers only where FUNDS_HOME_PREVIEW=1, which is the local
// preview the end-to-end specs run against, and never the deployed site, whose environment does not
// set it. The last phase (F5) moves the page to /funds and removes this file.
export function fundsHomePreview(): boolean {
  return process.env.FUNDS_HOME_PREVIEW === "1";
}
