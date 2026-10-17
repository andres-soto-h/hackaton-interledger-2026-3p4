import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/features/auth/session';

/** Rutas sin sesión: si ya hay una, se va al inicio. */
export default function PublicLayout() {
  const { status } = useSession();
  if (status === 'loading') return null;
  if (status === 'signedIn') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
