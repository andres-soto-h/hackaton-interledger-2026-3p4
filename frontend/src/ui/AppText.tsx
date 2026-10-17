import { Text, type TextProps } from 'react-native';
import { colors, MAX_FONT_SCALE, typography, type TypographyVariant } from '@/theme';

type Props = TextProps & { variant?: TypographyVariant; color?: keyof typeof colors };

export function AppText({ variant = 'body', color = 'text', style, ...rest }: Props) {
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[typography[variant], { color: colors[color] }, style]}
      {...rest}
    />
  );
}
