export {};

declare global {
  interface Map<K, V> {
    /** JavaScript Map#get safely returns undefined when a nullable lookup key is absent. */
    get(key: K | null): V | undefined;
  }
}
