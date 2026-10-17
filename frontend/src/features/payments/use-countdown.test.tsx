import { act, renderHook } from '@testing-library/react-native';
import { useCountdown } from './use-countdown';

describe('useCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('cuenta hacia atrás cada segundo y vence en 0', async () => {
    const { result } = await renderHook(() => useCountdown('2026-10-17T12:01:30Z'));
    expect(result.current).toEqual({ secondsLeft: 90, expired: false });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(result.current.secondsLeft).toBe(60);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current).toEqual({ secondsLeft: 0, expired: true });
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(result.current.secondsLeft).toBe(0);
  });

  it('sin confirmBy no hay cuenta regresiva', async () => {
    const { result } = await renderHook(() => useCountdown(undefined));
    expect(result.current).toEqual({ secondsLeft: null, expired: false });
  });
});
