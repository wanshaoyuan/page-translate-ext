(function (root, factory) {
  const api = factory();
  root.PT = Object.assign(root.PT || {}, api);
  if (typeof module !== "undefined" && module.exports && typeof process !== "undefined") {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function parseSiteList(value) {
    const raw = Array.isArray(value) ? value.join("\n") : String(value || "");
    return raw
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function hostFromPattern(pattern) {
    let host = String(pattern || "").trim().toLowerCase();
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    host = host.split("/")[0].split("?")[0].split("#")[0];
    host = host.replace(/:\d+$/, "");
    if (host.startsWith("*.")) host = `*.${host.slice(2)}`;
    return host;
  }

  function isSiteDisabled(hostname, patterns) {
    const host = String(hostname || "")
      .toLowerCase()
      .replace(/:\d+$/, "");
    if (!host) return false;
    return parseSiteList(patterns).some((raw) => {
      const pattern = hostFromPattern(raw);
      if (!pattern) return false;
      if (pattern.startsWith("*.")) {
        const rest = pattern.slice(2);
        if (!rest || (!rest.includes(".") && rest !== "localhost")) return false;
        return host === rest || host.endsWith(`.${rest}`);
      }
      if (!pattern.includes(".") && pattern !== "localhost") return host === pattern;
      return host === pattern || host.endsWith(`.${pattern}`);
    });
  }

  return { parseSiteList, hostFromPattern, isSiteDisabled };
});
