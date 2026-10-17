import { Redirect, Stack, usePathname } from 'expo-router';
import { useSession } from '@/features/auth/session';

/** Rutas sin sesión: si ya hay una, se va al inicio. */
export default function PublicLayout() {
  const { status } = useSession();
  const pathname = usePathname();
  if (status === 'loading') return null;
  if (status === 'signedIn') return <Redirect href={pathname === '/registro' ? '/vincular' : '/'} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
