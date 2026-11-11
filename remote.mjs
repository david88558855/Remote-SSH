#!/usr/bin/env node
/**
 * remote-ssh — SSH 远程执行引擎
 *
 * 认证方式（按 ~/.ssh/config 与 password.xlsx 确定性判定，不做自动探测）：
 *   - key      → Host 配置了 IdentityFile → 走原生 ssh 命令
 *                （自动处理 ProxyJump/ProxyCommand/IdentityFile 等）
 *   - password → 无 IdentityFile，password.xlsx 中有该 Host 的密码 → 走 ssh2 库
 *   - none     → 无 IdentityFile，password.xlsx 中也无密码记录 → 走 ssh2 库，
 *                仅凭用户名发起 "none" 认证（适用于免密/白名单认证的服务器）
 *
 * PATH：无默认值。Host 的 RemotePath > SSH_REMOTE_PATH 环境变量 > 不加前缀
 *   （用 sshd 默认 PATH）。配置后命令前注入 export PATH=...，不加载 profile。
 *   值含 $PATH 时双引号注入由远端展开（追加模式）。
 *
 * 用法：
 *   node remote.mjs list                                  列出所有主机
 *   node remote.mjs state [<host>]                        读取/设置当前活动主机
 *   node remote.mjs exec <host> <command>                 在远程执行命令
 *   node remote.mjs pipe <host> <command> [content]       通过 stdin 管道执行
 *   node remote.mjs test <host>                           快速连通性测试
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

// ─── 显式 PATH 注入（无默认值，没配就不加前缀）──────────────────────
// 取值优先级：Host 的 RemotePath > 环境变量 SSH_REMOTE_PATH > 不加前缀
// 值含 $PATH 时用双引号注入（远端 shell 展开，实现追加）；否则单引号安全包裹
function pathPrefix(entry) {
  const v = (entry.config.remotepath || process.env.SSH_REMOTE_PATH || "").trim();
  if (!v) return "";
  if (v.includes("$PATH")) return `export PATH="${v}" && `;
  return `export PATH='${v.replace(/'/g, `'\\''`)}' && `;
}

// 远端 command not found（exit 127）时的报错指引
const PATH_HINT =
  `若该主机命令装在特殊路径，请在其 ~/.ssh/config 的 Host 段配置 ` +
  `RemotePath /你的目录:/另一个目录，或设置环境变量 SSH_REMOTE_PATH。`;

// ─── Parse SSH config ───────────────────────────────────────────────
// 支持 Host 多别名；`Host *` 段作为默认值合并进每个主机（主机自身配置优先）
function parseSSHConfig(path) {
  if (!existsSync(path)) die(`SSH config not found: ${path}`);
  const text = readFileSync(path, "utf-8");
  const hosts = [], lines = text.split("\n");
  const defaults = {};
  let current = null;   // { aliases: [], config: {} }
  let inWildcard = false;

  const flush = () => {
    if (!current) return;
    for (const alias of current.aliases) {
      hosts.push({ host: alias, config: { ...defaults, ...current.config } });
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (/^Host\s+/i.test(line)) {
      flush();
      inWildcard = false;
      const aliases = line.replace(/^Host\s+/i, "").trim().split(/\s+/).filter(Boolean);
      if (aliases.length === 1 && aliases[0] === "*") {
        inWildcard = true;   // 后续行进 defaults
        continue;
      }
      const real = aliases.filter(a => a !== "*");
      if (real.length) current = { aliases: real, config: {} };
      continue;
    }
    const m = line.match(/^\s*(\S+)\s+(.+)/);
    if (!m) continue;
    if (inWildcard) {
      defaults[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    if (!current) continue;
    current.config[m[1].toLowerCase()] = m[2].trim();
  }
  flush();
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
        // 跳过表头行（host | password），避免主机别名恰为 "host" 时误匹配
        if (h && p && h.toLowerCase() !== "host") pwMap[h] = p;
      }
    }
  }
  return pwMap;
}

// ─── Resolve host ───────────────────────────────────────────────────
function resolveHost(hosts, alias) {
  const entry = hosts.find(h => h.host === alias);
  if (!entry) die(`主机 "${alias}" 不存在。可用主机：${hosts.map(h => h.host).filter(Boolean).join(", ")}`);
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
// ssh2 执行：password 认证与 none 认证共用
//   从解析后的 config 读取 HostName/Port/User；password 认证时额外传密码，
//   none 认证时仅传用户名（ssh2 会尝试 "none" 认证方法）
// ═══════════════════════════════════════════════════════════════════════
function sshExecSSH2(entry, password, command, stdinContent = null) {
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

    const connectOpts = {
      host: hostname,
      port,
      username,
      readyTimeout: 15000
    };
    if (password) connectOpts.password = password;

    conn.connect(connectOpts);
  });
}

// none 认证失败的提示信息
function noneAuthHint(alias) {
  return `主机 "${alias}" 无 IdentityFile 且 password.xlsx 中无密码记录，` +
    `已按 none 方式（仅用户名）认证。若服务器要求密码或密钥，` +
    `请补充 IdentityFile 或在 password.xlsx 中添加该主机的密码。`;
}

// ─── 执行（按规则选择 key / password / none） ────────────────────────
async function execRemote(hostAlias, command) {
  const entry = resolveHost(hosts, hostAlias);

  if (hasIdentityFile(entry)) {
    return sshExecKey(entry, pathPrefix(entry) + command);
  }

  const pw = passwords[hostAlias];
  const result = await sshExecSSH2(entry, pw || undefined, pathPrefix(entry) + command).catch(e => {
    const hint = pw ? "" : noneAuthHint(hostAlias) + "\n";
    die(`${hint}连接失败：${e.message || e}`);
  });
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.code === 127) log(`远端提示：command not found。${PATH_HINT}`);
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
      console.log("可用 SSH 主机：\n");
      for (const h of hosts) {
        const hasKey = hasIdentityFile(h);
        const hasPw = !!passwords[h.host];
        const auth = hasKey ? "key" : hasPw ? "password" : "none";
        const u = h.config.user || "?";
        const h2 = h.config.hostname || "?";
        const p = h.config.port || "22";
        const pathTag = h.config.remotepath ? "  [path]" : "";
        console.log(`  ${h.host.padEnd(20)} → ${u}@${h2}:${p}  [${auth}]${pathTag}`);
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
      } else if (target === "local") {
        writeFileSync(STATE_FILE, JSON.stringify({ host: "local", since: new Date().toISOString() }, null, 2));
        log("已切换到本地模式");
        console.log(JSON.stringify(JSON.parse(readFileSync(STATE_FILE, "utf-8"))));
      } else {
        resolveHost(hosts, target);
        writeFileSync(STATE_FILE, JSON.stringify({ host: target, since: new Date().toISOString() }, null, 2));
        log(`已切换到：${target}`);
        console.log(JSON.stringify(JSON.parse(readFileSync(STATE_FILE, "utf-8"))));
      }
      break;
    }

    case "exec": {
      const hostAlias = process.argv[3];
      const command = process.argv.slice(4).join(" ");
      if (!hostAlias || !command) die("用法：remote.mjs exec <host> <command>");

      try {
        const out = await execRemote(hostAlias, command);
        if (out) process.stdout.write(out);
      } catch (e) {
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        if (e.status === 127) log(`远端提示：command not found。${PATH_HINT}`);
        process.exit(e.status || 1);
      }
      break;
    }

    // ── pipe: pipe stdin content to remote command ─────────────
    // 用法：echo "内容" | node remote.mjs pipe <host> "cat > /path/file"
    case "pipe": {
      const hostAlias = process.argv[3];
      const command = process.argv.slice(4).join(" ");
      if (!hostAlias || !command) die("用法：remote.mjs pipe <host> <command>");

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
          const fullCmd = pathPrefix(entry) + `echo "${b64}" | base64 -d | ${command}`;
          const out = sshExecKey(entry, fullCmd);
          if (out) process.stdout.write(out);
        } else {
          const pw = passwords[hostAlias];
          const result = await sshExecSSH2(entry, pw || undefined, pathPrefix(entry) + command, stdinContent).catch(e => {
            const hint = pw ? "" : noneAuthHint(hostAlias) + "\n";
            die(`${hint}连接失败：${e.message || e}`);
          });
          if (result.stdout) process.stdout.write(result.stdout);
          if (result.stderr) process.stderr.write(result.stderr);
          if (result.code === 127) log(`远端提示：command not found。${PATH_HINT}`);
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
      if (!hostAlias) die("用法：remote.mjs test <host>");

      const entry = resolveHost(hosts, hostAlias);
      log(`正在测试 ${hostAlias}...`);

      try {
        if (hasIdentityFile(entry)) {
          process.stdout.write(sshExecKey(entry, pathPrefix(entry) + "echo OK && uname -a && pwd"));
        } else {
          const pw = passwords[hostAlias];
          const r = await sshExecSSH2(entry, pw || undefined, pathPrefix(entry) + "echo OK && uname -a && pwd").catch(e => {
            const hint = pw ? "" : noneAuthHint(hostAlias) + "\n";
            die(`${hint}连接失败：${e.message || e}`);
          });
          process.stdout.write(r.stdout);
          if (r.stderr) process.stderr.write(r.stderr);
        }
        log("连接成功！");
      } catch (e) {
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        log(`连接失败：${e.message || e}`);
        process.exit(1);
      }
      break;
    }

    default:
      die(`未知命令：${cmd}\n用法：remote.mjs <list|state|exec|pipe|test>`);
  }
}

main().catch(e => {
  process.stderr.write(`[remote] FATAL: ${e.message || e}\n`);
  process.exit(1);
});
