import { z } from 'zod';

/**
 * Devuelve el nombre (handle) de la wallet recortado si es válido: un solo segmento, sin
 * esquema, host, ruta, credenciales, query ni fragmento. El resto de la dirección la aporta la
 * configuración del sistema (`WALLET_PROVIDER_BASE_URL`) y la resuelve el backend.
 * `null` si no es un nombre válido.
 */
export function normalizeWalletName(input: string): string | null {
  const name = input.trim();
  if (!name || /\s/.test(name)) return null;
  if (/[/\\?#@:$]/.test(name)) return null;
  return name;
}

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Escriba su nombre')
  .max(60, 'El nombre es muy largo (máximo 60 letras)');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Escriba un correo válido')
  .max(254, 'El correo es muy largo');

export const walletNameSchema = z
  .string()
  .transform((value, ctx) => {
    const name = normalizeWalletName(value);
    if (!name) {
      ctx.addIssue({
        code: 'custom',
        message: 'Escriba el nombre de su wallet, por ejemplo claudia',
      });
      return z.NEVER;
    }
    return name;
  });

export const registerSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  walletName: walletNameSchema,
});

export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterData = z.output<typeof registerSchema>;
