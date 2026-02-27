export const GENERIC_TYPE_OPTIONS = [
  { value: "STRING", label: "STRING", params: ["length"] },
  { value: "TEXT", label: "TEXT", params: [] },
  { value: "INT32", label: "INT32", params: [] },
  { value: "INT64", label: "INT64", params: [] },
  { value: "DECIMAL", label: "DECIMAL", params: ["precision", "scale"] },
  { value: "DATE", label: "DATE", params: [] },
  { value: "TIMESTAMP", label: "TIMESTAMP", params: [] },
  { value: "BOOLEAN", label: "BOOLEAN", params: [] },
  { value: "BINARY", label: "BINARY", params: ["length"] },
  { value: "BLOB", label: "BLOB", params: [] },
  { value: "UUID", label: "UUID", params: [] },
  { value: "JSON", label: "JSON", params: [] }
];

const ALLOWED_BASES = new Set(GENERIC_TYPE_OPTIONS.map((t) => t.value));

export function defaultTypeSpec(baseType = "STRING") {
  const base = (baseType || "STRING").toUpperCase();
  if (base === "DECIMAL") return { baseType: "DECIMAL", precision: "18", scale: "2" };
  if (base === "BINARY") return { baseType: "BINARY", length: "16" };
  if (base === "STRING") return { baseType: "STRING", length: "255" };
  return { baseType: base };
}

export function buildTypeFromSpec(spec) {
  const base = (spec?.baseType || "").toUpperCase();
  if (!ALLOWED_BASES.has(base)) return "";
  const pick = (v, d) => (v === undefined || v === null || String(v).trim() === "" ? d : String(v).trim());
  if (base === "STRING") return `STRING(${pick(spec.length, "255")})`;
  if (base === "BINARY") return `BINARY(${pick(spec.length, "16")})`;
  if (base === "DECIMAL") return `DECIMAL(${pick(spec.precision, "18")},${pick(spec.scale, "2")})`;
  return base;
}

export function parseTypeToSpec(typeText) {
  const text = (typeText || "").trim();
  if (!text) return defaultTypeSpec("STRING");

  let m = text.match(/^STRING\((\d*)\)$/i);
  if (m) return { baseType: "STRING", length: m[1] || "" };
  m = text.match(/^BINARY\((\d*)\)$/i);
  if (m) return { baseType: "BINARY", length: m[1] || "" };
  m = text.match(/^DECIMAL\((\d*)\s*,\s*(\d*)\)$/i);
  if (m) return { baseType: "DECIMAL", precision: m[1] || "", scale: m[2] || "" };

  m = text.match(/^VARCHAR2?\((\d+)\)$/i) || text.match(/^NVARCHAR2?\((\d+)\)$/i) || text.match(/^CHAR\((\d+)\)$/i);
  if (m) return { baseType: "STRING", length: m[1] };
  if (/^(TEXT|CLOB|LONGTEXT)$/i.test(text)) return { baseType: "TEXT" };
  if (/^(INT|INTEGER|INT4)$/i.test(text)) return { baseType: "INT32" };
  if (/^(BIGINT|INT8)$/i.test(text)) return { baseType: "INT64" };
  m = text.match(/^(DECIMAL|NUMERIC)\((\d+)\s*,\s*(\d+)\)$/i);
  if (m) return { baseType: "DECIMAL", precision: m[2], scale: m[3] };
  m = text.match(/^NUMBER(?:\((\d+)(?:\s*,\s*(\d+))?\))?$/i);
  if (m) {
    const pText = m[1] || "";
    const sText = m[2] || "";
    const p = Number.parseInt(pText || "", 10);
    const s = Number.parseInt(sText || "", 10);

    // Oracle NUMBER(p,0): integer semantics based on precision range.
    if (Number.isFinite(p) && Number.isFinite(s) && s === 0) {
      if (p <= 9) return { baseType: "INT32" };
      if (p <= 18) return { baseType: "INT64" };
      return { baseType: "DECIMAL", precision: String(p), scale: "0" };
    }

    // Oracle NUMBER(p): typically integer with precision p.
    if (Number.isFinite(p) && !sText) {
      if (p <= 9) return { baseType: "INT32" };
      if (p <= 18) return { baseType: "INT64" };
      return { baseType: "DECIMAL", precision: String(p), scale: "0" };
    }

    // Oracle NUMBER(p,s): decimal semantics.
    if (Number.isFinite(p) && Number.isFinite(s)) {
      return { baseType: "DECIMAL", precision: String(p), scale: String(s) };
    }

    // Oracle NUMBER (no precision/scale): keep it as wide decimal default.
    return { baseType: "DECIMAL", precision: "38", scale: "0" };
  }
  if (/^DATE$/i.test(text)) return { baseType: "DATE" };
  if (/^TIMESTAMP(\(\d+\))?(\s+WITH(OUT)?\s+TIME\s+ZONE)?$/i.test(text)) return { baseType: "TIMESTAMP" };
  if (/^(BOOLEAN|BOOL|TINYINT\(1\))$/i.test(text)) return { baseType: "BOOLEAN" };
  if (/^(BLOB|LONGBLOB|BYTEA)$/i.test(text)) return { baseType: "BLOB" };
  if (/^UUID$/i.test(text)) return { baseType: "UUID" };
  if (/^(JSON|JSONB)$/i.test(text)) return { baseType: "JSON" };

  return { baseType: "", raw: text };
}

export function validateTypeSpec(spec) {
  const base = (spec?.baseType || "").toUpperCase();
  if (!ALLOWED_BASES.has(base)) return "지원하지 않는 데이터 타입입니다.";

  const toInt = (v) => Number.parseInt(String(v || ""), 10);
  if (base === "STRING" || base === "BINARY") {
    const len = toInt(spec.length);
    if (!Number.isFinite(len) || len <= 0) return `${base} 길이는 1 이상의 정수여야 합니다.`;
    if (len > 4000) return `${base} 길이는 4000 이하여야 합니다.`;
  }
  if (base === "DECIMAL") {
    const p = toInt(spec.precision);
    const s = toInt(spec.scale);
    if (!Number.isFinite(p) || p < 0 || p > 38) return "DECIMAL precision은 0~38 이어야 합니다.";
    if (!Number.isFinite(s) || s < 0 || s > p) return "DECIMAL scale은 0 이상이고 precision 이하여야 합니다.";
  }
  return "";
}
