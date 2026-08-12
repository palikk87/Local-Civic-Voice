import { useEffect, useState } from "react";

/** Returns a debounced copy of `value` that only updates after `delay` ms of quiet. */
export function useDebounce<T>(value: T, delay = 450): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
