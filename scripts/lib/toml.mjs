export function toTomlBasicString(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\u0008/g, "\\b")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\f/g, "\\f")
    .replace(/\r/g, "\\r")}"`;
}

export function replaceTomlVar(content, key, rawValue) {
  const assignment = `${key} = ${toTomlBasicString(rawValue)}`;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^${escapedKey}\\s*=\\s*'.*'$`, "m"),
    new RegExp(`^${escapedKey}\\s*=\\s*".*"$`, "m"),
  ];

  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return content.replace(pattern, assignment);
    }
  }

  if (/^\[vars\]$/m.test(content)) {
    return content.replace(/^\[vars\]$/m, `[vars]\n${assignment}`);
  }

  return `${content.trimEnd()}\n\n[vars]\n${assignment}\n`;
}
