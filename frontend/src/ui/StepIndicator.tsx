import { AppText } from './AppText';

export function StepIndicator({ step, total, name }: { step: number; total: number; name: string }) {
  return (
    <AppText variant="caption" color="textMuted" accessibilityRole="header">
      {`Paso ${step} de ${total} · ${name}`}
    </AppText>
  );
}
