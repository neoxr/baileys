export declare function cleanupQueues(): void;
export default function queueJob<T>(bucket: string | number, awaitable: () => Promise<T>): Promise<T>;
