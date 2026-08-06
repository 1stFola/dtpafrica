/**
 * `fetchpriority` hint for above-the-fold hero imagery.
 *
 * React 18 does not map the camelCase `fetchPriority` prop onto the DOM — it
 * forwards it verbatim and warns ("React does not recognize the fetchPriority
 * prop..."). The lowercase attribute is what the browser actually reads, and
 * it passes through every React version untouched. Drop this in favour of the
 * camelCase prop once the app is on React 19.
 */
export const HIGH_FETCH_PRIORITY = { fetchpriority: "high" } as Record<string, string>;
