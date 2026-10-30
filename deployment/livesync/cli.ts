// The bridge's only CLI switch is the documented boolean --reset.
export function parseArgs(args: string[], options: { boolean?: string[]; default?: Record<string, boolean> }) {
  const flags: Record<string, boolean> = { ...options.default };
  for (const arg of args) {
    if (arg === "--reset") flags.reset = true;
    else if (arg === "--no-reset") flags.reset = false;
    else throw new Error(`Unsupported bridge argument: ${arg}`);
  }
  return flags;
}
