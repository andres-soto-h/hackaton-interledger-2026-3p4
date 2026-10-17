import { useEffect, useState } from 'react';
import { usePasskeys } from './passkeys-context';

/** `undefined` mientras se consulta; luego `true` o `false`. */
export function usePasskeySupport(): boolean | undefined {
  const passkeys = usePasskeys();
  const [supported, setSupported] = useState<boolean | undefined>();
  useEffect(() => {
    let active = true;
    passkeys.isSupported().then((value) => active && setSupported(value));
    return () => {
      active = false;
    };
  }, [passkeys]);
  return supported;
}
