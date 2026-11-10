// 仅接受 none 认证的 mock SSH 服务端
import ssh2 from "ssh2";
import { generateKeyPairSync } from "crypto";
const { Server } = ssh2;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const hostKey = privateKey.export({ type: "pkcs1", format: "pem" });
const server = new Server({ hostKeys: [hostKey] }, (conn) => {
  conn.on("authentication", (ctx) => {
    console.log(`  [mock] 收到认证请求: method=${ctx.method} user=${ctx.username}`);
    if (ctx.method === "none") return ctx.accept();
    ctx.reject();
  }).on("ready", () => {
    conn.on("session", (accept, reject) => {
      const session = accept();
      session.on("exec", (a, r, info) => {
        console.log(`  [mock] 远程执行: ${info.command}`);
        const stream = a();
        stream.write(`MOCK_OK executed: ${info.command}\n`);
        stream.exit(0);
        stream.end();
      });
    });
  });
});
server.listen(59999, "127.0.0.1", () => console.log("mock sshd 就绪 :59999"));
