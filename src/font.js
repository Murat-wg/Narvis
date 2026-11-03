export function fontString(style) {
  const parts = [];
  const weight = style.fontWeight ?? 400;
  if (style.fontStyle && style.fontStyle !== 'normal') parts.push(style.fontStyle);
  parts.push(String(weight));
  parts.push(`${style.fontSize ?? 16}px`);
  parts.push(style.fontFamily || 'sans-serif');
  return parts.join(' ');
}
