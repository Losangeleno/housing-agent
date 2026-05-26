export function requireEnvVars(names, context = "runtime") {
  const missing = names.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) {
    throw new Error(`[${context}] Missing required environment variable(s): ${missing.join(", ")}`);
  }
}

