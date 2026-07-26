import { AsyncSemaphore } from './async-semaphore';

describe('AsyncSemaphore', () => {
  it('serializa operacoes pesadas quando o limite e um', async () => {
    const semaphore = new AsyncSemaphore(1);
    let active = 0;
    let maximumActive = 0;

    const operations = Array.from({ length: 8 }, (_, index) =>
      semaphore.run(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return index;
      }),
    );

    await expect(Promise.all(operations)).resolves.toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(maximumActive).toBe(1);
  });

  it('libera a fila mesmo quando uma operacao falha', async () => {
    const semaphore = new AsyncSemaphore(1);

    const failed = semaphore.run(() =>
      Promise.reject(new Error('falha controlada')),
    );
    const successful = semaphore.run(() =>
      Promise.resolve('fallback executado'),
    );

    await expect(failed).rejects.toThrow('falha controlada');
    await expect(successful).resolves.toBe('fallback executado');
  });
});
