import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@/api/client';
import { authApi, type RegistrationChallenge } from '@/features/auth/api';
import { PasskeyAlreadyRegistered, PasskeyCancelled } from '@/features/auth/passkeys';
import { usePasskeys } from '@/features/auth/passkeys-context';
import { registerSchema, type RegisterData, type RegisterInput } from '@/features/auth/schemas';
import { useSession } from '@/features/auth/session';
import { AppHeader, AppText, Button, Card, Screen, StepIndicator, TextField } from '@/ui';

function passkeyErrorMessage(error: unknown): string {
  if (error instanceof PasskeyCancelled) return 'No se creó el passkey. Intente de nuevo';
  if (error instanceof PasskeyAlreadyRegistered) {
    return 'Este dispositivo ya tiene un passkey de TuTranqui. Pruebe a ingresar.';
  }
  if (error instanceof ApiError && error.code === 'CHALLENGE_EXPIRED') {
    return 'Se venció el tiempo. Vuelva al paso anterior e intente de nuevo.';
  }
  return 'No pudimos crear su cuenta. Intente de nuevo.';
}

export default function Register() {
  const router = useRouter();
  const passkeys = usePasskeys();
  const { signIn } = useSession();
  const [step, setStep] = useState<'datos' | 'passkey'>('datos');
  const [challenge, setChallenge] = useState<RegistrationChallenge | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  const { control, handleSubmit, setError } = useForm<RegisterInput, unknown, RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', walletName: '' },
  });

  const submitData = handleSubmit(async (data) => {
    if (loading) return;
    setLoading(true);
    setFormError(null);
    setAlreadyRegistered(false);
    try {
      setChallenge(await authApi.registerOptions({ displayName: data.displayName, walletAddress: data.walletName }));
      setStep('passkey');
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      if (code === 'WALLET_NOT_FOUND') {
        setError('walletName', { message: 'No encontramos esa wallet. Revise el nombre.' });
      } else if (code === 'WALLET_NOT_ALLOWED') {
        setError('walletName', { message: 'Esa wallet no está permitida por ahora.' });
      } else if (code === 'WALLET_ALREADY_REGISTERED') {
        setError('walletName', { message: 'Esa wallet ya tiene una cuenta.' });
        setAlreadyRegistered(true);
      } else {
        setFormError('No pudimos seguir. Revise su internet e intente de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  });

  async function createPasskey() {
    if (loading || !challenge) return;
    setLoading(true);
    setPasskeyError(null);
    try {
      const { challengeId, ...options } = challenge;
      const credential = await passkeys.create(options);
      await signIn(await authApi.registerVerify({ challengeId, credential }));
      router.replace('/vincular');
    } catch (error) {
      setPasskeyError(passkeyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <AppHeader actionLabel="Cancelar" onAction={() => router.replace('/bienvenida')} />
      {step === 'datos' ? (
        <>
          <StepIndicator step={1} total={3} name="Sus datos" />
          <AppText variant="title">Cuéntenos quién es</AppText>
          <Controller
            control={control}
            name="displayName"
            render={({ field, fieldState }) => (
              <TextField
                label="Su nombre"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                autoComplete="name"
                textContentType="name"
              />
            )}
          />
          <Controller
            control={control}
            name="walletName"
            render={({ field, fieldState }) => (
              <TextField
                label="Nombre de su wallet"
                help="Es el nombre de su cuenta en su wallet, por ejemplo claudia. No necesitamos su clave."
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
          />
          {alreadyRegistered ? (
            <Button label="Ingresar" variant="secondary" onPress={() => router.replace('/ingresar')} />
          ) : null}
          {formError ? (
            <AppText color="danger" accessibilityRole="alert">
              {formError}
            </AppText>
          ) : null}
          <Button label="Seguir" onPress={submitData} loading={loading} />
        </>
      ) : (
        <>
          <StepIndicator step={2} total={3} name="Su passkey" />
          <AppText variant="title">Cree su passkey</AppText>
          <Card>
            <AppText>
              Use la huella, el rostro o el bloqueo de su teléfono. Así entra a TuTranqui sin
              contraseñas y confirma cada pago.
            </AppText>
          </Card>
          {passkeyError ? (
            <AppText color="danger" accessibilityRole="alert">
              {passkeyError}
            </AppText>
          ) : null}
          <Button label="Crear mi passkey" onPress={createPasskey} loading={loading} />
          <Button label="Atrás" variant="ghost" disabled={loading} onPress={() => setStep('datos')} />
        </>
      )}
    </Screen>
  );
}
