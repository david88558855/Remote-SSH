---
description: Connect to a remote SSH server. Usage: /ssh <hostname> or /ssh local to return.
allowed-tools: Bash(node "{{INSTALL_DIR}}/remote.mjs":*)
---

## Your task

The user typed `/ssh <hostname>`. Their exact message is: $ARGUMENTS

Extract the hostname from the arguments. Then:

1. If no hostname is given, list available hosts:
   ```
   node "{{INSTALL_DIR}}/remote.mjs" list
   ```

2. If a hostname is given, set it as the active remote:
   ```
   node "{{INSTALL_DIR}}/remote.mjs" state <hostname>
   ```

3. After setting the host, tell the user what happened:
   - If hostname is "local": "✅ Switched to local mode."
   - Otherwise: "✅ Now connected to **<hostname>**. All subsequent commands in this session will run on this server."

The `remote.mjs` script will save the state to `.remote-state.json` in the install directory. The skill `remote-server` will handle routing further operations to this host.
