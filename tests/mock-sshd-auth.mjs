// 认证策略：none-server 拒绝 none 要求密码；pw-server 接受正确密码
import ssh2 from "ssh2";
import { generateKeyPairSync } from "crypto";
const { Server } = ssh2;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const hostKey = privateKey.export({ type: "pkcs1", format: "pem" });
const server = new Server({ hostKeys: [hostKey] }, (conn) => {
  conn.on("authentication", (ctx) => {
    console.log(`  [mock] 认证请求: method=${ctx.method} user=${ctx.username}`);
    if (ctx.username === "deploy" && ctx.method === "none") { ctx.reject(); return; } // 拒绝 none，要求密码
    if (ctx.username === "admin" && ctx.method === "password") {
      if (ctx.password === "testpass123") return ctx.accept();
      ctx.reject(); return;
    }
    ctx.reject();
  }).on("ready", () => {
    conn.on("session", (accept) => {
      const session = accept();
      session.on("exec", (a, r, info) => {
        const stream = a();
        stream.write(`MOCK_OK ${ctx_user}:${info.command}\n`);
        stream.exit(0); stream.end();
      });
    });
  });
});
let ctx_user = "";
server.listen(59998, "127.0.0.1", () => console.log("mock2 sshd 就绪 :59998"));
