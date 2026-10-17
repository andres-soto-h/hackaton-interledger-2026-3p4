import * as Haptics from 'expo-haptics';

/**
 * Haptics ligeros y seguros. Nunca rompen la app si la plataforma no los soporta
 * (web, emuladores sin motor de vibración o tests): son realce, no funcionalidad.
 */
async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Sin haptics no pasa nada.
  }
}

/** Toque ligero: botones y acciones primarias. */
export function hapticTap(): Promise<void> {
  return run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Cambio de selección: chips, filtros. */
export function hapticSelection(): Promise<void> {
  return run(() => Haptics.selectionAsync());
}

/** Resultado exitoso: pago confirmado. */
export function hapticSuccess(): Promise<void> {
  return run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Error o rechazo. */
export function hapticError(): Promise<void> {
  return run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
