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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const PORT = 4173;
/** 发根证书的引导页。必须是明文 http：拿未受信任的 https 去下载根证书是个死循环 */
const HELPER_PORT = 4180;
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
let guide = null;
const cleanup = () => {
  tunnel?.kill();
  guide?.close();
  killPort(PORT);
  killPort(HELPER_PORT);
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(0);
  });
}

killPort(PORT);
killPort(HELPER_PORT);

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

// ---- 证书引导页 ----

function guidePage(host) {
  const app = `https://${host}:${PORT}/`;
  return `<!doctype html>
<html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dove 安装引导</title>
<style>
  body{margin:0;padding:24px;font:16px/1.6 -apple-system,"PingFang SC",system-ui,sans-serif;
       background:#f4f4f5;color:#18181b}
  main{max-width:520px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#71717a;font-size:14px;margin:0 0 24px}
  section{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:18px;margin-bottom:16px}
  h2{font-size:15px;margin:0 0 10px}
  ol{margin:10px 0 0;padding-left:20px}
  li{margin:6px 0}
  a.btn{display:block;padding:13px;margin-top:12px;background:#2563eb;color:#fff;
        border-radius:9px;text-align:center;text-decoration:none;font-size:15px}
  a.btn.ghost{background:#fff;color:#2563eb;border:1px solid #2563eb}
  .status{margin-top:12px;padding:11px 13px;border-radius:9px;font-size:14px}
  .ok{background:#dcfce7;color:#166534}
  .bad{background:#fef3c7;color:#92400e}
  code{background:#f4f4f5;padding:1px 5px;border-radius:4px;font-size:13px}
</style></head><body><main>

<h1>🕊️ Dove 安装引导</h1>
<p class="sub">装成 App 需要 HTTPS，而局域网上的 HTTPS 得先让这台设备信任本机证书。</p>

<section>
  <h2>第一步 · 安装并信任根证书</h2>
  <a class="btn" href="/rootCA.pem">下载根证书</a>
  <ol>
    <li><b>iOS / iPadOS</b>：下载后去「设置」顶部点<b>已下载描述文件</b>装上，
        然后必须再去「通用 → 关于本机 → <b>证书信任设置</b>」把 mkcert 那一项打开
        —— 这一步最容易漏，漏了等于没装。</li>
    <li><b>Android</b>：设置 → 安全 → 加密与凭据 → 安装证书 → <b>CA 证书</b></li>
  </ol>
  <div id="status" class="status bad">正在检测证书是否已受信任…</div>
</section>

<section>
  <h2>第二步 · 打开应用并安装</h2>
  <p style="margin:0;color:#71717a;font-size:14px">
    上面显示已受信任后再点这里。打开后点右上角的<b>安装</b>；
    iOS 用 Safari 的「分享 → 添加到主屏幕」。</p>
  <a class="btn ghost" href="${app}">打开 Dove（${host}）</a>
</section>

<script>
// 探测证书是否已被信任：能连上就说明 TLS 握手过了。
// no-cors 拿到的是不透明响应，读不了内容，但「有没有 reject」正好够用。
async function probe() {
  const el = document.getElementById("status");
  try {
    await fetch(${JSON.stringify(app)} + "manifest.webmanifest",
                { mode: "no-cors", cache: "no-store" });
    el.className = "status ok";
    el.textContent = "✅ 证书已受信任，可以进行第二步了";
  } catch {
    el.className = "status bad";
    el.textContent = "⚠️ 还没受信任。装完证书后回到这里刷新页面。";
    setTimeout(probe, 3000);
  }
}
probe();
</script>
</main></body></html>`;
}

function startGuide(host, caFile) {
  const server = createServer((req, res) => {
    if (req.url === "/rootCA.pem") {
      // 这个 MIME 才会让 iOS 走「安装描述文件」的流程，用 text/plain 只会当文本打开
      res.writeHead(200, {
        "content-type": "application/x-x509-ca-cert",
        "content-disposition": 'attachment; filename="rootCA.pem"',
      });
      res.end(readFileSync(caFile));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(guidePage(host));
  });
  server.listen(HELPER_PORT, "0.0.0.0");
  return server;
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
  guide = startGuide(host, join(caRoot, "rootCA.pem"));

  console.log(`\n  手机上打开这个地址，按页面上的两步走：\n`);
  console.log(`      http://${host}:${HELPER_PORT}\n`);
  console.log("  第一步发根证书（明文 http，才不会陷入「要先信任才能下载证书」的死循环），");
  console.log("  第二步跳到应用本体：");
  console.log(`      https://${host}:${PORT}\n`);
  console.log("  设备只要信任了证书就够，本机不必执行 mkcert -install。\n");
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
