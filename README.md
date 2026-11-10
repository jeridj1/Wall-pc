# Wall-PC

A local companion bridge for ChatGPT-assisted computer and hardware work.

## Initial design

Wall-PC starts with a small Python agent on the computer and a Chromium browser extension that watches the active ChatGPT page for explicit Wall-PC command blocks.

The local agent listens on loopback only (127.0.0.1), authenticates requests with a locally generated token, queues commands for local approval, executes approved commands with a timeout, and captures stdout/stderr.

The browser extension watches assistant messages for explicit wallpc JSON blocks, submits recognized commands to the local agent, and displays completed output with an Insert result action. It does not silently send messages.

## Security model

This is deliberately an approval-first prototype. A command in chat is not executed merely because it exists. The local dashboard requires an explicit approval click. The agent binds only to localhost, uses a random token, and imposes a command timeout. Do not expose its port to your LAN or the internet.

This is a bridge, not an OpenAI API client. It uses the signed-in ChatGPT web page and does not require an API key.

## Requirements

- Python 3.10+
- Chromium-based browser (Chrome, Chromium, Edge, Brave)
- ChatGPT opened in that browser

## Install the local agent

Linux/macOS:
    python3 wallpc_agent.py

Windows:
    py wallpc_agent.py

On first run, the agent creates a config file in the user's configuration directory and prints the access token. Keep it private.

Open http://127.0.0.1:8765 in the same computer's browser. Paste the token into the dashboard.

## Install the browser extension

1. Open chrome://extensions.
2. Enable Developer mode.
3. Choose Load unpacked and select the extension directory.
4. Open the extension popup and paste the local agent token.
5. Open or refresh ChatGPT.

## Command format

Only assistant messages containing a fenced wallpc JSON block are recognized:

    {
      "id": "example-001",
      "title": "Show current directory",
      "command": "pwd"
    }

The command is queued locally. Review it at the dashboard and approve it there. After execution, the extension offers the result for insertion into the ChatGPT composer. You decide whether to send it.

## Current scope

This first milestone targets Linux and Windows through Python, with macOS compatibility where the shell command is available. The browser extension is Chromium-based. Android support is a later client, not a claim that desktop extensions work on Android.

Hardware programming, serial/USB diagnostics, GPIO, network-device integrations, voice satellites, and optional platform clients are planned as modular capabilities. They are not silently enabled by this initial bridge.

## Project status

Early prototype. Review commands before approval. Never approve commands you do not understand, especially commands involving deletion, credentials, network changes, firmware flashing, or elevated privileges.
