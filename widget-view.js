(() => {
  "use strict";

  function connect() {
    const root = document.getElementById("sleekflow-widget-container")?.shadowRoot;
    if (!root) return;
    documentObserver.disconnect();

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/widget-view.css";
    root.appendChild(stylesheet);

    function sync() {
      const app = root.getElementById("sleekflow-widget-app");
      if (!app) return;
      const minimize = app.querySelector('button[aria-label="Minimize chat"]');
      app.dataset.standardView = minimize ? "open" : "closed";
      if (minimize) return;

      const buttons = app.querySelectorAll("button");
      const launcher = buttons[buttons.length - 1];
      if (!launcher) return;
      launcher.dataset.standardLauncher = "";
      launcher.setAttribute("aria-label", "Open chat");
      launcher.title = "Open chat";
      for (let element = launcher.parentElement; element && element !== app; element = element.parentElement) {
        element.dataset.launcherPath = "";
      }
    }

    new MutationObserver(sync).observe(root, { childList: true, subtree: true });
    sync();
  }

  const documentObserver = new MutationObserver(connect);
  documentObserver.observe(document.body, { childList: true, subtree: true });
  connect();
})();
