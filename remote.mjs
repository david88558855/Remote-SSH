#!/usr/bin/env node
/**
 * tclaude-ssh-remote — Remote SSH execution engine (v2)
 *
 * Strategy:
 *   - Key-based hosts → native `ssh` command (auto-reads ~/.ssh/config,
 *     handles ProxyJump/ProxyCommand/IdentityFile etc. natively)
 *   - Password-based hosts → ssh2 library (reads password from password.xlsx)
 *
 * Usage:
 *   node remote.mjs list                                  List all hosts
 *   node remote.mjs state [<host>]                        Get/set active remote
 *   node remote.mjs exec <host> <command>                 Run on remote
 *   node remote.mjs pipe <host> <command> [content]       Run with stdin piped
 *   node remote.mjs test <host>                           Quick connectivity test
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Client } from "ssh2";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SSH_CONFIG = join(homedir(), ".ssh", "config");
const PASSWORD_FILE = join(__dirname, "password.xlsx");
const STATE_FILE = join(__dirname, "..", ".remote-state.json");

// ─── Helpers ────────────────────────────────────────────────────────
function die(msg) { process.stderr.write(`[remote] ERROR: ${msg}\n`); process.exit(1); }
function log(msg) { process.stderr.write(`[remote] ${msg}\n`); }

// ─── Parse SSH config ───────────────────────────────────────────────
function parseSSHConfig(path) {
  if (!existsSync(path)) die(`SSH config not found: ${path}`);
  const text = readFileSync(path, "utf-8");
  const hosts = [], lines = text.split("\n");
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (/^Host\s+/i.test(line)) {
      if (current && current.host) hosts.push(current);
      const alias = line.replace(/^Host\s+/i, "").trim().split(/\s+/)[0];
      current = (alias === "*") ? null : { host: alias, config: {} };
      current && (current.config._rawHost = alias);
      continue;
    }
    if (!current) continue;
    const m = line.match(/^\s*(\S+)\s+(.+)/);
    if (!m) continue;
    current.config[m[1].toLowerCase()] = m[2].trim();
  }
  if (current && current.host) hosts.push(current);
  return hosts;
}

// ─── Read password xlsx ─────────────────────────────────────────────
function readPasswords(path) {
  if (!existsSync(path)) return {};
  const wb = XLSX.readFile(path), pwMap = {};
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
    for (const row of rows) {
      if (row && row.length >= 2) {
        const h = String(row[0]).trim(), p = String(row[1]).trim();
        if (h && p) pwMap[h] = p;
      }
    }
  }
  return pwMap;
}

// ─── Resolve host ───────────────────────────────────────────────────
function resolveHost(hosts, alias) {
  const entry = hosts.find(h => h.host === alias);
  if (!entry) die(`Host "${alias}" not found. Available: ${hosts.map(h => h.host).filter(Boolean).join(", ")}`);
  return entry;
}

function hasIdentityFile(entry) {
  return !!(entry.config.identityfile);
}

// ═══════════════════════════════════════════════════════════════════════
// Key-based execution: use native `ssh` command
//   ssh automatically reads ~/.ssh/config, handling:
//   - IdentityFile, ProxyJump, ProxyCommand, ForwardAgent, Port, User, etc.
// ═══════════════════════════════════════════════════════════════════════
function sshExecKey(entry, command) {
  const host = entry.host;
  const sshArgs = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    host,
    command
  ];

  // Build ssh command string with proper quoting
  const sshCmd = `ssh ${sshArgs.map(a => `"${a}"`).join(" ")}`;
  return execSync(sshCmd, {
    encoding: "utf-8",
    timeout: 120_000,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Password-based execution: use ssh2 library
//   Reads HostName, Port, User from parsed config; password from xlsx
// ═══════════════════════════════════════════════════════════════════════
function sshExecPassword(entry, password, command, stdinContent = null) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const cfg = entry.config;
    const hostname = cfg.hostname;
    const port = parseInt(cfg.port) || 22;
    const username = cfg.user || "root";

    let stdout = "", stderr = "";

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on("data", (d) => { stdout += d.toString(); });
        stream.stderr.on("data", (d) => { stderr += d.toString(); });
        stream.on("close", (code) => {
          conn.end();
          resolve({ stdout, stderr, code });
        });
        // Write stdin content if provided
        if (stdinContent) {
          stream.write(stdinContent);
          stream.end();
        }
      });
    });

    conn.on("error", (err) => reject(err));

    conn.connect({
      host: hostname,
      port,
      username,
      password,
      readyTimeout: 15000
    });
  });
}

// ─── Execute (auto-choose key vs password) ──────────────────────────
async function execRemote(hostAlias, command) {
  const entry = resolveHost(hosts, hostAlias);

  if (hasIdentityFile(entry)) {
    return sshExecKey(entry, command);
  }

  const pw = passwords[hostAlias];
  if (!pw) die(`No password for "${hostAlias}". Add it to password.xlsx.`);
  const result = await sshExecPassword(entry, pw, command);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.code !== 0) process.exitCode = result.code;
  return "";
}

// ─── Main dispatcher ────────────────────────────────────────────────
const cmd = process.argv[2];
const hosts = parseSSHConfig(SSH_CONFIG);
const passwords = readPasswords(PASSWORD_FILE);

async function main() {
  switch (cmd) {
    case "list": {
      console.log("Available SSH hosts:\n");
      for (const h of hosts) {
        const hasKey = hasIdentityFile(h);
        const hasPw = !!passwords[h.host];
        const auth = hasKey ? "key" : hasPw ? "password" : "NO_AUTH";
        const u = h.config.user || "?";
        const h2 = h.config.hostname || "?";
        const p = h.config.port || "22";
        console.log(`  ${h.host.padEnd(20)} → ${u}@${h2}:${p}  [${auth}]`);
      }
      break;
    }

    case "state": {
      const target = process.argv[3];
      if (!target) {
        // Read current state
        if (existsSync(STATE_FILE)) {
          console.log(JSON.stringify(JSON.parse(readFileSync(STATE_FILE, "utf-8"))));
        } else {
          console.log(JSON.stringify({ host: "local", since: null }));
        }
      } else if (target === "local" || target === "none") {
        writeFileSync(STATE_FILE, JSON.stringify({ host: "local", since: new Date().toISOString() }, null, 2));
        log("Switched to LOCAL mode");
        console.log(JSON.stringify(JSON.parse(readFileSync(STATE_FILE, "utf-8"))));
      } else {
        resolveHost(hosts, target);
        writeFileSync(STATE_FILE, JSON.stringify({ host: target, since: new Date().toISOString() }, null, 2));
        log(`Switched to: ${target}`);
        console.log(JSON.stringify(JSON.parse(readFileSync(STATE_FILE, "utf-8"))));
      }
      break;
    }

    case "exec": {
      const hostAlias = process.argv[3];
      const command = process.argv.slice(4).join(" ");
      if (!hostAlias || !command) die("Usage: remote.mjs exec <host> <command>");

      try {
        const out = await execRemote(hostAlias, command);
        if (out) process.stdout.write(out);
      } catch (e) {
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        process.exit(e.status || 1);
      }
      break;
    }

    // ── pipe: pipe stdin content to remote command ─────────────
    // Usage: echo "content" | node remote.mjs pipe <host> "cat > /path/file"
    case "pipe": {
      const hostAlias = process.argv[3];
      const command = process.argv.slice(4).join(" ");
      if (!hostAlias || !command) die("Usage: remote.mjs pipe <host> <command>");

      // Read all stdin first
      const chunks = [];
      process.stdin.setEncoding("utf-8");
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const stdinContent = chunks.join("");

      const entry = resolveHost(hosts, hostAlias);

      try {
        if (hasIdentityFile(entry)) {
          // Use base64 to safely pipe arbitrary content through SSH
          const b64 = Buffer.from(stdinContent, "utf-8").toString("base64");
          const fullCmd = `echo "${b64}" | base64 -d | ${command}`;
          const out = sshExecKey(entry, fullCmd);
          if (out) process.stdout.write(out);
        } else {
          const pw = passwords[hostAlias];
          if (!pw) die(`No password for "${hostAlias}". Add it to password.xlsx.`);
          const result = await sshExecPassword(entry, pw, command, stdinContent);
          if (result.stdout) process.stdout.write(result.stdout);
          if (result.stderr) process.stderr.write(result.stderr);
          if (result.code !== 0) process.exitCode = result.code;
        }
      } catch (e) {
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        process.exit(e.status || 1);
      }
      break;
    }

    case "test": {
      const hostAlias = process.argv[3];
      if (!hostAlias) die("Usage: remote.mjs test <host>");

      const entry = resolveHost(hosts, hostAlias);
      log(`Testing ${hostAlias}...`);

      try {
        if (hasIdentityFile(entry)) {
          process.stdout.write(sshExecKey(entry, "echo OK && uname -a && pwd"));
        } else {
          const pw = passwords[hostAlias];
          if (!pw) die(`No password for "${hostAlias}".`);
          const r = await sshExecPassword(entry, pw, "echo OK && uname -a && pwd");
          process.stdout.write(r.stdout);
          if (r.stderr) process.stderr.write(r.stderr);
        }
        log("Connection successful!");
      } catch (e) {
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        log(`Connection FAILED: ${e.message || e}`);
        process.exit(1);
      }
      break;
    }

    default:
      die(`Unknown command: ${cmd}\nUsage: remote.mjs <list|state|exec|pipe|test>`);
  }
}

main().catch(e => {
  process.stderr.write(`[remote] FATAL: ${e.message || e}\n`);
  process.exit(1);
});
