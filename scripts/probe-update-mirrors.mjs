#!/usr/bin/env node
/**
 * 更新镜像探测（发版前必跑）。
 *
 * 用户要求（2026-11-23）：「以后每次打包发版之前都重新测试，然后选择最优镜像」。
 * 第三方公益镜像的存活率与速度变化极快（同一天内 gh-proxy.com 从 9.6MB/s 掉到
 * 0.11MB/s；hiwiki 榜单 66 家里 34 家已超时），任何「写死在代码里的镜像列表」都会
 * 在几个发版周期内失效。因此把「探测 → 排序 → 产出可粘贴的候选列表」固化成脚本。
 *
 * 用法：
 *   node scripts/probe-update-mirrors.mjs              # 探测内置候选 + 榜单，输出推荐
 *   node scripts/probe-update-mirrors.mjs --write      # 额外写入 setting 片段供参考
 *   node scripts/probe-update-mirrors.mjs --json       # 只输出 JSON（供 CI 消费）
 *   node scripts/probe-update-mirrors.mjs --list <url> # 只测指定镜像（逗号分隔）
 *
 * 退出码：0 = 至少有一家合格；1 = 无一家合格（发版应阻止或显式改为只走直连）。
 *
 * 入选硬条件（三条，缺一不可）——全部来自实测踩坑：
 *
 *   1) 能代理 `releases.atom`，且**响应体是真实 Atom XML**。
 *      为什么必须校验内容：`gh.acmsz.top` 曾返回 200 但 body 只有 2 字节 "ok"，
 *      electron-updater 会在 parseXml 阶段抛 ERR_UPDATER_INVALID_RELEASE_FEED。
 *      这类「假成功」比 403 更难排查——状态码看着正常，会被误判成客户端 bug。
 *
 *   2) 支持单 Range（206 且长度等于请求区间）。
 *      差量更新（singleRangePatch）完全依赖它。回 200 + 全量文件的镜像会让差量
 *      静默退化为整包下载（183MB vs 15MB），用户侧表现为「更新很慢」而非报错。
 *
 *   3) 能正确返回 `latest.yml`（含 version 字段）。
 *      排除只对首页/资产做兜底、对元数据返回软跳转的镜像。
 *
 * 速度只作为**同等合格者之间的排序依据**，不作为入选门槛：
 * 实测存在「所有 GitHub 镜像同时塌陷到 0.1MB/s、而同期 CNB 仍有 5MB/s」的整段拥塞，
 * 那是链路问题而非镜像问题，此时挑谁都不快——真正兜底的是候选轮换 + 直连回退。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const jsonOnly = args.includes("--json");
const doWrite = args.includes("--write");
const listIndex = args.indexOf("--list");

/** 更新源仓库：与 spec 默认一致，可用环境变量覆盖。 */
const FEED_OWNER = process.env.UPDATE_FEED_OWNER?.trim() || "ShiZiMiao";
const FEED_REPO = process.env.UPDATE_FEED_REPO?.trim() || "RaspberryCode";

/** 单次请求超时：镜像普遍慢，太短会误杀；太长会让整个探测拖到几分钟。 */
const TIMEOUT_MS = 12_000;
/** 速度采样时长：够看出量级差异，又不至于让探测期过长。 */
const SPEED_SAMPLE_MS = 8_000;
/** 判定 atom 内容真实性的最小长度：真实 XML 有 20KB 量级，"ok" 这类假响应只有几个字节。 */
const MIN_ATOM_BYTES = 2_000;

/**
 * 写进候选列表的镜像数量上限（用户 2026-11-23 要求）。
 *
 * 规则：全通的按速度排序取前 N 个；不足 N 个有几个算几个。
 * 为什么不取更多：候选越多，探测与轮换的耗时越长，而第 4 名之后的镜像
 * 在实测中速度普遍低于 0.2MB/s（对 183MB 安装包意味着要 15 分钟以上），
 * 真到那一步不如直接走直连。
 *
 * **GitHub 直连是最后兜底**，不计入这个数字：它由回退状态机的 `direct` 级承担，
 * 不占候选位置。所以候选全挂时仍有直连可用，不会无路可走。
 */
const MAX_MIRROR_CANDIDATES = 3;

/** 内置候选（当前代码里的列表），探测时优先测它们。 */
const BUILTIN_CANDIDATES = [
  "https://gh-proxy.com/",
  "https://g.z321.cc.cd/",
  "https://gitproxy.127731.xyz/",
  "https://cdn.akaere.online/",
];

/** hiwiki 榜单里标记「正常」的站（2026-11-23 快照，作为新候选来源）。 */
const KNOWN_MIRRORS = [
  "https://gh-proxy.com/",
  "https://gh.ddlc.top/",
  "https://tvv.tw/",
  "https://cdn.gh-proxy.com/",
  "https://777.z321.cc.cd/",
  "https://fastgit.cc/",
  "https://g.z321.cc.cd/",
  "https://ghproxy.imciel.com/",
  "https://gg.z321.cc.cd/",
  "https://cdn.akaere.online/",
  "https://down.mxw.xx.kg/",
  "https://gh.idayer.com/",
  "https://gh.acmsz.top/",
  "https://xsadwsd.kdns.fr/",
  "https://gh.my-website.ccwu.cc/",
  "https://ghfile.geekertao.top/",
  "https://gh.07150721.xyz/",
  "https://gh.monlor.com/",
  "https://ghfast.top/",
  "https://ghproxy.felicity.land/",
  "https://github.tbap.top/",
  "https://gh.sixyin.com/",
  "https://git.yylx.win/",
  "https://free.cn.eu.org/",
  "https://gh.dpik.top/",
  "https://git.669966.xyz/",
  "https://github.ednovas.xyz/",
  "https://ghproxy.net/",
  "https://ghproxy.monkeyray.net/",
  "https://gitproxy.127731.xyz/",
  "https://github.xxlab.tech/",
  "https://g.blfrp.cn/",
];

/** 当前生效的发版版本，用于拼 latest.yml 探测地址。 */
function readCurrentVersion() {
  try {
    return JSON.parse(readFileSync(join(repoRoot, "packages/desktop/package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

/**
 * 确定用哪个 tag 去探测 `latest.yml` 与下载速度。
 *
 * 探测必须针对**已经存在的 release 资产**，否则镜像返回 404，会被误判成
 * 「Range 未生效」→ 全部镜像不合格 → 门禁给出假警报。
 *
 * 关键陷阱（2026-11-23 实际踩到）：本地版本号通常**先于发版**就改好了。
 * 此时包 `0.2.8` 已构建、GitHub 上却只有 `v0.2.7` 的资产，
 * 直接用 `v${本地版本}` 会 404，脚本报「无一家镜像合格」——而镜像其实全是好的。
 * 因此这里先验证本地版本 tag 的资产是否存在，不存在就回退到 atom 里最新的已发布 tag。
 *
 * 可用 `UPDATE_PROBE_TAG` 显式指定，便于刻意探测某个特定版本。
 */
function resolveProbeTag(version) {
  const explicit = process.env.UPDATE_PROBE_TAG?.trim();
  if (explicit) return explicit;

  const localTag = version ? `v${version}` : null;
  if (localTag && hasPublishedAssets(localTag)) return localTag;

  const latestPublished = readLatestPublishedTag();
  if (latestPublished) {
    if (localTag) {
      console.log(
        `  ${localTag} 的 release 资产尚不存在（未发版的版本号），改用已发布的最新 tag ${latestPublished} 探测。`,
      );
    }
    return latestPublished;
  }
  // 两条路都拿不到：退化为只验 atom（与 tag 无关），并在结尾说明。
  return localTag;
}

/** 判断某个 tag 是否已有 release 资产可下（GET latest.yml，跟随重定向，体积仅几百字节）。 */
function hasPublishedAssets(tag) {
  const url = `https://github.com/${FEED_OWNER}/${FEED_REPO}/releases/download/${tag}/latest.yml`;
  // 用 GET 而非 HEAD：GitHub 对 HEAD 的响应头不给最终状态，且 curl 的 -I 会污染 -w 元信息。
  // latest.yml 只有 359 字节量级，代价可忽略。
  const probe = curl(url);
  return probe.code === 200 && probe.size > 0;
}

/**
 * 从 releases.atom 的 XML 文本里取最新的 tag（第一个即最新）。
 *
 * 抽成纯函数便于单测：GitHub atom 里每个 entry 形如
 *   `<link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/v0.2.7"/>`
 * 若 feed 结构异常（没有 tag），返回 null，由调用方退化为只验 atom。
 */
export function parseLatestTagFromAtom(xml) {
  if (!xml || typeof xml !== "string") return null;
  const tags = [...xml.matchAll(/releases\/tag\/([^"<\s]+)/g)].map((m) => m[1]);
  return tags[0] ?? null;
}

/** 从 releases.atom 里取最新的 tag（GitHub 直连，atom 体积小且稳定）。 */
function readLatestPublishedTag() {
  const url = `https://github.com/${FEED_OWNER}/${FEED_REPO}/releases.atom`;
  const probe = curl(url);
  return parseLatestTagFromAtom(probe.body);
}

/** 用 curl 发请求：Node 的 fetch 不走系统代理设置，与 Electron 实际行为不一致。 */
function curl(url, extraArgs = [], timeoutMs = TIMEOUT_MS) {
  const base = [
    "-sS",
    "-L",
    "--noproxy",
    "*",
    "--max-time",
    String(Math.ceil(timeoutMs / 1000)),
    "-o",
    "-",
    "-w",
    "\n__META__%{http_code}|%{size_download}|%{speed_download}|%{time_total}",
  ];
  const argv = [...base, ...extraArgs, url];
  try {
    const out = execFileSync("curl", argv, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs + 5_000,
      // 测速靠 -max-time 主动打断，curl 会把进度打到 stderr。
      // 不抑制会污染输出（每次探测刷一堆 "Operation timed out"），
      // 真正的错误已经通过 exit code 与 -w 的元信息体现。
      stdio: ["ignore", "pipe", "ignore"],
    });
    const markerIndex = out.lastIndexOf("__META__");
    if (markerIndex < 0) return { ok: false, body: out, code: 0 };
    const body = out.slice(0, markerIndex);
    const [code, size, speed, time] = out.slice(markerIndex + 8).trim().split("|");
    return {
      ok: true,
      body,
      code: Number(code),
      size: Number(size),
      speed: Number(speed),
      time: Number(time),
    };
  } catch (error) {
    // 测速场景会故意让 -max-time 打断长下载，curl 以 exit 28 结束并输出已下载部分。
    // 这不是失败：速度指标就在 -w 的输出里。若直接当失败会得到「所有镜像 0 速度」，
    // 排序全部退化为 atom 延迟，失去测速的意义。
    const out = String(error?.stdout ?? "");
    const markerIndex = out.lastIndexOf("__META__");
    if (markerIndex >= 0) {
      const body = out.slice(0, markerIndex);
      const [code, size, speed, time] = out.slice(markerIndex + 8).trim().split("|");
      return {
        ok: true,
        body,
        code: Number(code),
        size: Number(size),
        speed: Number(speed),
        time: Number(time),
        truncated: true,
      };
    }
    return { ok: false, body: "", code: 0, error: String(error?.message ?? error) };
  }
}

/** 判断响应体是否真是 Atom feed（不能只看状态码）。 */
export function looksLikeAtomFeed(body) {
  if (!body || body.length < MIN_ATOM_BYTES) return false;
  return body.includes("<feed") && body.includes("</feed>");
}

/** 判断 latest.yml 是否含必要字段。 */
export function looksLikeLatestYml(body) {
  if (!body) return false;
  return /^version:\s*\S+/m.test(body) && /sha512:/m.test(body);
}

/**
 * 判断 Range 是否被真正尊重。
 *
 * 只看 code 不够：有的镜像回 206 但忽略区间、照样给全量；有的回 200 + 全量。
 * 两者都会让差量下载静默退化为整包（用户只觉得「更新慢」，不会报错），
 * 所以必须同时校验状态码与返回长度。
 */
export function isRangeHonored(code, bytes, requestedBytes) {
  return code === 206 && bytes > 0 && bytes <= requestedBytes;
}

/**
 * 从合格镜像里选出要写进候选列表的那些（用户 2026-11-23 规则）。
 *
 * - 按速度从快到慢排序（速度相同则比 atom 延迟，再相同保持原序）；
 * - 超过 `limit` 取前 `limit`；不足则全部保留（有几个算几个）；
 * - **不包含 GitHub 直连**：直连由回退状态机的 `direct` 级承担，不占候选名额。
 *
 * 抽成纯函数是为了让「数量规则」可单测——这条规则改错会让候选列表要么过多
 * （轮换慢、探测久），要么过少（冗余不足，一家挂了就只剩直连）。
 */
export function selectCandidates(eligible, limit = MAX_MIRROR_CANDIDATES) {
  const sorted = [...eligible].sort((a, b) => {
    if (b.speedBytesPerSec !== a.speedBytesPerSec) {
      return b.speedBytesPerSec - a.speedBytesPerSec;
    }
    return (a.atom?.seconds ?? 99) - (b.atom?.seconds ?? 99);
  });
  return sorted.slice(0, Math.max(0, limit));
}

/**
 * 探测单个镜像。
 *
 * 三项判据并行没有意义（都打同一个站，串行更容易看出是第几步挂的），
 * 因此按「先便宜后贵」的顺序：atom（必须）→ Range（必须）→ latest.yml（必须）→ 测速。
 */
function probeMirror(prefix, probeTag) {
  const trimmed = prefix.trim().replace(/\/+$/, "");
  const base = `${trimmed}/`;
  const result = {
    prefix: base,
    atom: null,
    range: null,
    latestYml: null,
    speedBytesPerSec: 0,
    eligible: false,
    reasons: [],
  };

  const atomUrl = `${base}https://github.com/${FEED_OWNER}/${FEED_REPO}/releases.atom`;
  const atom = curl(atomUrl);
  if (!atom.ok || atom.code !== 200) {
    result.reasons.push(`atom ${atom.code || "失败"}`);
    return result;
  }
  if (!looksLikeAtomFeed(atom.body)) {
    // 这是「假成功」：状态码 200 但内容不是 feed。
    result.reasons.push(`atom 返回 200 但内容非 XML（${atom.body.length}B）`);
    return result;
  }
  result.atom = { bytes: atom.body.length, seconds: atom.time };

  if (!probeTag) {
    // 拿不到 tag 就只能验 atom；Range 与 latest.yml 需要具体资产地址。
    result.reasons.push("缺少探测 tag（设置 UPDATE_PROBE_TAG 可完整探测）");
    return result;
  }

  // Range 探测用 latest.yml 的小体积资产即可：只需验证「是否尊重 Range」，
  // 不必拉 183MB 的安装包（那会让探测慢十几倍）。
  const rangeUrl = `${base}https://github.com/${FEED_OWNER}/${FEED_REPO}/releases/download/${probeTag}/latest.yml`;
  const rangeProbe = curl(rangeUrl, ["-H", "Range: bytes=0-99"]);
  if (!rangeProbe.ok) {
    result.reasons.push("Range 探测失败");
    return result;
  }
  // 关键：必须是 206 且长度约等于请求区间。回 200 + 全量说明镜像忽略了 Range，
  // 差量更新会静默退化为整包下载（不报错，只是很慢）。
  const requestedBytes = 100;
  const honoredRange = isRangeHonored(rangeProbe.code, rangeProbe.size, requestedBytes);
  result.range = { code: rangeProbe.code, bytes: rangeProbe.size };
  if (!honoredRange) {
    result.reasons.push(`Range 未生效（code=${rangeProbe.code}, ${rangeProbe.size}B）`);
    return result;
  }

  const yml = curl(rangeUrl);
  if (!yml.ok || yml.code !== 200 || !looksLikeLatestYml(yml.body)) {
    result.reasons.push(`latest.yml 不可用（code=${yml.code}）`);
    return result;
  }
  result.latestYml = { bytes: yml.body.length, version: yml.body.match(/^version:\s*(\S+)/m)?.[1] };

  // 速度采样：用 latest.yml 这类小文件测不准，改拉安装包前若干秒。
  // 大小未知时只取速度指标，不校验完整性（故意中断）。
  const speedUrl = `${base}https://github.com/${FEED_OWNER}/${FEED_REPO}/releases/download/${probeTag}/RaspberryCode-${probeTag.replace(/^v/, "")}-win-x64.exe`;
  const speed = curl(speedUrl, [], SPEED_SAMPLE_MS);
  result.speedBytesPerSec = speed.ok ? speed.speed : 0;

  result.eligible = true;
  return result;
}

/** 把字节/秒转成易读值。 */
function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "0";
  return `${(bytesPerSec / 1048576).toFixed(2)} MB/s`;
}

async function main() {
  const explicitList = listIndex >= 0 ? (args[listIndex + 1] ?? "").split(",") : null;
  const candidates = explicitList?.length
    ? explicitList.map((s) => s.trim()).filter(Boolean)
    : [...new Set([...BUILTIN_CANDIDATES, ...KNOWN_MIRRORS])];

  const version = readCurrentVersion();
  const probeTag = resolveProbeTag(version);

  if (!jsonOnly) {
    console.log("== 更新镜像探测 ==");
    console.log(`  更新源    ${FEED_OWNER}/${FEED_REPO}`);
    console.log(`  当前版本  ${version ?? "未知"}`);
    console.log(`  探测 tag  ${probeTag ?? "（缺失，仅验 atom）"}`);
    console.log(`  候选数    ${candidates.length}`);
    console.log("");
  }

  const results = [];
  for (const prefix of candidates) {
    const r = probeMirror(prefix, probeTag);
    results.push(r);
    if (!jsonOnly) {
      const mark = r.eligible ? "OK  " : "SKIP";
      const speed = r.eligible ? `  ${formatSpeed(r.speedBytesPerSec)}` : "";
      const why = r.eligible ? "" : `  ${r.reasons.join("; ")}`;
      console.log(`  ${mark}  ${r.prefix}${speed}${why}`);
    }
  }

  // 合格者统一走 selectCandidates：排序与「取前 N」的规则只有一处实现，
  // 避免「输出用 A 规则、写文件用 B 规则」这类漂移。
  const eligible = selectCandidates(
    results.filter((r) => r.eligible),
    Number.MAX_SAFE_INTEGER,
  );

  if (jsonOnly) {
    console.log(
      JSON.stringify(
        {
          version,
          probeTag,
          // 只暴露「将要写进候选列表的那几个」，与代码实际行为一致。
          selected: selectCandidates(eligible),
          eligible,
          all: results,
        },
        null,
        2,
      ),
    );
    process.exit(eligible.length > 0 ? 0 : 1);
  }

  console.log("\n" + "=".repeat(64));
  if (eligible.length === 0) {
    console.log("结论：无一家镜像合格。");
    console.log("  更新链路仍有兜底：回退状态机会降到 `direct`（GitHub 直连），");
    console.log("  最终还有 `manual`（弹窗给「手动下载」）。");
    console.log("  但无代理用户走直连大概率很慢，建议把这版当作「仅直连」发布，");
    console.log("  即把 updateMirrorPrefix 显式设为空串，并在发版说明里告知。");
    process.exit(1);
  }

  const selected = selectCandidates(eligible);
  console.log(`合格 ${eligible.length} 家（按速度排序），取前 ${MAX_MIRROR_CANDIDATES} 个作为候选：\n`);
  eligible.forEach((r, i) => {
    const picked = i < MAX_MIRROR_CANDIDATES ? "→" : " ";
    console.log(
      `  ${picked} ${i + 1}. ${r.prefix}  ${formatSpeed(r.speedBytesPerSec)}  atom ${r.atom.bytes}B/${r.atom.seconds.toFixed(2)}s`,
    );
  });
  if (eligible.length < MAX_MIRROR_CANDIDATES) {
    console.log(
      `\n  合格数不足 ${MAX_MIRROR_CANDIDATES} 个，按实际 ${eligible.length} 个写入（有几个算几个）。`,
    );
  }

  // 候选的事实源在 shared，不在 desktop：客户端自更新与远程资产下载共用这份列表
  // （两者是两个包、两个进程、两套网络栈，代码不能复用，只能共用常量）。
  // 历史上这里写的是 updateMirror.ts，候选上移后必须同步改，否则会把发版人引到错的文件。
  console.log(
    "\n可粘贴到 packages/shared/src/client-update/contract.ts 的候选列表：" +
      "（客户端自更新与远程资产下载共用此常量）\n",
  );
  console.log("export const DEFAULT_UPDATE_MIRROR_CANDIDATES: readonly string[] = [");
  for (const r of selected) {
    console.log(`  "${r.prefix}",`);
  }
  console.log("];");
  console.log("\n改完需要重新编译（候选是编译期常量，不是运行时配置）：");
  console.log("  pnpm --dir packages/desktop run build");
  console.log("\n兜底顺序（由回退状态机自动执行，无需在此列出）：");
  console.log(`  候选镜像 ${selected.length} 家依次轮换 → direct（GitHub 直连）→ manual（手动下载）`);

  if (doWrite) {
    // 写成 setting 片段而非直接改源码：改源码属于发版决策，应人工确认后提交。
    const snippetPath = join(repoRoot, "packages/desktop/out/metadata/update-mirror-candidates.json");
    try {
      writeFileSync(
        snippetPath,
        `${JSON.stringify(
          {
            probeTag,
            generatedAt: new Date().toISOString(),
            // 只写入选的 3 个：与「粘贴到代码里的列表」保持一致，
            // 避免使用者误把全部合格镜像都填进候选。
            candidates: selected.map((r) => r.prefix),
            eligibleCount: eligible.length,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      console.log(`\n已写入 ${snippetPath}`);
    } catch (error) {
      console.log(`\n写入失败（不影响探测结论）：${String(error?.message ?? error)}`);
    }
  }

  process.exit(0);
}

// 仅在作为入口直接执行时跑探测；被测试 import 时只暴露纯函数，不发网络请求。
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
