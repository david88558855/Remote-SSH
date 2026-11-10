# Remote-SSH

一个通用 AI 技能：把 AI 助手的全部操作（文件读取、写入、命令执行）路由到远程 Linux 服务器——让 AI 直接在远程机器上干活，而不是在本地。

不依赖任何特定 AI 产品的专有机制。任何具备「执行 shell 命令」能力的 AI 助手（Claude Code、Cursor、Cline、自建 Agent 等）都可以安装使用。

## 工作方式

```
你  →  /ssh myserver      →   把远程主机写入状态文件
你  →  cat /etc/hostname  →   AI 执行：remote.mjs exec myserver "cat /etc/hostname"
你  →  nvidia-smi         →   AI 执行：remote.mjs exec myserver "nvidia-smi"
你  →  /ssh local         →   切回本地模式
```

会话中执行过 `/ssh <主机名>` 后，后续所有操作自动路由到该服务器，无需每轮重复输入。

## 认证方式（确定性判定，不做自动探测）

| 优先级 | 条件 | 方式 | 说明 |
|--------|------|------|------|
| 1 | Host 配置了 `IdentityFile` | `key` | 走原生 `ssh` 命令，自动处理 ProxyJump、ProxyCommand、ForwardAgent 等 |
| 2 | 无 `IdentityFile`，`password.xlsx` 有密码记录 | `password` | 走 Node.js `ssh2` 库 |
| 3 | 无 `IdentityFile`，`password.xlsx` 无记录 | `none` | 仅凭用户名发起 SSH "none" 认证，适用于免密/白名单认证的服务器 |

`none` 认证被服务器拒绝时，脚本会明确报错并给出补充配置的指引，不做静默回退。

## 目录结构

```
repo/
├── remote.mjs                       ← 核心执行引擎
├── package.json                     ← npm 依赖（ssh2、xlsx）
├── ssh.md                           ← /ssh 触发指令定义
├── skills/remote-server/SKILL.md    ← 技能文档：操作路由规则
├── SSH_CONFIG.example               ← ~/.ssh/config 示例模板
└── PASSWORD_FILE.example.xlsx       ← 密码文件示例模板
```

## 安装

### 1. 克隆本仓库

```bash
git clone https://github.com/david88558855/Remote-SSH.git
cd Remote-SSH
```

### 2. 安装依赖

```bash
npm install
```

### 3. 安装指令与技能

把以下文件复制到你的 AI 助手的技能/指令目录（各产品目录名不同，通常是 `commands/`、`skills/` 或自定义技能目录）：

```bash
cp ssh.md <你的AI指令目录>/ssh.md
cp -r skills/remote-server <你的AI技能目录>/remote-server
```

安装后重启 AI 助手。

### 4. 配置 SSH 主机（必填）

本技能从 `~/.ssh/config` 读取主机定义，请确认该文件存在且包含所需主机。

还没有的话，先复制示例：

```bash
cp SSH_CONFIG.example ~/.ssh/config
# 然后编辑 ~/.ssh/config，填入你真实的服务器信息
```

### 5. 配置密码（按需）

`~/.ssh/config` 中未配置 `IdentityFile` 的主机：

- 若走密码认证 → 在 `password.xlsx` 中添加该主机的密码
- 若服务器免密（如白名单认证）→ 什么都不用填，自动走 `none` 认证

> **💡 密码认证主机（无 IdentityFile）填写方法：** 复制 `PASSWORD_FILE.example.xlsx` → 改名为同目录下的 `password.xlsx`，打开后填好两列内容：A 列填「主机别名」（即 `~/.ssh/config` 里的 Host 名称），B 列填「密码」。以后新增密码主机，也照这个格式往里加行即可。

```bash
cp PASSWORD_FILE.example.xlsx password.xlsx
```

> **⚠️ 永远不要把 `password.xlsx` 提交到 git！** 已在 `.gitignore` 中忽略。

### 6. 更新文件中的路径

`skills/remote-server/SKILL.md` 和 `ssh.md` 中的 `{{INSTALL_DIR}}` 是本仓库的安装路径占位符。请全局替换为你的实际克隆路径：

```bash
# 例如克隆到了 /opt/Remote-SSH：
sed -i 's|{{INSTALL_DIR}}|/opt/Remote-SSH|g' skills/remote-server/SKILL.md ssh.md
```

## 使用

```
/ssh myserver      → 连接主机（须已列在 ~/.ssh/config 中）
/ssh               → 列出所有可用主机
/ssh local         → 切回本地模式

# 之后的操作全部在远程服务器上执行：
> cat /etc/os-release      # 读取远程文件
> ls -la /home/user/       # 列出远程目录
> nvidia-smi               # 在远程执行
```

## 环境要求

- Node.js（运行 `remote.mjs`）
- OpenSSH 客户端（终端中可用 `ssh` 命令）
- `~/.ssh/config` — SSH 主机定义（必填）
- `password.xlsx` — （可选）无密钥主机的密码；免密主机无需配置

## 安全

- **永远不要提交 `password.xlsx` 或私钥。** 两者都已被 gitignore。
- 脚本对密钥认证使用 `StrictHostKeyChecking=accept-new` 以便首次连接；如需更严格的策略，请在 `remote.mjs` 中调整。
- 连接均使用你自己的 `~/.ssh/config` 密钥——本仓库不存储任何密钥。

## 许可

MIT
