import { loadWidgetConfig, createWidgetScript } from "/full-view/widget-config.js";

try {
  const config = await loadWidgetConfig();
  document.body.appendChild(createWidgetScript(config, showError));
} catch {
  showError();
}

function showError() {
  if (document.getElementById("widget-error")) return;
  const notice = document.createElement("p");
  notice.id = "widget-error";
  notice.setAttribute("role", "status");
  notice.textContent = "Live chat is currently unavailable. Please try again later.";
  document.body.appendChild(notice);
}
