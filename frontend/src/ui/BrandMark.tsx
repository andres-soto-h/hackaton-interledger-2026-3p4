import { Image, StyleSheet } from 'react-native';
import { radii } from '@/theme';

/** Logo de TuTranqui recortado en círculo (la imagen es cuadrada). */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/logo-app-tranqui.jpeg')}
      style={[styles.logo, { width: size, height: size }]}
      resizeMode="cover"
      accessible={false}
    />
  );
}

const styles = StyleSheet.create({ logo: { borderRadius: radii.circle } });
