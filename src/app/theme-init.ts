// Runs in the document head before first paint so the stored (or system)
// theme is applied without a flash of the wrong colours. Kept as a plain
// string with no external references so it can be inlined verbatim.
export const THEME_STORAGE_KEY = "hs-tracker-theme";

export const themeInitScript = `(function(){try{var k="${THEME_STORAGE_KEY}";var s=localStorage.getItem(k);var m=window.matchMedia("(prefers-color-scheme: dark)").matches;var t=s==="light"||s==="dark"?s:(m?"dark":"light");var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;}catch(e){}})();`;
