export function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}`);
  return value.trim();
}

export function httpsUrl(env, name) {
  const url = new URL(required(env, name));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`Invalid ${name}`);
  }
  return url.href.replace(/\/+$/, "");
}

export function widgetId(env, name) {
  const value = required(env, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value.toLowerCase();
}

// Explicit allowlist: API keys and other server settings never reach the browser.
export function publicConfig(env) {
  return {
    scriptUrl: httpsUrl(env, "SLEEKFLOW_WIDGET_SCRIPT_URL"),
    companyId: widgetId(env, "SLEEKFLOW_COMPANY_ID"),
    widgetId: widgetId(env, "SLEEKFLOW_WIDGET_ID"),
    region: required(env, "SLEEKFLOW_REGION"),
    widgetApiBaseUrl: httpsUrl(env, "SLEEKFLOW_WIDGET_API_BASE_URL"),
    chatTitle: env.CHAT_TITLE?.trim() || "Live support",
    welcomeTitle: env.WELCOME_TITLE?.trim() || "Hello! Welcome",
    welcomeSubtitle: env.WELCOME_SUBTITLE?.trim() || "Live support",
    welcomeNote: env.WELCOME_NOTE?.trim() || "Chat directly with our team",
    hideAgentNames: env.HIDE_AGENT_NAMES !== "false",
  };
}
