export const newId = () => `tmp-${Math.random().toString(36).slice(2, 10)}`;

export const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
export function toErrorMessage(err, fallback = "알 수 없는 오류가 발생했습니다.") {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err && typeof err.message === "string") return err.message;
  return fallback;
}

/**
 * @param {unknown} err
 * @param {string} [context]
 * @returns {{message: string, stack: string, raw: string, context: string, timestamp: string}}
 */
export function toErrorDetail(err, context = "") {
  const message = toErrorMessage(err);
  const stack = typeof err === "object" && err && "stack" in err && typeof err.stack === "string" ? err.stack : "";
  let raw = "";
  try {
    if (typeof err === "string") raw = err;
    else raw = JSON.stringify(err, null, 2);
  } catch {
    raw = String(err);
  }
  return {
    message,
    stack,
    raw,
    context,
    timestamp: new Date().toISOString()
  };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBlankValue(value) {
  return String(value ?? "").trim() === "";
}

/**
 * Remove existing value and insert at one-based position when valid.
 * If order is invalid or <= 0, value is removed and not reinserted.
 * @template T
 * @param {T[]} items
 * @param {T} value
 * @param {string|number} rawOrder
 * @returns {T[]}
 */
export function applyOneBasedOrder(items, value, rawOrder) {
  const order = Number.parseInt(String(rawOrder), 10);
  const next = [...items].filter((v) => v !== value);
  if (Number.isFinite(order) && order > 0) {
    next.splice(Math.max(0, Math.min(next.length, order - 1)), 0, value);
  }
  return next;
}

export const nowWithMs = () => {
  const d = new Date();
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

/**
 * @param {any} fk
 * @returns {Array<{child: string, parent: string}>}
 */
export function buildFkPairs(fk) {
  const c = fk?.childColumns || [];
  const p = fk?.parentColumns || [];
  const n = Math.max(c.length, p.length);
  return Array.from({ length: n }, (_, i) => ({ child: c[i] || "", parent: p[i] || "" }));
}

/**
 * @param {{ values: Record<string, string> }} row
 * @param {string} whereClause
 * @returns {boolean}
 */
export function matchesWhere(row, whereClause) {
  const expr = (whereClause || "").trim();
  if (!expr) return true;
  const andParts = expr.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  return andParts.every((part) => {
    const likeIdx = part.indexOf("~");
    if (likeIdx > 0) {
      const col = part.slice(0, likeIdx).trim();
      const term = part.slice(likeIdx + 1).trim().toLowerCase();
      return (row.values[col] || "").toLowerCase().includes(term);
    }
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0) {
      const col = part.slice(0, eqIdx).trim();
      const val = part.slice(eqIdx + 1).trim();
      return (row.values[col] || "") === val;
    }
    return true;
  });
}
