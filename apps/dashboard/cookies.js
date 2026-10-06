/** Tiny cookie parser middleware (no dependencies). */
export function parseCookies(req, _res, next) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  req.cookies = out;
  next();
}
