import { useEffect } from 'react';
import { Stack, SplashScreen } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Lexend_600SemiBold } from '@expo-google-fonts/lexend';
import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
} from '@expo-google-fonts/atkinson-hyperlegible';
import { useFonts } from 'expo-font';
import { AgentProvider } from '@/features/agent/agent-context';
import { PasskeysProvider } from '@/features/auth/passkeys-context';
import { SessionProvider } from '@/features/auth/session';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Lexend_600SemiBold,
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Si las fuentes fallan se usa la fuente del sistema: la app sigue siendo usable.
  if (!fontsLoaded && !fontError) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <PasskeysProvider>
          <AgentProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }} />
          </AgentProvider>
        </PasskeysProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
