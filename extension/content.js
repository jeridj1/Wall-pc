(() => {
  if (window.__wallpcInstalled) return;
  window.__wallpcInstalled = true;
  const seen = new Set();
  const marker = /```wallpc\s*([\s\S]*?)```/g;
  let panel;

  function show(message) {
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "wallpc-bridge-panel";
      Object.assign(panel.style, {
        position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647",
        width: "min(360px, calc(100vw - 32px))", maxHeight: "45vh", overflow: "auto",
        background: "#172033", color: "#fff", padding: "12px", borderRadius: "10px",
        boxShadow: "0 5px 28px #0008", font: "13px system-ui"
      });
      document.documentElement.appendChild(panel);
    }
    const item = document.createElement("div");
    item.style.cssText = "border-top:1px solid #45516a;padding:8px 0;white-space:pre-wrap;overflow-wrap:anywhere";
    item.textContent = message;
    panel.prepend(item);
    while (panel.children.length > 8) panel.lastChild.remove();
  }

  function inspect(root) {
    const text = root.innerText || "";
    marker.lastIndex = 0;
    let match;
    while ((match = marker.exec(text))) {
      let payload;
      try { payload = JSON.parse(match[1]); } catch { continue; }
      if (!payload || typeof payload.command !== "string" || !payload.command.trim()) continue;
      const fingerprint = payload.id || (payload.title + "\n" + payload.command);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      chrome.runtime.sendMessage({
        type: "WALLPC_SUBMIT",
        title: typeof payload.title === "string" ? payload.title : "ChatGPT command",
        command: payload.command
      }, response => {
        if (chrome.runtime.lastError) show("Bridge error: " + chrome.runtime.lastError.message);
        else if (response?.ok) show("Queued for local approval: " + (payload.title || "Wall-PC command") +
          "\nJob: " + response.job.id + "\nReview it at http://127.0.0.1:8765");
        else show("Not queued: " + (response?.error || "Unknown bridge error"));
      });
    }
  }

  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node.matches?.("[data-message-author-role='assistant']")
        ? node : node.querySelector?.("[data-message-author-role='assistant']");
      if (el) inspect(el);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll("[data-message-author-role='assistant']").forEach(inspect);
  show("Wall-PC bridge loaded. Explicit wallpc command blocks are monitored.");
})();
