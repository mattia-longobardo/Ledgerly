export const THEME_STORAGE_KEY = "dashboard-theme";

/**
 * Inline, blocking, and tiny: the attribute must land before first paint or the
 * light palette flashes. No stored preference means "follow the system", which
 * globals.css already handles via `prefers-color-scheme`.
 */
const SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
