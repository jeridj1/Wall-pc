# Wall-PC command protocol

The first prototype recognizes only assistant messages containing a fenced code block whose language tag is exactly wallpc.

Example:

    ```wallpc
    {
      "id": "unique-command-id",
      "title": "List USB devices",
      "command": "lsusb"
    }
    ```

Required field:
- command: a non-empty shell command string, maximum 8,000 characters.

Optional fields:
- id: a stable identifier used to avoid duplicate submissions within the current page session.
- title: short human-readable description.

The local agent starts disarmed. A standalone user message reading "activate wall computer" arms it; "deactivate wall computer" disarms it. These phrases are recognized when the browser extension observes newly added user messages, not by scanning old history.

The extension submits the command to the local agent only while armed. The agent queues it as pending. A person reviews the exact command and approves it in the local dashboard. The agent then executes it as the logged-in user, not as root or Administrator, with a 60-second timeout.

The result is displayed in the ChatGPT page. The extension can insert it into the composer, but does not press Send.

Do not put passwords, API keys, private keys, or other secrets in command text or results. Do not expose the local agent port outside loopback.
