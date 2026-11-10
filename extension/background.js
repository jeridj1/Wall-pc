const API = "http://127.0.0.1:8765";
async function settings() {
  return await chrome.storage.local.get({ token: "", enabled: true });
}
async function api(path, method = "GET", body) {
  const { token } = await settings();
  if (!token) throw new Error("Set the local agent token in the Wall-PC extension popup.");
  const response = await fetch(API + path, {
    method,
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
  return data;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WALLPC_SUBMIT") {
    (async () => {
      const s = await settings();
      if (!s.enabled) throw new Error("Wall-PC bridge is disabled.");
      const result = await api("/api/commands", "POST", {
        title: message.title || "ChatGPT command",
        command: message.command
      });
      sendResponse({ ok: true, job: result.job });
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "WALLPC_GET_JOBS") {
    api("/api/jobs").then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "WALLPC_STATUS") {
    api("/api/status").then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
