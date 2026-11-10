---
name: remote-server
description: SSH 远程服务器执行技能 — 将所有文件操作和命令路由到远程 Linux 服务器。当用户提到 SSH、远程服务器、连接主机、在另一台机器上执行命令时使用本技能；用户输入 /ssh（可跟主机名）时必须触发。用户希望操作远程服务器而非本地环境时，必须使用本技能。
---

# 远程服务器技能（Remote Server）

将本地 AI 助手的文件读写、命令执行等操作全部路由到远程 Linux 服务器（通过 SSH）。所有文件读取、写入和命令执行都发生在远程机器上——而不是本地。

本技能不依赖任何特定 AI 产品的专有机制，任何具备「执行 shell 命令」能力的 AI 助手均可使用。

## 核心脚本

本技能依赖一个 Node.js 脚本，位于：

```
{{INSTALL_DIR}}/remote.mjs
```

**重要：** 使用本技能前，先在 `{{INSTALL_DIR}}` 目录运行 `npm install` 安装依赖（`ssh2`、`xlsx`）。

**同样重要：** 必须有一份可用的 `~/.ssh/config` 主机定义文件。无密钥（无 IdentityFile）的主机按下方「认证方式」一节处理。

## 认证方式（确定性判定，不做自动探测）

脚本按下表规则选择认证方式，逐条匹配、无回退：

| 优先级 | 条件 | 认证方式 | 实现途径 |
|--------|------|----------|----------|
| 1 | Host 配置了 `IdentityFile` | `key` | 原生 `ssh` 命令（自动处理 IdentityFile、ProxyJump、ProxyCommand、ForwardAgent、Port、User 等） |
| 2 | 无 `IdentityFile`，但 `password.xlsx` 中有该主机密码 | `password` | Node.js `ssh2` 库，密码读自 `password.xlsx` |
| 3 | 无 `IdentityFile`，且 `password.xlsx` 中无该主机记录 | `none` | `ssh2` 库，仅凭用户名发起 SSH "none" 认证（适用于免密登录、白名单认证的服务器） |

如果 `none` 认证被服务器拒绝，脚本会明确报错并提示补充 `IdentityFile` 或密码，不会做任何静默回退。

## 可用子命令

| 命令 | 用途 |
|------|------|
| `list` | 列出所有 SSH 主机（来自 `~/.ssh/config`）及各自的认证方式 |
| `state [<host>]` | 读取或设置当前活动远程主机 |
| `exec <host> <cmd>` | 在远程执行命令，返回 stdout/stderr |
| `pipe <host> <cmd>` | 与 exec 相同，但将本地 stdin 管道传输给远程命令 |
| `test <host>` | 快速连通性测试 |

## 状态管理

当前活动远程主机保存在：

```
{{INSTALL_DIR}}/../.remote-state.json
```

### 关键：每轮对话开始时都要检查状态

每次开始工作时，先确认当前是否处于远程模式：

```bash
node "{{INSTALL_DIR}}/remote.mjs" state
```

输出为 JSON：`{"host":"<name>","since":"<iso-date>"}`。

- 若 `host` 为 `"local"` → 正常在本地操作。
- 若 `host` 为其他值 → 所有操作都必须经由该远程主机。
- 同一会话内，用户不需要重复发起连接请求。

### 设置活动主机

触发方式：用户输入 `/ssh <host>`（例如 `/ssh myserver`）。未指定主机名时（即只有 `/ssh`），先列出所有可用主机供用户选择。

```bash
node "{{INSTALL_DIR}}/remote.mjs" state <host>
```

然后向用户确认：「✅ 已连接到 `<host>`，后续所有操作将在该服务器上执行。」

切回本地模式：

```
/ssh local
```

即执行：

```bash
node "{{INSTALL_DIR}}/remote.mjs" state local
```

列出所有可用主机（等价于 `/ssh` 不带参数）：

```bash
node "{{INSTALL_DIR}}/remote.mjs" list
```

## 远程模式下的操作路由

设 `<HOST>` 为状态文件中的当前活动远程主机。

### 命令执行 — 远程执行 shell 命令

```bash
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "<command>"
```

- 每次 exec 都从远程用户的 home 目录开始。
- 需要连续执行时用链式命令：`"cd /path && cmd1 && cmd2"`
- 多行命令：用 `&&` 或 `;` 连接，合并为一次调用。
- 需要保持工作目录时，在同一次调用内链式完成：`"cd /target && ls && cat file"`

### 读取远程文件

```bash
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "cat /path/to/file"
```

### 写入远程文件

```bash
echo "content" | node "{{INSTALL_DIR}}/remote.mjs" pipe <HOST> "cat > /path/to/file"
```

内容较大时同样使用管道方式。脚本内部使用 base64 编码，特殊字符会被安全处理。

### 修改远程文件

没有直接的远程编辑命令，流程如下：

1. 读取文件：`exec <HOST> "cat /path/to/file"`
2. 在本地对内容做修改
3. 写回：`echo "new content" | node ... pipe <HOST> "cat > /path/to/file"`

### 搜索文件 / 搜索内容

```bash
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "find /path -name '*.py' -type f"
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "grep -rn 'pattern' /path"
```

### 列出目录

```bash
node "{{INSTALL_DIR}}/remote.mjs" exec <HOST> "ls -la /path/to/dir"
```

## 规则

1. **每轮都检查状态** — 不要凭记忆假设；每次都确认当前处于本地还是远程模式。
2. **只用远程路径** — 远程模式下所有路径均指远程文件系统。
3. **禁止交互式命令** — `vim`、`htop`、需要输入密码的 `sudo` 无法使用。改用非交互替代方案。
4. **sudo** — 仅当远程配置了免密 sudo 时可用，例如：`exec <HOST> "sudo ls /root"`
5. **密码安全** — 任何情况下不要回显密码。脚本自动从 `password.xlsx` 读取。
6. **连接失败** — 某台主机连不上时，建议用户用 `remote.mjs list` 核对主机名，再用 `remote.mjs test <host>` 排查。
7. **远程操作用远程工具** — 在远程机器上通过 exec 使用 `find`、`grep`、`cat`、`ls`，不要用本地环境自带的文件工具去访问远程路径。
