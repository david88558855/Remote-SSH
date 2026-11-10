---
name: remote-server
description: SSH remote server execution — route all file operations and commands to a remote Linux server. Use this whenever the user mentions SSH, remote servers, connecting to a host, or running commands on another machine. Also use this when the user types /ssh followed by a hostname. This skill must be used when the user wants to work on a remote server instead of locally.
---

# Remote Server Skill

Route tclaude/Claude Code operations to a remote Linux server via SSH. All file reads, writes, and command execution happen on the remote machine — not locally.

## Core Script

This skill relies on a Node.js script located at:

```
{{INSTALL_DIR}}/remote.mjs
```

**IMPORTANT:** Before using this skill, run `npm install` in `{{INSTALL_DIR}}` to install dependencies (`ssh2`, `xlsx`).

**ALSO IMPORTANT:** You must have a working `~/.ssh/config` with your host definitions. For password-based hosts (no IdentityFile), create a `password.xlsx` in `{{INSTALL_DIR}}` with two columns: host alias and password.

Available subcommands:

| Command | Purpose |
|---------|---------|
| `list` | Show all SSH hosts (from `~/.ssh/config`) |
| `state [<host>]` | Read or set the active remote host |
| `exec <host> <cmd>` | Run command on remote, return stdout/stderr |
| `pipe <host> <cmd>` | Same as exec, but pipes local stdin to remote command |
| `test <host>` | Quick connectivity check |

### How it works

- **Key-based hosts** → uses the native `ssh` command which auto-reads `~/.ssh/config` (handles IdentityFile, ProxyJump, ProxyCommand, ForwardAgent, Port, User, etc.)
- **Password-based hosts** → uses Node.js `ssh2` library, reads passwords from `password.xlsx`

## State Management

The active remote host is stored in:
```
{{INSTALL_DIR}}/.remote-state.json
```

### CRITICAL: Check state at the start of EVERY turn

When you begin a turn, always check if we're in remote mode:

```bash
node "{{INSTALL_DIR}}/remote.mjs" state
```

The output is JSON: `{"host":"<name>","since":"<iso-date>"}`.

- If `host` is `"local"` → operate locally as normal.
- If `host` is anything else → ALL operations go through that remote host.
- The user does NOT need to re-run `/ssh` in the same session.

### Setting the active host

When the user runs `/ssh <host>` or asks to connect:

```bash
node "{{INSTALL_DIR}}/remote.mjs" state <host>
```

Then confirm: "✅ Connected to `<host>`. All operations now run on this server."

To switch back: `/ssh local`
```bash
node "{{INSTALL_DIR}}/remote.mjs" state local
```

To list all available hosts:
```bash
node "{{INSTALL_DIR}}/remote.mjs" list
```

## Routing Operations (when in remote mode)

Let `<HOST>` be the active remote host from the state file.

### Bash — execute commands remotely

```bash
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "<command>"
```

- Each exec starts in the remote home directory.
- Chain commands: `"cd /path && cmd1 && cmd2"`
- Multi-line commands: join with `&&` or `;`, or use a single exec call.
- For `cd` persistence, chain within one call: `"cd /target && ls && cat file"`

### Read — read remote file

```bash
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "cat /path/to/file"
```

### Write — write content to remote file

```bash
echo "content" | node "{{INSTALL_DIR}}/remote.mjs" pipe <HOST> "cat > /path/to/file"
```

For large content, use a temp file approach or pipe. The script uses base64 encoding internally so special characters are handled safely.

### Edit — modify remote file

Since there's no direct Edit for remote files, use:

1. Read the file: `exec <HOST> "cat /path/to/file"`
2. Modify the content locally (in your reasoning)
3. Write back: `echo "new content" | node ... pipe <HOST> "cat > /path/to/file"`

### Glob / Grep — use remote find + grep

```bash
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "find /path -name '*.py' -type f"
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "grep -rn 'pattern' /path"
```

### List directory

```bash
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "ls -la /path/to/dir"
```

## Rules

1. **Check state every turn** — don't assume; always verify which mode we're in.
2. **Remote paths only** — all paths refer to the remote filesystem.
3. **No interactive commands** — `vim`, `htop`, `sudo` with password prompt won't work. Use non-interactive alternatives.
4. **sudo** — only works if passwordless sudo is configured on the remote. Use like: `exec <HOST> "sudo ls /root"`
5. **Passwords** — never echo them. The script reads passwords from `password.xlsx` automatically.
6. **Connection errors** — if a host fails, suggest checking with `remote.mjs list` and `remote.mjs test <host>`.
7. **Native tools** — use `find`, `grep`, `cat`, `ls` on the remote via exec. Don't use local Glob/Grep/Read tools.
