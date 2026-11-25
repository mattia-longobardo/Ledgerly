// The bank's page a plugin answers, opened only over `https:`: a plugin is not trusted with the
// app's origin, and `javascript:` in `location.assign` would run in it.
export function isBankPage(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
