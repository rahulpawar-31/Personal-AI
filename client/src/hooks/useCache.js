import { useMemo } from 'react';

// Pure logic, no React — testable directly. useCache() below is just a
// useMemo wrapper so components get a stable reference across re-renders.
export function createCache(defaultKey, ttlMs) {
  function readEntry(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { data, at } = JSON.parse(raw);
      if (Date.now() - at > ttlMs) return null;
      return { data, at };
    } catch {
      return null;
    }
  }

  function get(key = defaultKey) {
    return readEntry(key)?.data ?? null;
  }

  // Like get(), but also returns when the entry was written — for callers
  // that display cache freshness (e.g. "cached 4m ago") instead of just the
  // cached value. Never read localStorage directly for this; extend here.
  function getWithAge(key = defaultKey) {
    const entry = readEntry(key);
    return entry ? { value: entry.data, at: entry.at } : null;
  }

  function set(data, key = defaultKey) {
    try {
      localStorage.setItem(key, JSON.stringify({ data, at: Date.now() }));
    } catch {
      // Storage can throw (quota exceeded, private-browsing restrictions) —
      // safe to ignore, caching is a pure optimization here.
    }
  }

  function clear(key = defaultKey) {
    localStorage.removeItem(key);
  }

  return { get, getWithAge, set, clear };
}

export function useCache(defaultKey, ttlMs) {
  return useMemo(() => createCache(defaultKey, ttlMs), [defaultKey, ttlMs]);
}
