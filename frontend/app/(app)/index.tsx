import { AmountRow, AppHeader, AppText, Card, Screen } from '@/ui';
import { LinkWalletBanner } from '@/features/wallet-link/components/LinkWalletBanner';
import { formatMoney } from '@/lib/money';

// Pantalla base del spec 001: se reemplaza por el inicio en el spec 004.
export default function Home() {
  return (
    <Screen>
      <AppHeader />
      <AppText variant="title">Hola, bienvenida a TuTranqui</AppText>
      <LinkWalletBanner />
      <Card>
        <AppText variant="body">Pague sus servicios con calma. Nada se mueve sin su sí.</AppText>
        <AmountRow label="Ejemplo de factura" value={formatMoney({ value: '86400.00', assetCode: 'COP' })} />
      </Card>
    </Screen>
  );
}
