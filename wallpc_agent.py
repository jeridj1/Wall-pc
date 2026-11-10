#!/usr/bin/env python3
"""Wall-PC local companion agent. Python standard library only."""
from __future__ import annotations
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 8765
MAX_BODY = 32000
COMMAND_TIMEOUT = 60
MAX_COMMAND_LENGTH = 8000
LOCK = threading.RLock()
JOBS: dict[str, dict] = {}

def config_path() -> Path:
    if os.name == "nt":
        root = Path(os.environ.get("APPDATA", str(Path.home())))
    else:
        root = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    folder = root / "wallpc"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "config.json"

def load_config() -> dict:
    path = config_path()
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data.get("token"), str) and len(data["token"]) >= 32:
                return data
        except Exception:
            pass
    data = {"token": secrets.token_urlsafe(36)}
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return data

CONFIG = load_config()
TOKEN = CONFIG["token"]

def safe_job_view(job: dict) -> dict:
    return {k: v for k, v in job.items() if k != "command"}

class Handler(BaseHTTPRequestHandler):
    server_version = "WallPC/0.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("[wallpc] " + (fmt % args) + "\n")

    def _json(self, code: int, data: dict):
        raw = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _authorized(self) -> bool:
        return secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN)

    def _body(self) -> dict:
        size = int(self.headers.get("Content-Length", "0"))
        if size < 1 or size > MAX_BODY:
            raise ValueError("Invalid request size")
        data = json.loads(self.rfile.read(size).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("JSON object required")
        return data

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            page = DASHBOARD.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.end_headers()
            self.wfile.write(page)
            return
        if not self._authorized():
            self._json(401, {"error": "Unauthorized"})
            return
        if path == "/api/status":
            with LOCK:
                counts = {s: sum(1 for j in JOBS.values() if j["status"] == s)
                          for s in ("pending", "approved", "running", "complete", "failed")}
            self._json(200, {"ok": True, "platform": sys.platform, "jobs": counts})
            return
        if path == "/api/jobs":
            with LOCK:
                jobs = [safe_job_view(j) for j in sorted(JOBS.values(), key=lambda x: x["created"], reverse=True)]
            self._json(200, {"jobs": jobs})
            return
        if path.startswith("/api/jobs/"):
            job_id = path.rsplit("/", 1)[-1]
            with LOCK:
                job = JOBS.get(job_id)
                if job:
                    self._json(200, {"job": safe_job_view(job)})
                else:
                    self._json(404, {"error": "Unknown job"})
            return
        self._json(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if not self._authorized():
            self._json(401, {"error": "Unauthorized"})
            return
        try:
            data = self._body()
        except Exception as exc:
            self._json(400, {"error": str(exc)})
            return

        if path == "/api/commands":
            command = data.get("command")
            title = data.get("title", "ChatGPT requested command")
            if not isinstance(command, str) or not command.strip() or len(command) > MAX_COMMAND_LENGTH:
                self._json(400, {"error": "A non-empty command under 8000 characters is required"})
                return
            if not isinstance(title, str):
                title = "ChatGPT requested command"
            job_id = str(uuid.uuid4())
            job = {"id": job_id, "title": title[:160], "command": command,
                   "status": "pending", "created": time.time(), "result": None, "returncode": None}
            with LOCK:
                JOBS[job_id] = job
            self._json(202, {"job": safe_job_view(job)})
            return

        if path.startswith("/api/jobs/") and path.endswith("/approve"):
            job_id = path.split("/")[-2]
            with LOCK:
                job = JOBS.get(job_id)
                if not job:
                    self._json(404, {"error": "Unknown job"})
                    return
                if job["status"] != "pending":
                    self._json(409, {"error": "Job is not pending"})
                    return
                job["status"] = "approved"
            threading.Thread(target=run_job, args=(job_id,), daemon=True).start()
            self._json(200, {"ok": True, "job_id": job_id})
            return
        self._json(404, {"error": "Not found"})

def run_job(job_id: str):
    with LOCK:
        job = JOBS.get(job_id)
        if not job or job["status"] != "approved":
            return
        job["status"] = "running"
        command = job["command"]
    try:
        completed = subprocess.run(command, shell=True, cwd=str(Path.home()),
                                   capture_output=True, text=True, timeout=COMMAND_TIMEOUT,
                                   errors="replace", env=os.environ.copy())
        output = completed.stdout or ""
        if completed.stderr:
            output += ("\n" if output else "") + "[stderr]\n" + completed.stderr
        if not output:
            output = "(no output)"
        with LOCK:
            job["result"] = output[-24000:]
            job["returncode"] = completed.returncode
            job["status"] = "complete" if completed.returncode == 0 else "failed"
    except subprocess.TimeoutExpired as exc:
        out, err = exc.stdout or b"", exc.stderr or b""
        if isinstance(out, bytes): out = out.decode(errors="replace")
        if isinstance(err, bytes): err = err.decode(errors="replace")
        with LOCK:
            job["result"] = (str(out) + "\n" + str(err) + "\n[Timed out after 60 seconds]")[-24000:]
            job["status"] = "failed"
    except Exception as exc:
        with LOCK:
            job["result"] = f"{type(exc).__name__}: {exc}"
            job["status"] = "failed"

DASHBOARD = r"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wall-PC Local Dashboard</title>
<style>
body{font:15px system-ui;background:#111827;color:#e5e7eb;max-width:980px;margin:30px auto;padding:0 16px}
h1{margin-bottom:4px}small,.muted{color:#9ca3af}.panel{background:#1f2937;padding:16px;border-radius:12px;margin:16px 0}
input,button{font:inherit;padding:10px;border-radius:7px;border:1px solid #4b5563}
input{background:#111827;color:#fff;width:min(560px,90%)}
button{cursor:pointer;background:#2563eb;color:white;border:0;margin:4px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b1020;padding:12px;border-radius:8px}
.job{border-top:1px solid #374151;padding:14px 0}
</style></head><body>
<h1>Wall-PC</h1><div class="muted">Local command bridge · approval required</div>
<div class="panel"><label>Local access token<br><input id="token" type="password" autocomplete="off" placeholder="Paste token printed by wallpc_agent.py"></label>
<button id="save">Save token</button><button id="refresh">Refresh</button><p id="status" class="muted">Not connected</p></div>
<div id="jobs" class="panel">Enter your token to load the queue.</div>
<script>
const $=id=>document.getElementById(id);
let token=localStorage.getItem("wallpc_token")||"";$("token").value=token;
async function api(path,method="GET",body){let r=await fetch(path,{method,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});let j=await r.json();if(!r.ok)throw Error(j.error||r.status);return j}
$("save").onclick=()=>{token=$("token").value.trim();localStorage.setItem("wallpc_token",token);refresh()};
$("refresh").onclick=refresh;
async function refresh(){if(!token){$("status").textContent="Paste the local token.";return}
try{let s=await api("/api/status"),d=await api("/api/jobs");$("status").textContent="Connected · "+s.platform+" · "+JSON.stringify(s.jobs);
$("jobs").innerHTML=d.jobs.length?"":"No commands queued.";
for(let j of d.jobs){let el=document.createElement("section");el.className="job";
let h=document.createElement("h3");h.textContent=j.title+" · "+j.status;el.append(h);
let id=document.createElement("small");id.textContent=j.id;el.append(id);
if(j.status==="pending"){let p=document.createElement("pre");p.textContent="Command is queued. Approval runs the submitted command exactly as supplied.";el.append(p);
let b=document.createElement("button");b.textContent="Approve and execute";b.onclick=async()=>{if(confirm("Execute this command on this computer?")){await api("/api/jobs/"+j.id+"/approve","POST",{});refresh()}};el.append(b)}
if(j.result){let p=document.createElement("pre");p.textContent=j.result;el.append(p)}
$("jobs").append(el)}
}catch(e){$("status").textContent="Connection error: "+e.message}}
setInterval(refresh,3000);refresh();
</script></body></html>"""

if __name__ == "__main__":
    print("Wall-PC local agent")
    print("Token: " + TOKEN)
    print("Keep this token private. It grants local command-queue access.")
    print("Dashboard: http://127.0.0.1:" + str(PORT))
    print("Listening on 127.0.0.1 only. Ctrl+C to stop.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
