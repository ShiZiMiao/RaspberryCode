import { access, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createDaemonServiceDescriptor,
  serviceDescriptorPath,
  unregisterService,
  type ServicePlatform,
} from "../platform/serviceManager.js";
import { resolveCanonicalServerRoot, type ServerLayout } from "./paths.js";

export async function unregisterInstalledService(layout: ServerLayout): Promise<void> {
  const platform = currentServicePlatform();
  const descriptor = createDaemonServiceDescriptor({ platform, layout });
  const descriptorPath = serviceDescriptorPath(layout, descriptor);
  // 卸载先解除 OS 服务注册，再清理 descriptor/data root；否则 systemd/launchd 可能
  // 在目录删除后继续拉起一个找不到 runtime 的孤儿服务。
  if (await pathExists(descriptorPath)) await unregisterService(descriptor, descriptorPath);
  await unregisterStaleServiceRegistrations(layout, platform, descriptorPath);
}

/**
 * 注册/卸载前收口同 root 的陈旧注册（旧 stablePathId 别名、旧 kind.service 条目）：
 * 一个 server root 只允许一个 OS 服务。旧注册按内容归属识别，先注销再以当前名字注册/删除，
 * 避免同一 root 出现双服务互踩。
 */
export async function unregisterStaleServiceRegistrations(
  layout: ServerLayout,
  platform: ServicePlatform,
  currentDescriptorPath: string,
): Promise<void> {
  await unregisterRootScopedAliasServices(layout, platform, currentDescriptorPath);
}

function currentServicePlatform(): ServicePlatform {
  return process.platform === "darwin" || process.platform === "linux" ? process.platform : "win32";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function unregisterRootScopedAliasServices(
  layout: ServerLayout,
  platform: ServicePlatform,
  currentDescriptorPath: string,
): Promise<void> {
  // 过去只按当前拼写的 stablePathId 卸载 descriptor，root 别名留下的旧注册会
  // 在卸载后继续被 launchd/systemd 拉起。扫描同一 service 目录并按 canonical root 比对。
  const extension = platform === "darwin" ? ".plist" : platform === "linux" ? ".service" : ".json";
  const legacyEntry =
    platform === "darwin"
      ? "launchd.service"
      : platform === "linux"
        ? "systemd.service"
        : "task-scheduler.service";
  let entries: string[];
  try {
    entries = await readdir(layout.serviceDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const descriptorPath = join(layout.serviceDir, entry);
    if (
      descriptorPath === currentDescriptorPath ||
      entry === legacyEntry ||
      !entry.endsWith(extension)
    )
      continue;
    const content = await readFile(descriptorPath, "utf8").catch(() => null);
    if (!content) continue;
    const declaredRoot = extractServerRoot(content, platform);
    if (!declaredRoot) continue;
    let belongs = false;
    try {
      belongs = (await resolveCanonicalServerRoot(declaredRoot)) === layout.serverRoot;
    } catch {
      continue;
    }
    if (!belongs) continue;
    const name = descriptorNameFromContent(content, platform, entry);
    if (!name) continue;
    await unregisterService(
      {
        kind:
          platform === "darwin" ? "launchd" : platform === "linux" ? "systemd" : "task-scheduler",
        name,
        content,
      },
      descriptorPath,
    );
    await rm(descriptorPath, { force: true });
  }
}

function extractServerRoot(content: string, platform: ServicePlatform): string | null {
  if (platform === "win32") {
    try {
      const parsed = JSON.parse(content) as { args?: unknown };
      if (!Array.isArray(parsed.args)) return null;
      const index = parsed.args.indexOf("--server-root");
      return typeof parsed.args[index + 1] === "string" ? parsed.args[index + 1] : null;
    } catch {
      return null;
    }
  }
  const match =
    platform === "darwin"
      ? content.match(/<string>--server-root<\/string><string>([^<]+)<\/string>/u)
      : content.match(/'--server-root'\s+'((?:[^']|'\\'\\'\\'')*)'/u);
  return match?.[1]?.replaceAll("'\\''", "'") ?? null;
}

function descriptorNameFromContent(
  content: string,
  platform: ServicePlatform,
  entry: string,
): string | null {
  if (platform === "darwin")
    return content.match(/<key>Label<\/key><string>([^<]+)<\/string>/u)?.[1] ?? null;
  if (platform === "win32") {
    try {
      const parsed = JSON.parse(content) as { taskName?: unknown };
      return typeof parsed.taskName === "string" ? parsed.taskName : null;
    } catch {
      return null;
    }
  }
  return entry.endsWith(".service") ? entry.slice(0, -".service".length) : null;
}

export function serviceDescriptorBelongsToRoot(
  content: string,
  platform: ServicePlatform,
  serverRoot: string,
): boolean {
  if (platform === "win32") {
    try {
      const parsed = JSON.parse(content) as { args?: unknown };
      if (!Array.isArray(parsed.args)) return false;
      const index = parsed.args.indexOf("--server-root");
      return index >= 0 && parsed.args[index + 1] === serverRoot;
    } catch {
      return false;
    }
  }
  const encodedRoot =
    platform === "darwin"
      ? serverRoot
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
      : `'${serverRoot.replaceAll("'", "'\\''")}'`;
  return platform === "darwin"
    ? content.includes(`<string>--server-root</string><string>${encodedRoot}</string>`)
    : content.includes(`'--server-root' ${encodedRoot}`);
}
