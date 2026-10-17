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
  // Borde sutil para superficies (tarjetas, chips): delinean sin parecer una "caja".
  // En modo oscuro se invierte a rgba(255,255,255,0.08).
  borderSubtle: 'rgba(0,0,0,0.06)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radii = { card: 16, button: 14, chip: 22, bubble: 18, bubbleTip: 4 } as const;

export const layout = {
  screenMargin: 20,
  maxContentWidth: 480,
  minTouch: 48,
  buttonHeight: 52,
  avatarSize: 44,
} as const;

/** Ancho de borde. Hairline = 1 px (bordes sutiles, no cajas de 2 px). */
export const borderWidth = { hairline: 1 } as const;

export const iconSize = { sm: 18, md: 20, lg: 24 } as const;

/** Elevación en capas: sombras muy sutiles y teñidas con la marca (nunca el "drop shadow" genérico). */
export const shadows = {
  card: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
} as const;

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
  labelStrong: { fontFamily: fontFamilies.bodyStrong, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fontFamilies.body, fontSize: 13, lineHeight: 18 },
} as const;

export type TypographyVariant = keyof typeof typography;

/** Tope al escalado de fuente del sistema para no romper el diseño. */
export const MAX_FONT_SCALE = 1.4;
