export const BROWSER_LAUNCH_MATRIX_LOCALES = ["en", "zh-Hans"] as const;

export type BrowserLaunchMatrixLocale =
  (typeof BROWSER_LAUNCH_MATRIX_LOCALES)[number];

export const BROWSER_LAUNCH_MATRIX_VIEWPORTS = [
  { width: 1_440, height: 900 },
  { width: 1_024, height: 768 },
  { width: 768, height: 1_024 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

export type BrowserLaunchMatrixViewport = {
  readonly width: number;
  readonly height: number;
};

export function browserLaunchMatrixContextKey(
  locale: BrowserLaunchMatrixLocale,
  viewport: BrowserLaunchMatrixViewport,
): string {
  return `${locale}:${viewport.width}x${viewport.height}`;
}

export const REQUIRED_BROWSER_LAUNCH_MATRIX_CONTEXTS = Object.freeze(
  BROWSER_LAUNCH_MATRIX_LOCALES.flatMap((locale) =>
    BROWSER_LAUNCH_MATRIX_VIEWPORTS.map((viewport) =>
      browserLaunchMatrixContextKey(locale, viewport),
    ),
  ),
);

export const BROWSER_LAUNCH_MATRIX_LIMITS = {
  lcpMs: 2_500,
  interactionToNextPaintMs: 200,
} as const;
