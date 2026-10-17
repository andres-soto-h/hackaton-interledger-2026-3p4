// Tokens de DISENO.md. Contraste AA para texto; `accent` solo como fondo.
export const colors = {
  primary: '#0B3364',
  accent: '#F7844B',
  success: '#2E6B45',
  danger: '#9A3D12',
  text: '#111111',
  textMuted: '#4A5170',
  surface: '#FFFFFF',
  surfaceAlt: '#E6E9F2',
  background: '#FBF8F2',
  border: '#E0E0E0',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radii = { card: 16, button: 14, chip: 22 } as const;

export const layout = { screenMargin: 20, maxContentWidth: 480, minTouch: 48, buttonHeight: 52 } as const;

export const fontFamilies = {
  heading: 'Lexend_600SemiBold',
  body: 'AtkinsonHyperlegible_400Regular',
  bodyStrong: 'AtkinsonHyperlegible_700Bold',
} as const;

export const typography = {
  title: { fontFamily: fontFamilies.heading, fontSize: 22, lineHeight: 30 },
  heading: { fontFamily: fontFamilies.heading, fontSize: 19, lineHeight: 26 },
  body: { fontFamily: fontFamilies.body, fontSize: 17, lineHeight: 24 },
  bodyStrong: { fontFamily: fontFamilies.bodyStrong, fontSize: 17, lineHeight: 24 },
  label: { fontFamily: fontFamilies.body, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 18 },
} as const;

export type TypographyVariant = keyof typeof typography;

/** Tope al escalado de fuente del sistema para no romper el diseño. */
export const MAX_FONT_SCALE = 1.4;
