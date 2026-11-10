# 测试

本目录包含两个 mock SSH 服务端，用于在无真实服务器的环境下端到端验证 remote.mjs。

## mock-sshd-none.mjs — none 认证

仅接受 `none` 认证方法（用户 deploy，端口 59999）。验证无凭据主机的完整链路：

```bash
# 终端 1
node tests/mock-sshd-none.mjs

# 终端 2（~/.ssh/config 中指向 127.0.0.1:59999 的主机，无 IdentityFile、password.xlsx 无记录）
node remote.mjs exec <none主机> "uname -a"   # 应输出 MOCK_OK executed: uname -a
echo x | node remote.mjs pipe <none主机> "cat > /tmp/o"   # exit=0
```

## mock-sshd-auth.mjs — none 拒绝 / password 认证

端口 59998。用户 `deploy` 拒绝 none（模拟要求凭据的服务器）；用户 `admin` 仅接受密码 `testpass123`：

```bash
# none 被拒 → 应报「All configured authentication methods failed」并给出补充配置指引，exit=1
node remote.mjs exec <none被拒主机> "echo hi"

# 密码正确（password.xlsx 中有该主机记录）→ 输出 MOCK_OK，exit=0
node remote.mjs exec <password主机> "whoami"
```

## 其他已验证项

- `list`：key / password / none 三种认证标签正确显示
- `state <host>` / `state` / `state local`：设置、查询、切回均正确
- 主机不存在、缺少参数等错误路径均有中文指引，exit=1
