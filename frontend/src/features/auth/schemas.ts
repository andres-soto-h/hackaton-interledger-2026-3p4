import { z } from 'zod';

/**
 * Acepta una wallet como URL `https://host/ruta` o como *payment pointer* `$host/ruta` y la
 * devuelve en forma `https://host/ruta`. `null` si no es una dirección de wallet válida.
 */
export function normalizeWalletAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const withScheme = text.startsWith('$') ? `https://${text.slice(1)}` : text;
  if (!/^https:\/\//i.test(withScheme)) return null;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!url.hostname || !path || url.username || url.password || url.search || url.hash) return null;
  return `https://${url.host}${path}`;
}

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Escriba su nombre')
  .max(60, 'El nombre es muy largo (máximo 60 letras)');

export const walletAddressSchema = z
  .string()
  .transform((value, ctx) => {
    const normalized = normalizeWalletAddress(value);
    if (!normalized) {
      ctx.addIssue({
        code: 'custom',
        message: 'Escriba la dirección de su wallet, por ejemplo https://ilp.ejemplo.com/ana',
      });
      return z.NEVER;
    }
    return normalized;
  });

export const registerSchema = z.object({
  displayName: displayNameSchema,
  walletAddress: walletAddressSchema,
});

export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterData = z.output<typeof registerSchema>;
