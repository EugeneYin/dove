import { defineConfig } from "vite";

export default defineConfig({
  // 绑定所有网卡，便于用局域网 IP 在 Android Pad 真机上调试
  server: { host: true },
});
