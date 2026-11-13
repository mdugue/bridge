/**
 * An app's registered teardowns, unwound (create-app.ts keeps the list:
 * everything the boot creates registers here, so a failed boot frees
 * exactly what a clean dispose would).
 */

/**
 * Unwinds registered teardowns in reverse creation order, every one of
 * them: a cleanup that throws (three disposing a half-made attribute)
 * does not keep the listeners, targets and workers registered before it.
 * What was thrown is thrown on once all have run.
 */
export function runCleanups(cleanups: readonly (() => void)[]): void {
  const failures: unknown[] = [];
  for (const cleanup of [...cleanups].reverse()) {
    try {
      cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, "several cleanups failed");
  }
}
