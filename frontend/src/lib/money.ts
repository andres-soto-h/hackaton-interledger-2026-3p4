export type Amount = { value: string; assetCode: string };

const VALUE_PATTERN = /^(\d+)(?:\.(\d+))?$/;

const SYMBOLS: Record<string, string> = { COP: '$', USD: 'US$' };
const UNITS: Record<string, { singular: string; plural: string; cents: string }> = {
  COP: { singular: 'peso', plural: 'pesos', cents: 'centavos' },
  USD: { singular: 'dólar', plural: 'dólares', cents: 'centavos' },
};

function parseValue(value: string): { whole: string; decimals: string } {
  const match = VALUE_PATTERN.exec(value);
  if (!match) throw new Error(`Monto inválido: "${value}"`);
  return { whole: match[1].replace(/^0+(?=\d)/, ''), decimals: match[2] ?? '' };
}

function assertAssetCode(assetCode: string) {
  if (!assetCode) throw new Error('Moneda vacía');
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Formatea un monto en es-CO sin pasar por `Number`: opera sobre el string de la API. */
export function formatMoney({ value, assetCode }: Amount): string {
  assertAssetCode(assetCode);
  const { whole, decimals } = parseValue(value);
  const integer = groupThousands(whole);
  const hasDecimals = /[1-9]/.test(decimals);

  let text: string;
  if (assetCode === 'COP') {
    text = hasDecimals ? `${integer},${decimals}` : integer;
  } else {
    text = `${integer},${(decimals || '00').padEnd(2, '0')}`;
  }
  const symbol = SYMBOLS[assetCode];
  return symbol ? `${symbol}${text}` : `${assetCode} ${text}`;
}

const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho',
  'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos',
  'setecientos', 'ochocientos', 'novecientos',
];

/** Convierte 0–999 a palabras (con "uno" tal cual; el apócope lo resuelve el llamador). */
function below1000(n: number): string {
  if (n === 100) return 'cien';
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(CENTENAS[hundreds]);
  if (rest) {
    if (rest < 30) parts.push(UNIDADES[rest]);
    else {
      const unit = rest % 10;
      parts.push(unit ? `${DECENAS[Math.floor(rest / 10)]} y ${UNIDADES[unit]}` : DECENAS[rest / 10]);
    }
  }
  return parts.join(' ');
}

/** "uno" → "un" y "veintiuno" → "veintiún" cuando van antes de un sustantivo o de "mil". */
function apocope(words: string): string {
  return words.replace(/veintiuno$/, 'veintiún').replace(/\buno$/, 'un');
}

/** 0–999.999 a palabras. */
function below1e6(n: number): string {
  const miles = Math.floor(n / 1000);
  const unidades = n % 1000;
  const parts: string[] = [];
  if (miles) parts.push(miles === 1 ? 'mil' : `${apocope(below1000(miles))} mil`);
  if (unidades) parts.push(below1000(unidades));
  return parts.join(' ');
}

/** Entero (string de dígitos) a palabras, hasta 999.999.999.999. */
function wholeToWords(whole: string): string {
  if (whole.length > 12) throw new Error('Monto demasiado grande para decirlo en voz alta');
  const n = Number(whole); // ≤ 12 dígitos: seguro en doble precisión
  if (n === 0) return 'cero';
  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  const parts: string[] = [];
  if (millones) {
    parts.push(millones === 1 ? 'un millón' : `${apocope(below1e6(millones))} millones`);
  }
  if (resto) parts.push(below1e6(resto));
  return parts.join(' ');
}

/** Texto en palabras para lector de pantalla y voz (specs 006 y 009). */
export function toSpokenAmount({ value, assetCode }: Amount): string {
  assertAssetCode(assetCode);
  const { whole, decimals } = parseValue(value);
  const units = UNITS[assetCode];
  const isOne = BigInt(whole) === 1n;
  const millionsOnly = /^[1-9]\d*$/.test(whole) && BigInt(whole) % 1_000_000n === 0n;

  let words = wholeToWords(whole);
  if (isOne) words = 'un';
  else if (/\buno$/.test(words)) words = words.replace(/\buno$/, 'un');
  else if (/veintiuno$/.test(words)) words = words.replace(/veintiuno$/, 'veintiún');

  const noun = units ? (isOne ? units.singular : units.plural) : assetCode;
  let text = `${words}${millionsOnly && units ? ' de' : ''} ${noun}`;

  const cents = decimals.slice(0, 2).padEnd(2, '0');
  if (units && /[1-9]/.test(cents)) {
    text += ` con ${wholeToWords(String(Number(cents)))} ${units.cents}`;
  }
  return text;
}
