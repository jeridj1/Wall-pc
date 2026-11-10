const $ = id => document.getElementById(id);
chrome.storage.local.get({ token: "", enabled: true }, data => {
  $("token").value = data.token;
  $("enabled").checked = data.enabled;
});
$("save").onclick = async () => {
  await chrome.storage.local.set({ token: $("token").value.trim(), enabled: $("enabled").checked });
  $("status").textContent = "Settings saved.";
};
$("test").onclick = async () => {
  const token = $("token").value.trim();
  if (!token) { $("status").textContent = "Paste the token first."; return; }
  try {
    const r = await fetch("http://127.0.0.1:8765/api/status", {
      headers: { "Authorization": "Bearer " + token }
    });
    const d = await r.json();
    $("status").textContent = r.ok ? "Connected · " + d.platform : (d.error || "Connection failed");
  } catch (e) { $("status").textContent = "Cannot reach local agent: " + e.message; }
};
