/**
 * Simple concurrency pool for enrichment loops.
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const limit = Math.max(1, concurrency);
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    async function runWorker(): Promise<void> {
        while (true) {
            const current = nextIndex++;
            if (current >= items.length) return;
            results[current] = await worker(items[current], current);
        }
    }

    await Promise.all(Array.from({length: Math.min(limit, items.length)}, () => runWorker()));
    return results;
}
