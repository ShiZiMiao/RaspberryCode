#!/usr/bin/env node
/**
 * 发版准入检查（release gate）。
 *
 * 背景：2026-11-13 用户明确要求「以后没有经过全面测试时禁止发版」。
 * 此前 0.2.0/0.2.1 带着「更新功能实际不可用」、0.1.0/0.2.0 带着
 * 「装完没有快捷方式」发出去，两次都是用户先发现。仅靠记忆和自觉不够，
 * 因此把可自动判定的部分固化成脚本，让发版流程必须先过这一关。
 *
 * 用法：
 *   node scripts/release-gate.mjs            # 完整检查
 *   node scripts/release-gate.mjs --quick    # 只查产物与元数据一致性（不跑门禁）
 *
 * 退出码：0 = 允许发版；1 = 阻止发版（会列出未通过项）。
 *
 * 覆盖范围与边界：
 *   - 这里只判定「可自动验证」的部分（门禁、产物一致性、资产齐全）。
 *   - 真实安装/升级/功能点验属人工项，脚本无法替代，会在末尾列出待人工确认清单，
 *     需要人工逐项勾选确认后才发版。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const dist = join(repoRoot, "packages/desktop/dist");
const quick = process.argv.includes("--quick");

const failures = [];
const warnings = [];
const manual = [];

const ok = (msg) => console.log(`  OK    ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const warn = (msg) => {
  warnings.push(msg);
  console.log(`  WARN  ${msg}`);
};
const need = (msg) => manual.push(msg);

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/**
 * 定位可用的 pnpm 执行方式，返回 `{ cmd, args }` 供 execFileSync 直接调用。
 *
 * 不走 `npx pnpm` 的原因见下面「自动门禁」段的注释：Windows 上 execFileSync 直接
 * spawn `.cmd`（npx.cmd）会 ENOENT。这里按两种真实形态找：
 *   1. pnpm 的 JS 入口 pnpm.cjs —— 用 process.execPath 执行（npm 全局安装形态）；
 *   2. pnpm 独立可执行文件 pnpm.exe / pnpm —— 直接执行（mise / 独立安装形态）。
 * 两步都在 PATH 与常见安装目录里找，均找不到返回 null 由调用方报错。
 */
function findPnpmRunner() {
  const exeName = process.platform === "win32" ? "pnpm.exe" : "pnpm";
  const nodeDir = dirname(process.execPath);

  // 1) pnpm 的 JS 入口（用当前 node 执行，最可移植）。
  //    pnpm 10 起入口是 bin/pnpm.mjs；早期版本是 bin/pnpm.cjs，两者都要认。
  const jsCandidates = [];
  for (const entry of ["pnpm.mjs", "pnpm.cjs"]) {
    jsCandidates.push(
      join(nodeDir, "node_modules", "pnpm", "bin", entry),
      join(nodeDir, "..", "lib", "node_modules", "pnpm", "bin", entry),
      join(repoRoot, "node_modules", "pnpm", "bin", entry),
      join(nodeDir, "..", "pnpm", "bin", entry),
      // npm 全局安装形态：pnpm 与 node 不在同一目录，而是落在 %APPDATA%\npm 下
      join(process.env.APPDATA ?? "", "npm", "node_modules", "pnpm", "bin", entry),
    );
  }
  for (const candidate of jsCandidates) {
    if (candidate && existsSync(candidate)) {
      return { cmd: process.execPath, args: [candidate] };
    }
  }

  // 2) 独立可执行文件：先看 PATH，再看 node 同级目录。
  //    Windows 上 npm 全局安装只有无扩展名的 sh 脚本与 pnpm.cmd（后者需经 cmd.exe
  //    执行，不能直接 spawn），因此这里只认真正的 .exe；.cmd 形态由上一步的
  //    pnpm.mjs 覆盖。
  const pathDirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  const exeDirs = [...pathDirs, nodeDir, join(nodeDir, "..")];
  for (const dir of exeDirs) {
    if (!dir) continue;
    const candidate = join(dir, exeName);
    if (existsSync(candidate)) {
      return { cmd: candidate, args: [] };
    }
  }
  return null;
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

// ---------------------------------------------------------------------------
// 0. 测试环境模拟度：确认当前进程没有用「只有开发机才有」的覆盖变量
// ---------------------------------------------------------------------------
//
// 为什么要有这一段（2026-11-24，用户要求）：0.2.7 的远程连接缺陷（URL 版本号双拼）
// 在开发机上**永远测不出来**，因为开发机配了
//   RASPBERRYCODE_REMOTE_ASSET_LOCAL_RELEASE_DIR=<仓库>/mock-cdn
// 一旦设置，解析器直接走「本地目录读 descriptor」通道，**完全绕过 HTTP 拼接逻辑**，
// 而缺陷恰恰在 HTTP 拼接上。于是「本机能连」被当成「发布版能连」。
//
// 更隐蔽的一层：**删掉用户环境变量只对「之后新启动的进程」生效**。
// 已经在跑的终端 / IDE / 构建代理会继续持有旧值并向子进程传播，
// 表现为「注册表已空、但构建出来的东西仍走本地目录」。
//
// 因此这里同时检查「进程级」与「用户/机器级」：只要进程级还残留，就报警——
// 因为门禁自己跑构建/验证时继承的正是进程级环境。
const ENV_OVERRIDES = [
  [
    "RASPBERRYCODE_REMOTE_ASSET_LOCAL_RELEASE_DIR",
    "绕过 HTTP 链路改读本地目录：会掩盖发布根拼接类缺陷（0.2.7 事故即如此被掩盖）",
  ],
  [
    "RASPBERRYCODE_REMOTE_ASSET_CDN_BASE_URL",
    "覆盖构建期注入的发布根：验证到的不是发布版真实行为",
  ],
  [
    "RASPBERRYCODE_DEV_REMOTE_ASSET_USE_CDN",
    "dev 态强制走公网 CDN：与默认路径不同",
  ],
];

section("测试环境模拟度");
{
  const polluted = [];
  for (const [name, why] of ENV_OVERRIDES) {
    const value = (process.env[name] ?? "").trim();
    if (value) polluted.push({ name, value, why });
  }
  if (polluted.length === 0) {
    ok("无远程资产覆盖变量（等价用户环境）");
  } else {
    for (const { name, value, why } of polluted) {
      warn(`检测到覆盖变量 ${name}=${value} —— ${why}`);
    }
    warn(
      "当前进程环境不等于用户环境：上述变量会让远程连接/更新链路的验证结果失真。" +
        "请在**没有**这些变量的终端里重跑（删除用户变量后必须开新终端，旧终端仍持有旧值）。",
    );
  }
}

// ---------------------------------------------------------------------------
// 1. 版本一致性：package.json / build-meta / 产物名 / latest.yml 必须同一个版本
// ---------------------------------------------------------------------------
section("版本一致性");

const desktopPkgPath = join(repoRoot, "packages/desktop/package.json");
const rootPkgPath = join(repoRoot, "package.json");
const metaPath = join(repoRoot, "packages/desktop/out/metadata/build-meta.json");

const desktopVersion = readJson(desktopPkgPath).version;
const rootVersion = readJson(rootPkgPath).version;
console.log(`  desktop=${desktopVersion} root=${rootVersion}`);

if (desktopVersion !== rootVersion) {
  fail(`根 package.json(${rootVersion}) 与 desktop(${desktopVersion}) 版本不一致`);
} else {
  ok("两个 package.json 版本一致");
}

if (!existsSync(metaPath)) {
  fail("缺少 build-meta.json —— 必须先跑 pnpm prepare:build-meta");
} else {
  const meta = readJson(metaPath);
  if (meta.appVersion !== desktopVersion) {
    // 这是 11-13 真实踩过的坑：改了 package.json 但没重建 meta，
    // electron-builder 的 extraMetadata.version 会继续用旧值，产物名与内容版本错位。
    fail(
      `build-meta.json 的 appVersion=${meta.appVersion} 与 package.json=${desktopVersion} 不一致；先跑 pnpm prepare:build-meta`,
    );
  } else {
    ok(`build-meta.json 版本一致（${meta.appVersion}，commit ${meta.buildCommitId}）`);
  }
}

const installer = join(dist, `RaspberryCode-${desktopVersion}-win-x64.exe`);
const blockmap = `${installer}.blockmap`;
const latestYml = join(dist, "latest.yml");

for (const [label, p] of [
  ["安装包", installer],
  ["blockmap", blockmap],
  ["latest.yml", latestYml],
]) {
  if (existsSync(p)) ok(`${label} 存在（${(statSync(p).size / 1048576).toFixed(2)}MB）`);
  else fail(`缺少 ${label}：${p}`);
}

if (existsSync(latestYml) && existsSync(installer)) {
  const yml = readFileSync(latestYml, "utf8");
  const ymlVersion = yml.match(/^version:\s*(\S+)/m)?.[1];
  const ymlSize = Number(yml.match(/^\s+size:\s*(\d+)/m)?.[1]);
  const realSize = statSync(installer).size;
  if (ymlVersion !== desktopVersion) {
    fail(`latest.yml version=${ymlVersion} 与 package.json=${desktopVersion} 不一致`);
  } else {
    ok(`latest.yml version=${ymlVersion}`);
  }
  if (ymlSize !== realSize) {
    fail(`latest.yml size=${ymlSize} 与实际文件 ${realSize} 不一致`);
  } else {
    ok(`latest.yml size 与实际文件一致（${realSize}）`);
  }
}

// ---------------------------------------------------------------------------
// 2. 产物核验：从 asar 里读回主进程代码，确认不是旧产物
// ---------------------------------------------------------------------------
section("产物核验");

const unpackedAsar = join(dist, "win-unpacked/resources/app.asar");
if (!existsSync(unpackedAsar)) {
  fail("缺少 win-unpacked/resources/app.asar，无法核验产物内容");
} else {
  try {
    const { default: asar } = await import("@electron/asar");
    const entries = asar.listPackage(unpackedAsar);
    const rel = entries.find((p) => /(^|[\\/])out[\\/]main[\\/]index\.js$/.test(p));
    if (!rel) {
      fail("asar 内找不到 out/main/index.js");
    } else {
      const main = asar.extractFile(unpackedAsar, rel.replace(/^[\\/]+/, "")).toString();
      const m = (s) => {
        const n = main.split(s).length - 1;
        return n > 0 ? n : 0;
      };
      console.log(`  产物大小 ${(main.length / 1048576).toFixed(2)} MB`);

      // 2026-11-20 修复：tsup 会做代码分割，`__RASPBERRYCODE_REMOTE_CDN_RELEASE_ROOTS__`
      // 这类常量被折叠进 `out/main/chunk-*.js` 而不是 `index.js`。
      // 只扫 index.js 会误报「缺少远程资产发布根」——0.2.6 打包时实测发布根确实在
      // chunk-LRP4F6AG.js 里，但门禁判 FAIL。改为扫描 out/main 下全部 js。
      // 注意不能用 relay 变量：这里只需要一个拼接后的全文用于字面量检索。
      const mainBundleFiles = entries.filter((p) =>
        /(^|[\\/])out[\\/]main[\\/][^\\/]+\.js$/.test(p),
      );
      const mainBundle = mainBundleFiles
        .map((p) => {
          try {
            return asar.extractFile(unpackedAsar, p.replace(/^[\\/]+/, "")).toString();
          } catch {
            return "";
          }
        })
        .join("\n");

      // 这些标记代表近期修复真的在包里。新增重要修复时在此登记，
      // 防止「改了源码但产物没重编」这类问题再次静默通过。
      const requiredMarkers = [
        ["镜像重定向装在 updater session", "mirror redirect installed"],
        ["按阶段切换代理", "update session proxy ->"],
        ["代理同步注册", "registerUpdateSessionProxySync"],
        ["下载降级重试", "retry via"],
        ["同一失败去重", "dup="],
      ];
      for (const [label, marker] of requiredMarkers) {
        if (m(marker) > 0) ok(`产物含「${label}」`);
        else fail(`产物缺少「${label}」—— 很可能用了旧 out/，请跑 pnpm build`);
      }

      const pkgEntry = entries.find((p) => p.replace(/\\/g, "/").match(/^\/?package\.json$/));
      if (pkgEntry) {
        const inAsarVersion = JSON.parse(
          asar.extractFile(unpackedAsar, pkgEntry.replace(/^[\\/]+/, "")).toString(),
        ).version;
        if (inAsarVersion === desktopVersion) ok(`asar 内 package.json 版本=${inAsarVersion}`);
        else fail(`asar 内 package.json 版本=${inAsarVersion}，与 ${desktopVersion} 不一致`);
      }

      // 远程连接（SSH / WSL / Docker）依赖安装包内的 Source Server 发布根。
      //
      // 事故：0.2.5 发出去后远程连接全部失败，报
      // 「Unable to resolve Source Server release descriptor（HTTP release roots unreachable）」。
      // 根因是构建期 CDN_DOMAIN / REMOTE_ASSET_RELEASE_ROOT_URL 都没配，
      // `__RASPBERRYCODE_REMOTE_CDN_RELEASE_ROOTS__` 被常量折叠成空数组，安装包里没有任何发布根。
      // 这条缺陷能发出去，是因为门禁只检查更新链路，远程连接一项都没覆盖。
      //
      // 这里判定「发布根非空」：产物里必须存在一个 http(s) 的 releases 根地址。
      // 不能只搜变量名——生产构建会把标识符重命名，常量也已被折叠；只能看实际字面量。
      //
      // 2026-11-24 修正：旧正则 `/releases(?:\/|["'`])/` 只截到 `/releases/` 就停，
      // 拿到的是**被截断的根** `https://github.com/<o>/<r>/releases`，
      // 而真实注入值是 `.../releases/download/v0.2.7`。截断后既判断不出 GitHub 的 tag 段，
      // 也永远看不出重复版本段——等于把这条检查架空。改为提取完整 URL 字面量后再筛 releases。
      const remoteRootMarkers = [
        ...new Set(mainBundle.match(/https?:\/\/[^"'`\s)]+/gu) ?? []),
      ]
        .map((root) => root.replace(/\/+$/u, ""))
        .filter((root) => /\/releases(?:\/|$)/u.test(root));
      const nonPlaceholderRoots = remoteRootMarkers.filter(
        (root) => !/intranet\.example\.invalid|example\.(?:com|invalid)/u.test(root),
      );
      if (nonPlaceholderRoots.length > 0) {
        ok(`产物含远程资产发布根（${nonPlaceholderRoots.length} 个）`);
      } else {
        fail(
          "产物缺少远程资产发布根：远程连接（SSH/WSL/Docker）将无法下载 Source Server。构建时须设置 REMOTE_ASSET_RELEASE_ROOT_URL 或 CDN_DOMAIN",
        );
      }

      // 2026-11-24 追加：上面只判「有没有根」，判不出「根拼出来的 URL 是否可用」。
      //
      // 事故：0.2.7 发出去后远程连接全部失败。发布根其实**在**包里，字面量检查是绿的，
      // 但 Desktop main 侧对已带 tag 的 GitHub 根（.../releases/download/v0.2.7）
      // 又无条件追加了一次版本，拼出 .../download/v0.2.7/0.2.7 → 实测 404。
      // 也就是说：根存在 + 根正确 + 拼接错误，三个条件同时成立时旧门禁全绿。
      //
      // 这里补两道：
      //   ① 结构检查（离线）：根不得自带重复版本段。
      //   ② 真实探测（联网）：按客户端真实会请求的形态，实际拉一次 descriptor，确认真的 200。
      const escapedVersion = desktopVersion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const doubledVersionPattern = new RegExp(
        `/v?${escapedVersion}/v?${escapedVersion}(?:/|$)`,
        "u",
      );
      const doubled = nonPlaceholderRoots.filter((root) => doubledVersionPattern.test(root));
      if (doubled.length > 0) {
        fail(
          `产物里的远程资产发布根自带重复版本段（会拼出必然 404 的地址）：${doubled.join(", ")}`,
        );
      } else if (nonPlaceholderRoots.length > 0) {
        ok("发布根无重复版本段");
      }

      // 真实探测：把「客户端会请求的那个 URL」真的拉一遍。
      //
      // 根的两种合法形态决定客户端是否再拼版本，这里按同一规则还原请求 URL：
      //   - 已带版本段（`/v0.2.7` 或 `/0.2.7`）→ 客户端直接用，拼 `<root>/<file>`；
      //   - 不带版本段 → 客户端会拼 `<root>/<version>/<file>`。
      // 若将来消费侧又改坏成双拼，探测会 404，从而在发版前拦下。
      //
      // 探测失败只 WARN 不 FAIL —— 发版机可能无外网/走代理，不能因构建机网络拦住发版；
      // 但必须留下痕迹，并强制人工清单确认一次真实 SSH 远程连接。
      const descriptorName = "source-server-release.json";
      const isVersioned = (root) =>
        root.endsWith(`/v${desktopVersion}`) || root.endsWith(`/${desktopVersion}`);
      const probeTargets = nonPlaceholderRoots
        .filter((root) => /^https?:\/\//u.test(root))
        .map((root) => `${root}${isVersioned(root) ? "" : `/${desktopVersion}`}/${descriptorName}`);
      let probedOk = 0;
      const probeErrors = [];
      for (const url of probeTargets) {
        try {
          // 60 秒上限：descriptor 只有 1.3KB，正常亚秒级；GitHub 在国内偶发握手慢。
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60_000);
          let response;
          try {
            response = await fetch(url, {
              method: "GET",
              redirect: "follow",
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          if (response.ok) {
            probedOk += 1;
            ok(`发布根可下载 descriptor：${url}`);
          } else {
            probeErrors.push(`${url} -> HTTP ${response.status}`);
          }
        } catch (error) {
          probeErrors.push(`${url} -> ${error?.message ?? String(error)}`);
        }
      }
      if (probeTargets.length > 0 && probedOk === 0) {
        warn(
          `发布根 descriptor 探测未通过（可能是发版机网络问题，也可能是地址真的错）：${probeErrors.join("; ")}。` +
            "发版前必须人工确认真实 SSH 远程连接能下载 Source Server。",
        );
      }

    }
  } catch (error) {
    fail(`读取 asar 失败：${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// 3. 更新镜像可用性（用户要求：每次发版前重新测试并选最优镜像）
// ---------------------------------------------------------------------------
section("更新镜像可用性");

// 背景（2026-11-23）：更新链路依赖第三方公益镜像，而这类镜像存活率极低——
// hiwiki 榜单 66 家里 34 家已超时，同一天内速度还能从 9.6MB/s 掉到 0.11MB/s。
// 0.2.7 之前发出去的包因为镜像只覆盖 /releases/download/、未覆盖 releases.atom，
// 导致无代理用户点「检查更新」必现 ERR_CONNECTION_TIMED_OUT。
// 因此把「发版前探测镜像」固化成门禁，而不是靠每次记得手动跑。
//
// 判定：至少要有一家镜像同时通过 atom 内容校验 + Range 206 + latest.yml。
// 全挂时不直接 fail —— 允许用户显式选择「只走直连」发版，但必须留下痕迹。
//
// --quick 跳过：quick 是「查产物一致性」的快速通道（几十秒），
// 而完整探测 30+ 家镜像要几分钟。把探测塞进 quick 会让它失去「快」的价值，
// 最终被绕过。因此 quick 明确提示「未探测」，由真正发版时的完整门禁兜住。
if (quick) {
  warn("--quick 跳过了镜像探测；正式发版必须无 --quick 跑一次（会实测 30+ 家镜像）");
} else {
  const probeScript = join(repoRoot, "scripts/probe-update-mirrors.mjs");
  if (!existsSync(probeScript)) {
    warn("缺少 scripts/probe-update-mirrors.mjs，跳过镜像探测");
  } else {
    try {
      const out = execFileSync(process.execPath, [probeScript, "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
      });
      const report = JSON.parse(out);
      const eligible = report.eligible ?? [];
      // 探测脚本已经按「速度排序 + 取前 3」选好了，这里直接用，避免两处算法漂移。
      const selected = report.selected ?? eligible.slice(0, 3);
      if (eligible.length === 0) {
        // 不 fail：镜像全挂时更新并非不可用，回退状态机会降到 direct（GitHub 直连），
        // 最终还有 manual（手动下载）。但无代理用户走直连通常很慢，必须显式告知。
        warn(
          "所有候选镜像均不合格：本次发版将只能走 GitHub 直连（无代理用户可能很慢）。建议把 updateMirrorPrefix 显式设为空串并在发版说明中提示",
        );
      } else {
        const top = selected
          .map((r) => r.prefix.replace(/^https:\/\//, "").replace(/\/$/, ""))
          .join(", ");
        // 只在不等于上限时才提「共几家」：等于时「6 家取 3」已经由前缀表达过，
        // 重复一遍会让这行变得难读。
        const suffix =
          eligible.length > selected.length ? `（全通 ${eligible.length} 家，取前 ${selected.length}）` : "";
        ok(`合格镜像 ${eligible.length} 家${suffix}，候选按速度取：${top}`);
        if (eligible.length < 3) {
          ok(`合格数不足 3 家，按实际 ${eligible.length} 家写入（有几个算几个）`);
        }
        ok("兜底：候选全挂 → GitHub 直连（direct）→ 手动下载（manual）");
        // 只有当「当前候选里已经没有任何一家合格」时才提醒改代码。
        //
        // 为什么不按名次提醒：镜像速度波动极大（同一天内 0.05–14MB/s 都出现过），
        // 按名次比较会让每次发版都产生「建议更换」的噪音，久而久之被当成无用告警忽略。
        // 真正需要人工介入的只有一种情况：候选全军覆没。
        const current = readFileSync(
          // 候选的事实源在 shared（客户端自更新与远程资产下载共用一份）。
          // 曾经读的是 updateMirror.ts——候选上移后如果不改这里，正则永远匹配不到，
          // declaredPrefixes 恒为空 → 「候选全军覆没」的告警彻底失效，变成静默通过。
          join(repoRoot, "packages/shared/src/client-update/contract.ts"),
          "utf8",
        );
        const declared = current.match(/DEFAULT_UPDATE_MIRROR_CANDIDATES[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
        const declaredPrefixes = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
        const eligibleSet = new Set(eligible.map((r) => r.prefix));
        const stillGood = declaredPrefixes.filter((p) => eligibleSet.has(p));
        if (stillGood.length === 0) {
          warn(
            `当前代码声明的 ${declaredPrefixes.length} 家候选本次全部不合格，建议更换为：${selected
              .map((r) => r.prefix)
              .join(", ")}`,
          );
        } else {
          ok(`当前候选仍有 ${stillGood.length}/${declaredPrefixes.length} 家可用`);
        }
      }
    } catch (error) {
      // 探测本身失败（无 curl / 全超时）不应阻止发版，但要让发版人知道没测到。
      const out = `${error.stdout ?? ""}${error.stderr ?? ""}`.toString();
      warn(
        `镜像探测未完成：${out.split("\n").filter(Boolean).slice(0, 3).join(" / ") || String(error.message ?? error)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4. 自动门禁
// ---------------------------------------------------------------------------
if (quick) {
  console.log("\n== 自动门禁（--quick 跳过） ==");
  warn("已跳过 typecheck / lint / audit-neutrality，发版前必须无 --quick 跑一次");
} else {
  section("自动门禁");
  // 修复原因（2026-11-15 验收实测）：原来用 execFileSync("npx", ["pnpm", ...]) 调门禁，
  // 在 Windows 上必然失败——npx 实际是 npx.cmd，execFileSync 不走 shell 时 spawn 返回
  // ENOENT，于是 lint/typecheck 永远判 FAIL，与命令真实结果无关。这比门禁失效更危险：
  // 它让「门禁失败」失去可信度，容易被当成噪声绕过。
  // 改法：用当前 node 直接跑 pnpm 的 JS 入口（pnpm.cjs），完全不依赖 .cmd/shell。
  const pnpmRunner = findPnpmRunner();
  const run = (label, cmd, args) => {
    try {
      execFileSync(cmd, args, { cwd: repoRoot, stdio: "pipe" });
      ok(label);
      return true;
    } catch (error) {
      const out = `${error.stdout ?? ""}${error.stderr ?? ""}`.toString();
      const hint =
        error.code === "ENOENT"
          ? `（无法执行 ${cmd}，请检查工具链）`
          : out
            ? `：${out.split("\n").slice(0, 3).join(" / ")}`
            : "";
      fail(`${label} 未通过${hint}`);
      return false;
    }
  };
  const runPnpm = (label, script) => {
    if (!pnpmRunner) {
      fail(`${label} 未通过：找不到 pnpm 可执行文件，请先安装 pnpm`);
      return false;
    }
    return run(label, pnpmRunner.cmd, [...pnpmRunner.args, "run", script]);
  };
  runPnpm("typecheck", "typecheck");
  runPnpm("lint", "lint");
  run("audit-neutrality", process.execPath, ["scripts/audit-neutrality.mjs"]);
}

// ---------------------------------------------------------------------------
// 5. 必须人工确认的项（脚本无法替代）
// ---------------------------------------------------------------------------
section("必须人工确认（脚本无法替代）");
need("卸载旧版 → 安装本产物 → 版本号显示为新版");
need("开始菜单 + 桌面快捷方式均已创建，且双击能启动");
need("升级路径实跑：旧版 → 检查更新 → 下载 → 安装 → 重启 → 版本号变新");
need(
  "远程连接实测：SSH 连一台真实远端 → 能识别设备并装/升级 Source Server → 进入工作区（0.2.5 就是漏了这项）",
);
need(
  "远程连接必须在**用户等价环境**下测：不设 RASPBERRYCODE_REMOTE_ASSET_LOCAL_RELEASE_DIR / " +
    "RASPBERRYCODE_REMOTE_ASSET_CDN_BASE_URL，且从**新开的终端**启动（旧终端仍持有已删除的旧值）",
);
need("新建对话并收到模型回复（不是只看界面有没有回显）");
need("文件编辑 / 终端 / 设置页 / MCP·技能·插件入口 逐项点过");
need("涉及 UI 的改动已看真实界面截图确认");
for (const item of manual) console.log(`  [ ] ${item}`);

// ---------------------------------------------------------------------------
// 结论
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(64));
if (failures.length > 0) {
  console.log(`发版准入：拒绝（${failures.length} 项未通过）`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("发版准入：自动化项通过");
if (warnings.length > 0) {
  console.log(`警告 ${warnings.length} 项：`);
  for (const w of warnings) console.log(`  - ${w}`);
}
console.log("\n仍需人工逐项确认上面 6 项（真实安装 / 升级 / 功能点验），");
console.log("用户明确要求：未全面测试禁止发版。");
process.exit(0);
