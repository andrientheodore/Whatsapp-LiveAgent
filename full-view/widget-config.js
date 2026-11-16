export async function loadWidgetConfig() {
  const response = await fetch("/api/config", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Live chat configuration is unavailable.");
  return response.json();
}

export function createWidgetScript(config, onError) {
  const script = document.createElement("script");
  script.src = config.scriptUrl;
  script.type = "module";
  script.dataset.companyid = config.companyId;
  script.dataset.location = config.region;
  script.dataset.widgetid = config.widgetId;
  script.addEventListener("error", onError);
  return script;
}
