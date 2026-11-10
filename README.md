# Claude Remote SSH

A skill that lets you route all operations (file reads, writes, bash commands) to a remote Linux server via SSH — so Claude runs directly on your remote machines instead of locally.

## How It Works

```
You  →  /ssh myserver    →   sets remote host in state file
You  →  cat /etc/hostname →   Claude runs: remote.mjs exec myserver "cat /etc/hostname"
You  →  nvidia-smi        →   Claude runs: remote.mjs exec myserver "nvidia-smi"
You  →  /ssh local        →   back to local
```

Once you `/ssh <host>` in a session, all subsequent operations automatically route to that server. You don't need to re-type it every turn.

## Architecture

```
repo/
├── remote.mjs                 ← Core execution engine
├── package.json               ← npm deps (ssh2, xlsx)
├── ssh.md                     ← /ssh command definition
├── skills/remote-server/SKILL.md  ← Skill: routes tools to remote
├── SSH_CONFIG.example         ← Example SSH config template
└── PASSWORD_FILE.example.xlsx ← Example password file template
```

- **Key-based hosts** → uses the native `ssh` command (handles ProxyJump, ProxyCommand, IdentityFile, ForwardAgent, etc. automatically)
- **Password-based hosts** → uses Node.js `ssh2` library with password from your xlsx file

## Installation

### 1. Clone this repo

```bash
git clone https://github.com/doulujiyao12/claude_remote_ssh.git
cd remote_ssh
```

### 2. Install dependencies

```bash
npm install
```

### 3. Install the command + skill

Copy these into your config directory:

```bash
cp ssh.md ~/.tclaude/commands/ssh.md        # (or ~/.claude/commands/ssh.md)
cp -r skills/remote-server ~/.tclaude/skills/    # (or ~/.claude/skills/)
```

Restart  after installing.

### 4. Configure your SSH hosts (MANDATORY)

This skill reads your existing `~/.ssh/config` for host definitions. Make sure it exists and has the hosts you need.

If you don't have one yet, copy the example:

```bash
cp SSH_CONFIG.example ~/.ssh/config
# Then edit ~/.ssh/config with your real servers
```

### 5. Configure passwords (if needed)

Any host listed in `~/.ssh/config` that does NOT have an `IdentityFile` needs a password in `password.xlsx`.

Copy the example:

```bash
cp PASSWORD_FILE.example.xlsx password.xlsx
# Edit password.xlsx: column A = host alias, column B = password
```

> **⚠️ Never commit your `password.xlsx` to git!** It's already in `.gitignore`.

### 6. Update paths in the files

The file `skills/remote-server/SKILL.md` and `ssh.md` contain hardcoded paths to `remote.mjs` and `.remote-state.json`. Update them to match where you cloned this repo:

- Search for `C:\Users\dahufeng\Desktop\tclaude\ssh` in both files
- Replace with your actual clone path

## Usage

```
/ssh myserver      → Connect to a host (listed in your ~/.ssh/config)
/ssh local         → Switch back to local mode

# All subsequent operations run on the remote server:
> cat /etc/os-release       # reads remote file
> ls -la /home/user/        # lists remote directory  
> nvidia-smi                 # runs on remote
```

To see all available hosts, ask Claude: "list available SSH hosts"

## Requirements

- Node.js (for `remote.mjs`)
- OpenSSH client (`ssh` command available in terminal)
- `~/.ssh/config` — your SSH host definitions
- `password.xlsx` — (optional) passwords for hosts without key authentication

## Security

- **Never commit `password.xlsx` or your private keys.** Both are gitignored.
- The script uses `StrictHostKeyChecking=accept-new` for convenience; adjust in `remote.mjs` if you need stricter policies.
- All connections use your existing `~/.ssh/config` identity files — no keys are stored in this repo.

## License

MIT
