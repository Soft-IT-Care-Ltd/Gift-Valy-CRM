// Inline pre-hydration polyfills for iOS/Safari 14–15.3 (see browserslist in
// package.json). browserslist makes SWC downlevel *syntax*, but runtime APIs
// used by React 19 / Next 16 internals (Object.hasOwn, Array.prototype.at —
// both Safari 15.4+) still need polyfilling. Rendered as an inline <script> at
// the top of <body> so it runs before any bundle chunk executes; must stay
// ES5-only so it parses on any WebKit.
export const LEGACY_POLYFILLS = `(function () {
  if (!Object.hasOwn) {
    Object.defineProperty(Object, "hasOwn", {
      value: function (o, k) {
        return Object.prototype.hasOwnProperty.call(Object(o), k);
      },
      writable: true,
      configurable: true,
    });
  }
  function at(n) {
    var len = this.length;
    n = Math.trunc(n) || 0;
    if (n < 0) n += len;
    if (n < 0 || n >= len) return undefined;
    return this[n];
  }
  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, "at", {
      value: at,
      writable: true,
      configurable: true,
    });
  }
  if (!String.prototype.at) {
    Object.defineProperty(String.prototype, "at", {
      value: at,
      writable: true,
      configurable: true,
    });
  }
})();`;
