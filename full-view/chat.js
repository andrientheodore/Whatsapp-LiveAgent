(() => {
  "use strict";
  const frame = document.getElementById("chat-frame");
  const card = document.querySelector(".chat-card");
  const loading = document.getElementById("loading");
  const message = document.getElementById("loading-message");
  const retry = document.getElementById("retry");
  let timer;

  function showError() {
    loading.classList.add("failed");
    message.textContent = "We couldn’t load your conversation. Please try again.";
    retry.hidden = false;
  }
  function startTimer() { timer = setTimeout(showError, 30000); }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === "full-view-ready") {
      clearTimeout(timer);
      card.classList.add("ready");
      loading.hidden = true;
    } else if (event.data?.type === "full-view-error") {
      clearTimeout(timer);
      showError();
    }
  });
  retry.addEventListener("click", () => {
    clearTimeout(timer);
    loading.classList.remove("failed");
    message.textContent = "Loading your conversation…";
    retry.hidden = true;
    frame.src = frame.src;
    startTimer();
  });
  const sessionUrl = new URL("/full-view/session.html", window.location.origin);
  const params = new URLSearchParams(window.location.search);
  for (const name of ["contact_id", "conversation_id"]) {
    const value = params.get(name);
    if (value) sessionUrl.searchParams.set(name, value);
  }
  frame.src = sessionUrl.href;
  startTimer();
})();
