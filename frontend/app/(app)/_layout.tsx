import { Redirect, Stack, usePathname } from 'expo-router';
import { useSession } from '@/features/auth/session';

/** Rutas privadas: sin sesión se va a ingresar y, al ingresar, se vuelve a la ruta pedida. */
export default function PrivateLayout() {
  const { status } = useSession();
  const pathname = usePathname();
  if (status === 'loading') return null;
  if (status === 'signedOut') {
    const redirect = pathname && pathname !== '/' ? pathname : undefined;
    return <Redirect href={{ pathname: '/ingresar', params: redirect ? { redirect } : {} }} />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
