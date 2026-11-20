/**
 * 网络路径探测（无人值守构建用）。
 *
 * ## 用户指定的优先级
 *
 * 直连 → 镜像 → 7897 代理（代理可能抖动，允许多次尝试）。
 *
 * ## 实测发现的一个关键事实（2026-11-19）
 *
 * 当前 shell 环境里已存在 `HTTP_PROXY=http://127.0.0.1:10461`（不是 7897）。
 * 所有请求默认被它接管，而它的吞吐约 **0.7 KB/s** —— 等于不可用。
 *
 * 对比同一文件的实测速度：
 *   - 经 10461 环境代理：      0.7 KB/s
 *   - 绕开代理直连镜像 CDN：  19.6 MB/s
 *   - 走 7897 代理：          21.2 MB/s
 *
 * 所以「构建慢/失败」的真实原因很可能是这个环境代理，而不是远程站点不可达。
 * 本脚本因此把「是否绕开环境代理」作为一个显式维度来测，而不是只看 URL 通不通。
 *
 * ## 用法
 *
 *   node scripts/probe-network.mjs          打印建议
 *   node scripts/probe-network.mjs --json   机器可读
 *   node scripts/probe-network.mjs --apply  打印可直接 export 的环境变量
 */

const THRESHOLD = 1024 * 1024; // 1MB/s 以下视为不可用（构建要下几十 MB）
const PROXY_7897 = "http://127.0.0.1:7897";
const SAMPLE = "https://cdn.npmmirror.com/binaries/electron/44.7.0/electron-v44.7.0-win32-x64.zip";

/** 用 curl 测速：比 Node fetch 更贴近构建工具的真实行为，且能显式控制代理。 */
async function speedOf({ proxy, label }) {
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  // Windows 下 `-o /dev/null` 会报 curl(23)「client returned ERROR on write」，
  // 因为它把 /dev/null 当成真实路径。用临时文件代替。
  const sink = join(tmpdir(), "cua-probe-sink.bin");
  // 不能用 `--max-filesize`：curl 在**开始传输前**就按 Content-Length 判定超限，
  // 于是速度恒为 0（实测确认）。改为只靠 `--max-time` 截断——
  // 8 秒内下载多少就是多少，速度数据才真实。
  const args = [
    "-sS",
    "-o",
    sink,
    "-w",
    "%{speed_download}|%{http_code}",
    "--max-time",
    "8",
  ];
  if (proxy === null) {
    // 显式绕开所有环境代理 —— 这一档最能反映线路本身的速度
    args.push("--noproxy", "*");
  } else if (typeof proxy === "string") {
    // curl 的 -x 会覆盖环境变量
    args.push("-x", proxy);
  }
  args.push(SAMPLE);

  const parse = (out) => {
    const [speed, code] = String(out).trim().split("|");
    const bytesPerSec = Number(speed);
    return {
      label,
      ok: code === "200" && bytesPerSec >= THRESHOLD,
      speed: Math.round(bytesPerSec),
      code,
    };
  };

  try {
    return parse(execFileSync("curl", args, { encoding: "utf8", timeout: 15_000 }));
  } catch (error) {
    // --max-time 到点会返回非零退出码，但 -w 的输出仍在 stdout 里，速度有效
    const out = String(error?.stdout ?? "");
    if (out.includes("|")) return parse(out);
    return {
      label,
      ok: false,
      speed: 0,
      code: "ERR",
      error: String(error?.message ?? "").slice(0, 80),
    };
  }
}

const candidates = [];

// 1) 直连（绕开一切代理）—— 用户的第一优先级，也是最快的
candidates.push(await speedOf({ proxy: null, label: "直连（绕开代理）" }));

// 2) 环境代理（当前 shell 默认，用于暴露问题）
candidates.push(await speedOf({ proxy: undefined, label: `环境代理 ${process.env.HTTP_PROXY ?? "（无）"}` }));

// 3) 7897 代理（抖动用 3 次，取最快）
{
  let best = { speed: 0, ok: false, code: "ERR", label: "7897 代理" };
  for (let i = 0; i < 3; i += 1) {
    const r = await speedOf({ proxy: PROXY_7897, label: "7897 代理" });
    if ((r.speed ?? 0) > (best.speed ?? 0)) best = r;
    if (r.ok) break;
  }
  candidates.push(best);
}

const picked = candidates.find((c) => c.ok) ?? null;
const report = { threshold: THRESHOLD, candidates, picked: picked?.label ?? null };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else if (process.argv.includes("--apply")) {
  // 输出可直接 source 的环境变量：让构建工具绕开坏代理
  if (picked?.label.startsWith("7897")) {
    console.log(`export HTTP_PROXY=${PROXY_7897}`);
    console.log(`export HTTPS_PROXY=${PROXY_7897}`);
    console.log(`export NO_PROXY=127.0.0.1,localhost,::1`);
  } else {
    console.log("unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy");
    console.log("export NO_PROXY=127.0.0.1,localhost,::1");
  }
  console.log(`export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`);
} else {
  console.log(`网络路径实测（阈值 ${Math.round(THRESHOLD / 1024 / 1024)} MB/s）\n`);
  for (const c of candidates) {
    const speed =
      c.speed >= 1024 * 1024
        ? `${(c.speed / 1024 / 1024).toFixed(1)} MB/s`.padStart(11)
        : `${Math.round(c.speed / 1024)} KB/s`.padStart(11);
    console.log(`  ${c.label.padEnd(34)} ${speed}  ${c.ok ? "可用" : "不可用"}  ${c.error ?? ""}`);
  }
  console.log("");
  if (picked) {
    console.log(`建议：${picked.label}`);
    console.log(`（环境代理若不可用，构建前必须 unset HTTP_PROXY，否则下载会卡死）`);
  } else {
    console.log("三条路径均不达标 —— 构建若需联网会失败，需人工介入。");
  }
}

process.exit(picked ? 0 : 1);
