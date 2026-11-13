const selectors = [":root", ".dark"];
const channelTokens = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground", "muted",
  "muted-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground",
  "border", "input", "ring", "success", "success-foreground", "warning", "warning-foreground",
];
const hexTokens = ["link", "action", "action-foreground"];
const tokens = [...channelTokens, ...hexTokens];
const hslChannels = /^(\d+(?:\.\d+)?)[ \t\n\r\f]+(\d+(?:\.\d+)?)%[ \t\n\r\f]+(\d+(?:\.\d+)?)%$/u;

function validColor(token, value) {
  if (hexTokens.includes(token)) return /^#[0-9a-f]{6}$/iu.test(value);
  const channels = hslChannels.exec(value);
  return channels !== null && Number(channels[1]) <= 360 &&
    Number(channels[2]) <= 100 && Number(channels[3]) <= 100;
}

export function extractCrmPalette(stylesheet) {
  const palettes = new Map(selectors.map((selector) => [selector, new Map()]));
  // Read only the exact selectors directly inside the top-level base layer.
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/gu,
    (match) => match.startsWith("/*") ? " " : "<string>");
  const blocks = [];
  for (const [, statement, brace] of css.matchAll(/([^{}]*)([{}])/gu)) {
    if (brace === "{") {
      blocks.push(statement.slice(statement.lastIndexOf(";") + 1).trim());
      continue;
    }
    const selector = blocks.pop();
    if (blocks.length !== 1 || blocks[0] !== "@layer base" || !palettes.has(selector)) continue;
    const values = palettes.get(selector);
    for (const [, token, rawValue] of statement.matchAll(/(?:^|;)\s*--([a-z-]+)\s*:\s*([^;]*)(?=;|$)/gu)) {
      if (!tokens.includes(token)) continue;
      const value = rawValue.trim();
      if (values.has(token)) throw new Error(`Duplicate CRM palette token ${selector} --${token}`);
      if (!validColor(token, value)) throw new Error(`Invalid CRM palette token ${selector} --${token}`);
      values.set(token, value);
    }
  }

  return selectors.map((selector) => {
    const values = palettes.get(selector);
    const declarations = tokens.map((token) => {
      if (!values.has(token)) throw new Error(`Missing CRM palette token ${selector} --${token}`);
      return `  --${token}: ${values.get(token)};`;
    });
    return `${selector} {\n${declarations.join("\n")}\n}\n`;
  }).join("\n");
}
