export type AmountParse = { ok: true; value: string } | { ok: false; error: string };

/**
 * Convierte lo que escribe la persona ("86400", "86.400", "86.400,50") en el string de la API
 * ("86400.00"), sin pasar por `Number`. La coma es el decimal; los puntos agrupan miles.
 */
export function parseAmountInput(input: string, scale: number): AmountParse {
  const text = input.trim().replace(/\s/g, '');
  if (!text) return { ok: false, error: 'Escriba el valor de la factura' };
  if (!/^[\d.,]+$/.test(text)) return { ok: false, error: 'Use solo números' };

  let whole: string;
  let decimals = '';
  if (text.includes(',')) {
    const parts = text.split(',');
    if (parts.length > 2) return { ok: false, error: 'Revise el valor: tiene más de una coma' };
    whole = parts[0].replace(/\./g, '');
    decimals = parts[1];
    if (parts[0] && !/^\d{1,3}(\.\d{3})*$|^\d+$/.test(parts[0])) {
      return { ok: false, error: 'Revise el valor escrito' };
    }
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    whole = text.replace(/\./g, '');
  } else if (/^\d+\.\d+$/.test(text)) {
    [whole, decimals] = text.split('.');
  } else if (/^\d+$/.test(text)) {
    whole = text;
  } else {
    return { ok: false, error: 'Revise el valor escrito' };
  }

  if (!whole) return { ok: false, error: 'Revise el valor escrito' };
  if (decimals.length > scale) {
    return { ok: false, error: `El valor puede tener hasta ${scale} decimales` };
  }
  whole = whole.replace(/^0+(?=\d)/, '');
  if (!/[1-9]/.test(whole + decimals)) return { ok: false, error: 'El valor debe ser mayor que cero' };
  return { ok: true, value: scale > 0 ? `${whole}.${decimals.padEnd(scale, '0')}` : whole };
}
