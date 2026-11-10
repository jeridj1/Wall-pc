(() => {
  if (window.__wallpcInstalled) return;
  window.__wallpcInstalled = true;
  const seenCommands = new Set();
  const shownResults = new Set();
  const marker = /```wallpc\s*([\s\S]*?)```/g;
  let panel;

  function getPanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "wallpc-bridge-panel";
    Object.assign(panel.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647",
      width: "min(380px, calc(100vw - 32px))", maxHeight: "45vh", overflow: "auto",
      background: "#172033", color: "#fff", padding: "12px", borderRadius: "10px",
      boxShadow: "0 5px 28px #0008", font: "13px system-ui"
    });
    document.documentElement.appendChild(panel);
    return panel;
  }

  function show(message) {
    const item = document.createElement("div");
    item.style.cssText = "border-top:1px solid #45516a;padding:8px 0;white-space:pre-wrap;overflow-wrap:anywhere";
    item.textContent = message;
    getPanel().prepend(item);
    while (panel.children.length > 10) panel.lastChild.remove();
  }

  function insertResult(job) {
    const text = "Wall-PC result for " + job.title + " (exit " + job.returncode + "):\n\n" + (job.result || "(no output)");
    const button = document.createElement("button");
    button.textContent = "Insert result into ChatGPT";
    button.style.cssText = "display:block;margin-top:8px;padding:7px 10px;border:0;border-radius:6px;background:#2563eb;color:white;cursor:pointer";
    button.addEventListener("click", () => {
      const editor = document.querySelector("#prompt-textarea") ||
        document.querySelector("[contenteditable='true'][data-testid*='composer']") ||
        document.querySelector("textarea");
      if (!editor) { show("Could not find the ChatGPT message composer."); return; }
      editor.focus();
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value")?.set;
        if (setter) setter.call(editor, text); else editor.value = text;
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      } else {
        editor.textContent = text;
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
      show("Result inserted. Review it and press Send when ready.");
    });
    const item = document.createElement("div");
    item.style.cssText = "border-top:1px solid #45516a;padding:8px 0";
    const title = document.createElement("div");
    title.textContent = job.title + " · " + job.status;
    const output = document.createElement("pre");
    output.textContent = (job.result || "").slice(-3000);
    output.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto;background:#0b1020;padding:8px;border-radius:6px";
    item.append(title, output, button);
    getPanel().prepend(item);
  }


  function checkActivation(root) {
    const phrase = (root.innerText || "").trim().replace(/[.!?]+$/, "").trim().toLowerCase();
    const armed = phrase === "activate wall computer";
    const disarmed = phrase === "deactivate wall computer";
    if (!armed && !disarmed) return;
    chrome.runtime.sendMessage({ type: "WALLPC_ARM", armed }, response => {
      if (chrome.runtime.lastError) show("Activation control error: " + chrome.runtime.lastError.message);
      else if (response?.ok) show(response.data.armed ? "Wall-PC ARMED. Command blocks can be queued." : "Wall-PC DISARMED. Command processing is locked.");
      else show("Activation control failed: " + (response?.error || "Unknown error"));
    });
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
      if (seenCommands.has(fingerprint)) continue;
      seenCommands.add(fingerprint);
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

  function pollJobs() {
    chrome.runtime.sendMessage({ type: "WALLPC_GET_JOBS" }, response => {
      if (!response?.ok) return;
      for (const job of response.data.jobs || []) {
        if ((job.status === "complete" || job.status === "failed") && !shownResults.has(job.id)) {
          shownResults.add(job.id);
          insertResult(job);
        }
      }
    });
  }

  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const role = node.getAttribute?.("data-message-author-role");
      const userEl = role === "user" ? node : node.querySelector?.("[data-message-author-role='user']");
      if (userEl) checkActivation(userEl);
      const assistantEl = role === "assistant" ? node : node.querySelector?.("[data-message-author-role='assistant']");
      if (assistantEl) inspect(assistantEl);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll("[data-message-author-role='assistant']").forEach(inspect);
  show("Wall-PC bridge loaded. Explicit wallpc command blocks are monitored.");
  setInterval(pollJobs, 3500);
})();
