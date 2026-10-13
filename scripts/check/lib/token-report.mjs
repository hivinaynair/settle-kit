const PALETTE =
  "red|blue|green|yellow|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone|white|black";

const UTILITY =
  "bg|text|border|ring|outline|from|via|to|fill|stroke|decoration|accent|caret|divide|shadow";

const RAW_PALETTE = new RegExp(
  `(?:^|[\\s"'\\\`])(?:[\\w-]+:)*(?:${UTILITY})-(?:${PALETTE})(?:-\\d{2,3})?(?=$|[\\s"'\\\`/])`,
);

const RAW_ARBITRARY =
  /(?:bg|text|border|ring|from|via|to)-\[(?:#|rgb\(|hsl\(|oklch\((?!from_var))/i;

export function rawTokenHits(source) {
  const hits = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (RAW_PALETTE.test(line) || RAW_ARBITRARY.test(line)) {
      hits.push({ line: i + 1, text: line.trim() });
    }
    RAW_PALETTE.lastIndex = 0;
    RAW_ARBITRARY.lastIndex = 0;
  }
  return hits;
}

export function isTokenSourcePath(path) {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.endsWith("globals.css")) return false;
  if (/\.(test|spec)\./.test(normalized)) return false;
  if (/(?:^|\/)apps\/[^/]+\/src\//.test(normalized)) return true;
  return /(?:^|\/)apps\/[^/]+\/(?:app|features|components|lib|server)\//.test(normalized);
}
