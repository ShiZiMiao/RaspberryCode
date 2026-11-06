// B5 实机验收冒烟：对真实 WSL / Docker 后端跑 Source Server 部署链
// （probe → 发布物校验 → installOrUpdate → ensureDaemon → exec 验证）。
// 需真实外部环境，不进 CI；用法：
//   node scripts/remote-backend-smoke.mjs wsl
//   node scripts/remote-backend-smoke.mjs docker <container-name>
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSourceServerTransportAdapter } from "../packages/server/dist/source-server/transportAdapter.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(repoRoot, "packages/desktop/mock-cdn/releases/0.1.0");

const ARCH_ALIASES = { x86_64: "x64", amd64: "x64", aarch64: "arm64" };

async function loadReleaseEntry(probe) {
  const arch = ARCH_ALIASES[probe.arch] ?? probe.arch;
  const targetId = `${probe.platform}-${arch}`;
  const descriptor = JSON.parse(
    await readFile(resolve(releaseDir, "source-server-release.json"), "utf8"),
  );
  const entry = descriptor.archives.find((item) => item.target === targetId);
  if (!entry) throw new Error(`descriptor 缺少 ${targetId} 归档（probe: ${probe.platform}/${probe.arch}）`);
  const localArchivePath = resolve(releaseDir, entry.fileName);
  const bytes = await readFile(localArchivePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== entry.sha256) throw new Error(`${entry.fileName} sha256 不匹配 descriptor`);
  console.log(`  [release] ${entry.fileName} sha256 ✓ sizeBytes=${entry.sizeBytes}`);
  return { ...entry, localArchivePath };
}

async function smoke(kind, target, label) {
  console.log(`\n=== ${label} (${kind}) ===`);
  const adapter = createSourceServerTransportAdapter(kind);
  const context = {
    onLog: ({ phase, message }) => console.log(`  [${phase}] ${message}`),
  };

  const probe = await adapter.probe(target, context);
  console.log(
    `  [probe] platform=${probe.platform} arch=${probe.arch} installed=${probe.installed}` +
      ` version=${probe.installedVersion ?? "-"} daemon=${probe.daemonStatus?.state ?? "-"}`,
  );

  const release = await loadReleaseEntry(probe);
  await adapter.installOrUpdate(
    target,
    {
      localArchivePath: release.localArchivePath,
      target: release.target,
      version: release.version,
      sha256: release.sha256,
      sizeBytes: release.sizeBytes,
      urls: release.urls,
    },
    context,
    { force: true },
  );
  console.log("  [install] installOrUpdate 完成");

  const ingress = await adapter.ensureDaemon(target, context, {
    observedStatus: probe.daemonStatus,
  });
  console.log(`  [daemon] port=${ingress.port} token=${ingress.ingressToken.slice(0, 8)}…`);

  for (const argv of [["version"], ["status"]]) {
    const result = await adapter.exec(target, argv, context);
    const output = (result.stdout ?? "").trim().split("\n").slice(0, 2).join(" | ");
    console.log(`  [exec ${argv[0]}] exit=${result.exitCode} ${output}`);
    if (result.exitCode !== 0) throw new Error(`exec ${argv[0]} 失败：${result.stderr}`);
  }
  console.log(`=== ${label} PASS ===`);
}

const mode = process.argv[2];
if (mode === "wsl") {
  await smoke("wsl", { kind: "wsl", distro: "Ubuntu" }, "B5-WSL");
} else if (mode === "docker") {
  await smoke("docker", { kind: "docker", container: process.argv[3] ?? "rc-b5-smoke" }, "B5-Docker");
} else {
  console.error("usage: node scripts/remote-backend-smoke.mjs wsl | docker <container>");
  process.exit(2);
}
