const GLOBAL = {
  "--json": "boolean",
  "--endpoint": "value",
  "--state-dir": "value",
  "--allow-remote": "boolean",
  "--verbose": "boolean",
  "-v": "boolean",
  "--version": "boolean",
};

export const COMMAND_OPTIONS = {
  doctor: { "--chrome": "value" },
  demo: { "--chrome": "value", "--port": "value", "--profile": "value", "--headless": "boolean", "--deterministic": "boolean", "--output": "value", "--duration": "value", "--no-screenshot": "boolean", "--title": "value", "--expected": "value", "--actual": "value" },
  launch: { "--chrome": "value", "--port": "value", "--profile": "value", "--url": "value", "--headless": "boolean", "--deterministic": "boolean" },
  capture: { "--chrome": "value", "--port": "value", "--profile": "value", "--url": "value", "--headless": "boolean", "--deterministic": "boolean", "--output": "value", "--duration": "value", "--no-screenshot": "boolean", "--title": "value", "--expected": "value", "--actual": "value" },
  connect: {},
  stop: {},
  tabs: {},
  snapshot: { "--tab": "value", "--all": "boolean" },
  click: { "--tab": "value", "--selector": "value" },
  fill: { "--tab": "value", "--selector": "value", "--stdin": "boolean" },
  press: { "--tab": "value" },
  errors: { "--tab": "value", "--clear": "boolean", "--limit": "value", "--since": "value" },
  network: { "--tab": "value", "--failed": "boolean", "--clear": "boolean", "--limit": "value", "--since": "value" },
  screenshot: { "--tab": "value", "--output": "value", "--full-page": "boolean" },
  report: { "--tab": "value", "--output": "value", "--no-screenshot": "boolean", "--title": "value", "--expected": "value", "--actual": "value" },
  verify: {},
  version: {},
};

export function commandHint(argv) {
  return argv.find((argument) => Object.hasOwn(COMMAND_OPTIONS, argument)) ?? null;
}

function usageError(message) {
  const error = new Error(message);
  error.code = "USAGE_ERROR";
  error.exitCode = 2;
  return error;
}

export function parseArgs(argv) {
  if (!argv.length) return { help: true, json: false, command: null, options: {}, positionals: [] };
  const commandIndex = argv.findIndex((arg, index) => {
    if (arg.startsWith("-")) return false;
    const previous = argv[index - 1]?.split("=")[0];
    return !previous || GLOBAL[previous] !== "value" || argv[index - 1].includes("=");
  });
  const command = commandIndex >= 0 ? argv[commandIndex] : null;
  if (command && !COMMAND_OPTIONS[command]) throw usageError(`Unknown command: ${command}`);
  const schema = { ...GLOBAL, ...(COMMAND_OPTIONS[command] ?? {}), "--help": "boolean", "-h": "boolean" };
  const options = {};
  const positionals = [];
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (index === commandIndex) continue;
    const token = argv[index];
    if (!positionalOnly && token === "--") {
      positionalOnly = true;
      continue;
    }
    if (positionalOnly || !token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    const [name, inline] = token.split(/=(.*)/s, 2);
    const kind = schema[name];
    if (!kind) throw usageError(`Unknown option for ${command ?? "bugbaton"}: ${name}`);
    const key = name.replace(/^-+/, "").replaceAll("-", "_");
    if (Object.hasOwn(options, key)) throw usageError(`Duplicate option: ${name}`);
    if (kind === "boolean") {
      if (inline !== undefined) throw usageError(`${name} does not take a value`);
      options[key] = true;
    } else {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith("-")) throw usageError(`${name} requires a value`);
      options[key] = value;
    }
  }
  return {
    command,
    options,
    positionals,
    help: Boolean(options.help || options.h || (!command && !argv.includes("--version"))),
    json: Boolean(options.json),
    topVersion: Boolean(options.version),
  };
}
