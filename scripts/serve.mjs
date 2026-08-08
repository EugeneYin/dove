/**
 * 起一个「能真正安装 PWA」的服务器，供手机 / Pad 真机验证。
 *
 * 为什么不能直接用 `npm run preview` 加 --host：Service Worker 只在安全上下文里
 * 注册，而 http://192.168.x.x 不算安全上下文（只有 localhost 与 https 算）。
 * 没有 SW 就不会触发 beforeinstallprompt，设备上根本看不到安装入口。
 *
 * 两种拿到 https 的办法，各有代价：
 *
 *   局域网   mkcert 签一张本机证书。快、不出内网、词典仍是压缩的 3.8MB，
 *            但每台设备要装一次根证书。
 *   隧道     cloudflared 给一个公网 https 地址。设备端零配置，
 *            代价是地址每次都变、流量走公网，且隧道会把词典解压成 9.9MB 传输。
 *
 * 用法:
 *   node scripts/serve.mjs            局域网 https
 *   node scripts/serve.mjs --tunnel   cloudflared 隧道
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const PORT = 4173;
const CERT_DIR = ".cache/certs";
const tunnelMode = process.argv.includes("--tunnel");

if (!existsSync("dist/index.html")) {
  console.error("dist/ 是空的，先执行 npm run build");
  process.exit(1);
}

// ---- 进程清理 ----
// 认端口不认进程树：vite 是 npx 起的，真正监听的是它的孙子进程，
// 脚本异常退出时那个进程会挂到 init 名下继续占着端口（详见 docs/pitfalls.md）。

function killPort(port) {
  try {
    const pids = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    for (const pid of pids) process.kill(Number(pid), "SIGKILL");
  } catch {
    // lsof 无匹配时退出码非 0，说明端口本来就空着
  }
}

let tunnel = null;
const cleanup = () => {
  tunnel?.kill();
  killPort(PORT);
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(0);
  });
}

killPort(PORT);

// ---- 局域网地址 ----

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

// ---- 证书 ----

/**
 * 每次都重签。证书里的地址是固定写死的，而路由器重启后本机 IP 常常就变了，
 * 用旧证书访问新 IP 会直接报证书无效——重签只要几十毫秒，不值得为它做缓存判断。
 */
function ensureCert(host) {
  try {
    execFileSync("mkcert", ["-version"], { stdio: "ignore" });
  } catch {
    console.error("没装 mkcert。执行 brew install mkcert 后重试，或改用 --tunnel。");
    process.exit(1);
  }

  mkdirSync(CERT_DIR, { recursive: true });
  execFileSync(
    "mkcert",
    [
      "-cert-file",
      join(CERT_DIR, "cert.pem"),
      "-key-file",
      join(CERT_DIR, "key.pem"),
      host,
      "localhost",
      "127.0.0.1",
      "::1",
    ],
    { stdio: "ignore" },
  );
}

// ---- 启动 ----

const args = ["vite", "preview", "--port", String(PORT), "--strictPort"];
const env = { ...process.env };

if (tunnelMode) {
  // 隧道连的是本机回环，preview 自己不必走 https
  args.push("--host", "127.0.0.1");
} else {
  const host = lanAddress();
  if (!host) {
    console.error("找不到局域网地址，是不是没连 Wi-Fi？可以改用 --tunnel。");
    process.exit(1);
  }
  ensureCert(host);
  env.DOVE_HTTPS = "1";
  args.push("--host");

  const caRoot = execFileSync("mkcert", ["-CAROOT"], { encoding: "utf8" }).trim();

  console.log(`\n  局域网地址  https://${host}:${PORT}\n`);
  console.log("  每台设备首次访问前，都要先让它信任本机签发的根证书：");
  console.log(`    根证书  ${join(caRoot, "rootCA.pem")}`);
  console.log("    本机    执行 mkcert -install（要 sudo 密码）");
  console.log("    iOS     把上面那个文件隔空投送过去 → 设置里装描述文件");
  console.log("            → 再去「通用 → 关于本机 → 证书信任设置」打开它");
  console.log("    Android 传过去后 设置 → 安全 → 加密与凭据 → 安装 CA 证书\n");
  console.log("  证书受信任之后，页面右上角的「安装」按钮才会真正可用。\n");
}

const preview = spawn("npx", args, { stdio: "inherit", env });
preview.on("exit", (code) => process.exit(code ?? 0));

if (tunnelMode) {
  // preview 起来之前 cloudflared 会连不上，等一下
  await new Promise((r) => setTimeout(r, 1500));

  tunnel = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${PORT}`]);
  let printed = false;
  const watch = (chunk) => {
    const text = String(chunk);
    // cloudflared 的日志里也有 api.trycloudflare.com（它自己的控制端点），
    // 只认多段连字符的子域，否则会把那个当成隧道地址报给用户。
    const url = text.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/)?.[0];
    if (!url) {
      // 没建起来时要让用户看见 cloudflared 自己的报错，而不是干等
      if (/ERR|error|failed/i.test(text)) process.stderr.write(text);
      return;
    }
    if (!printed) {
      printed = true;
      console.log(`\n  隧道地址  ${url}\n`);
      console.log("  手机 / Pad 直接打开即可安装，设备端无需任何配置。");
      console.log("  地址刚建立时会有几秒返回 530，那是还没在边缘节点生效，稍等再刷新。");
      console.log("  地址是临时的，本进程一停就失效。\n");
    }
  };
  tunnel.stdout.on("data", watch);
  tunnel.stderr.on("data", watch);
}
