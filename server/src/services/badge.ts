/**
 * Shields-style SVG badge: "RepoReady | 82/100" (Section 13). No external dependencies; the only
 * dynamic content is a number, so there is nothing repo-derived to escape.
 */
const LABEL = 'RepoReady';
const CHAR_WIDTH = 6.6; // approx. width of 11px Verdana
const PADDING = 12;

export function badgeColor(score: number | null): string {
  if (score === null) return '#9f9f9f'; // grey: not analyzed
  if (score < 50) return '#e05d44'; // red
  if (score < 75) return '#dfb317'; // amber
  if (score < 90) return '#4c1'; // green
  return '#2cbe4e'; // bright green
}

export function buildBadgeSvg(score: number | null): string {
  const value = score === null ? 'not analyzed' : `${Math.round(score)}/100`;
  const labelWidth = Math.round(LABEL.length * CHAR_WIDTH + PADDING);
  const valueWidth = Math.round(value.length * CHAR_WIDTH + PADDING);
  const width = labelWidth + valueWidth;
  const color = badgeColor(score);
  const title = `${LABEL}: ${value}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">
<title>${title}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${labelWidth}" height="20" fill="#555"/>
<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
<rect width="${width}" height="20" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${LABEL}</text>
<text x="${labelWidth / 2}" y="14">${LABEL}</text>
<text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
<text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
</g>
</svg>
`;
}
