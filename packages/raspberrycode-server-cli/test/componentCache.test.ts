import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ComponentCache, extractArchiveSafely } from "../src/runtime/componentCache.js";
import { resolveServerLayout } from "../src/runtime/paths.js";

async function archiveSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

describe("component cache", () => {
  // Windows 宿主的 chmod 是空操作、stat 也不表达执行位，mode 断言只能在 POSIX 宿主验证；
  // Windows 上被测行为的真实验证走 SSH 远端安装链（实机验收 B）。
  it.skipIf(process.platform === "win32")(
    "解压后按魔数恢复执行位（Windows 宿主打包的归档丢执行位）",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "raspberrycode-extract-modes-"));
      const source = join(root, "source");
      await mkdir(join(source, "bin"), { recursive: true });
      await mkdir(join(source, "runtime"), { recursive: true });
      await writeFile(join(source, "bin", "launcher"), "#!/bin/sh\nexit 0\n", { mode: 0o644 });
      await writeFile(join(source, "runtime", "node"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]), {
        mode: 0o644,
      });
      await writeFile(join(source, "runtime", "data.txt"), "plain", { mode: 0o644 });
      const archive = join(root, "archive.tar.gz");
      const { execFile } = await import("node:child_process");
      await new Promise<void>((resolve, reject) =>
        execFile("tar", ["-czf", archive, "."], { cwd: source }, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      const destination = join(root, "out");
      await mkdir(destination, { recursive: true });
      await extractArchiveSafely(archive, destination);

      const execBits = async (path: string) => (await stat(path)).mode & 0o111;
      await expect(execBits(join(destination, "bin", "launcher"))).resolves.not.toBe(0);
      await expect(execBits(join(destination, "runtime", "node"))).resolves.not.toBe(0);
      await expect(execBits(join(destination, "runtime", "data.txt"))).resolves.toBe(0);
    },
  );

  it("reuses a content-addressed component and assembles an atomic release directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-component-cache-"));
    const layout = resolveServerLayout(join(root, "server"));
    const base = join(root, "base");
    await mkdir(join(base, "runtime"), { recursive: true });
    await writeFile(join(base, "runtime", "server-core.js"), "old", "utf8");
    const componentRoot = join(root, "component");
    await mkdir(join(componentRoot, "runtime"), { recursive: true });
    await writeFile(join(componentRoot, "runtime", "server-core.js"), "new", "utf8");
    const archive = join(root, "component.tar.gz");
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => execFile("tar", ["-czf", archive, "."], { cwd: componentRoot }, (error) => error ? reject(error) : resolve()));
    const cache = new ComponentCache(layout);
    const cached = await cache.putArchive({ target: "linux-x64", componentId: "server-runtime", sha256: "a".repeat(64), archivePath: archive, archiveSha256: await archiveSha256(archive) });
    await expect(cache.findArchive({ target: "linux-x64", componentId: "server-runtime", sha256: "a".repeat(64) })).resolves.toBe(cached);
    expect(cached).toContain("server-runtime");
    const release = join(root, "release");
    await cache.assemble({ target: "linux-x64", archiveSha256: "0".repeat(64), baseReleaseDir: base, releaseDir: release, runtimeManifest: { product: "raspberrycode-server", target: "linux-x64", appVersion: "2.0.0", nodeVersion: "22.16.0", entrypoints: { cli: "runtime/server-cli.js", core: "runtime/server-core.js", agent: "runtime/raspberrycode.cjs" }, native: ["node-pty"] }, changed: [{ componentId: "server-runtime", sha256: "a".repeat(64), archivePath: cached }] });
    await expect(readFile(join(release, "runtime", "server-core.js"), "utf8")).resolves.toBe("new");
  });

  it("validates component content before publishing the assembled release", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-component-integrity-"));
    const layout = resolveServerLayout(join(root, "server"));
    const base = join(root, "base");
    await mkdir(join(base, "runtime"), { recursive: true });
    await writeFile(join(base, "runtime", "server-core.js"), "old", "utf8");
    const componentRoot = join(root, "component");
    await mkdir(join(componentRoot, "runtime"), { recursive: true });
    await writeFile(join(componentRoot, "runtime", "server-core.js"), "new", "utf8");
    const archive = join(root, "component.tar.gz");
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => execFile("tar", ["-czf", archive, "."], { cwd: componentRoot }, (error) => error ? reject(error) : resolve()));
    const cache = new ComponentCache(layout);
    const cached = await cache.putArchive({ target: "linux-x64", componentId: "server-runtime", sha256: "b".repeat(64), archivePath: archive, archiveSha256: await archiveSha256(archive) });
    const contentSha = createHash("sha256").update("runtime/server-core.js\0").update("new").digest("hex");
    const release = join(root, "release");
    await cache.assemble({
      target: "linux-x64",
      archiveSha256: "0".repeat(64),
      baseReleaseDir: base,
      releaseDir: release,
      runtimeManifest: {
        product: "raspberrycode-server",
        target: "linux-x64",
        appVersion: "2.0.0",
        nodeVersion: "22.16.0",
        entrypoints: { cli: "runtime/server-cli.js", core: "runtime/server-core.js", agent: "runtime/raspberrycode.cjs" },
        native: ["node-pty"],
        components: [{ id: "server-runtime", sha256: contentSha, paths: ["runtime/server-core.js"], sizeBytes: 3 }],
      },
      changed: [{ componentId: "server-runtime", sha256: "b".repeat(64), archivePath: cached }],
    });
    await expect(readFile(join(release, "runtime", "server-core.js"), "utf8")).resolves.toBe("new");

    const badRelease = join(root, "bad-release");
    await expect(cache.assemble({
      target: "linux-x64",
      archiveSha256: "0".repeat(64),
      baseReleaseDir: base,
      releaseDir: badRelease,
      runtimeManifest: {
        product: "raspberrycode-server",
        target: "linux-x64",
        appVersion: "2.0.0",
        nodeVersion: "22.16.0",
        entrypoints: { cli: "runtime/server-cli.js", core: "runtime/server-core.js", agent: "runtime/raspberrycode.cjs" },
        native: ["node-pty"],
        components: [{ id: "server-runtime", sha256: "c".repeat(64), paths: ["runtime/server-core.js"], sizeBytes: 3 }],
      },
      changed: [{ componentId: "server-runtime", sha256: "b".repeat(64), archivePath: cached }],
    })).rejects.toThrow("Component content checksum mismatch");
    await expect(access(badRelease)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reuses an identical immutable release without moving or overwriting the target", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-component-immutable-"));
    const layout = resolveServerLayout(join(root, "server"));
    const base = join(root, "base");
    await mkdir(join(base, "runtime"), { recursive: true });
    await writeFile(join(base, "runtime", "server-core.js"), "old", "utf8");
    const componentRoot = join(root, "component");
    await mkdir(join(componentRoot, "runtime"), { recursive: true });
    await writeFile(join(componentRoot, "runtime", "server-core.js"), "new", "utf8");
    const archive = join(root, "component.tar.gz");
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) =>
      execFile("tar", ["-czf", archive, "."], { cwd: componentRoot }, (error) => (error ? reject(error) : resolve())),
    );
    const cache = new ComponentCache(layout);
    const cached = await cache.putArchive({
      target: "linux-x64",
      componentId: "server-runtime",
      sha256: "f".repeat(64),
      archivePath: archive,
      archiveSha256: await archiveSha256(archive),
    });
    const contentSha = createHash("sha256").update("runtime/server-core.js\0").update("new").digest("hex");
    const release = join(root, "release");
    const assembleOptions = {
      target: "linux-x64",
      archiveSha256: "1".repeat(64),
      baseReleaseDir: base,
      releaseDir: release,
      runtimeManifest: {
        product: "raspberrycode-server" as const,
        target: "linux-x64" as const,
        appVersion: "2.0.0",
        nodeVersion: "22.16.0",
        entrypoints: { cli: "runtime/server-cli.js", core: "runtime/server-core.js", agent: "runtime/raspberrycode.cjs" },
        native: ["node-pty"],
        components: [{ id: "server-runtime", sha256: contentSha, paths: ["runtime/server-core.js"], sizeBytes: 3 }],
      },
      changed: [{ componentId: "server-runtime", sha256: "f".repeat(64), archivePath: cached }],
    };

    await cache.assemble(assembleOptions);
    const originalInode = (await stat(release)).ino;
    await cache.assemble(assembleOptions);
    expect((await stat(release)).ino).toBe(originalInode);
    await expect(readFile(join(release, "runtime", "server-core.js"), "utf8")).resolves.toBe("new");

    await writeFile(join(release, "runtime", "server-core.js"), "tampered", "utf8");
    await expect(cache.assemble(assembleOptions)).rejects.toThrow(/immutable release conflict/i);
    await expect(readFile(join(release, "runtime", "server-core.js"), "utf8")).resolves.toBe("tampered");
  });

  it("ignores a cache entry whose archive bytes no longer match its marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-component-cache-integrity-"));
    const layout = resolveServerLayout(join(root, "server"));
    const componentRoot = join(root, "component");
    await mkdir(componentRoot, { recursive: true });
    await writeFile(join(componentRoot, "marker.txt"), "component", "utf8");
    const archive = join(root, "component.tar.gz");
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) =>
      execFile("tar", ["-czf", archive, "."], { cwd: componentRoot }, (error) => (error ? reject(error) : resolve())),
    );
    const cache = new ComponentCache(layout);
    const cached = await cache.putArchive({
      target: "linux-x64",
      componentId: "server-runtime",
      sha256: "e".repeat(64),
      archivePath: archive,
      archiveSha256: await archiveSha256(archive),
    });
    await writeFile(cached, "corrupted", "utf8");
    await expect(
      cache.findArchive({ target: "linux-x64", componentId: "server-runtime", sha256: "e".repeat(64) }),
    ).resolves.toBeNull();
  });

  // Bugfix: Windows 普通用户无 symlink 权限，junction 会被 bsdtar 归档成普通目录
  // （不产生 POSIX symlink 条目），无法在归档内构造出待拒绝的符号链接场景，仅 POSIX 宿主运行。
  it.skipIf(process.platform === "win32")("rejects symbolic links in component archives before extraction", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-component-link-"));
    const layout = resolveServerLayout(join(root, "server"));
    const base = join(root, "base");
    await mkdir(base, { recursive: true });
    const componentRoot = join(root, "component");
    await mkdir(componentRoot, { recursive: true });
    const outsideTarget = join(root, "outside-target");
    await mkdir(outsideTarget);
    await symlink(outsideTarget, join(componentRoot, "runtime"), process.platform === "win32" ? "junction" : "dir");
    const archive = join(root, "component.tar.gz");
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => execFile("tar", ["-czf", archive, "."], { cwd: componentRoot }, (error) => error ? reject(error) : resolve()));
    const cache = new ComponentCache(layout);
    const cached = await cache.putArchive({ target: "linux-x64", componentId: "server-runtime", sha256: "d".repeat(64), archivePath: archive, archiveSha256: await archiveSha256(archive) });
    await expect(cache.assemble({
      target: "linux-x64",
      archiveSha256: "0".repeat(64),
      baseReleaseDir: base,
      releaseDir: join(root, "release"),
      runtimeManifest: { product: "raspberrycode-server", target: "linux-x64", appVersion: "2.0.0", nodeVersion: "22.16.0", entrypoints: { cli: "runtime/server-cli.js", core: "runtime/server-core.js", agent: "runtime/raspberrycode.cjs" }, native: ["node-pty"] },
      changed: [{ componentId: "server-runtime", sha256: "d".repeat(64), archivePath: cached }],
    })).rejects.toThrow(/symbolic|hard link/i);
  });

  it("removes files belonging to components removed from the new manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "raspberrycode-component-remove-"));
    const layout = resolveServerLayout(join(root, "server"));
    const base = join(root, "base");
    await mkdir(join(base, "runtime", "packages", "legacy-plugin"), { recursive: true });
    await writeFile(join(base, "runtime", "packages", "legacy-plugin", "README.md"), "legacy", "utf8");

    const cache = new ComponentCache(layout);
    const release = join(root, "release");
    await cache.assemble({
      target: "linux-x64",
      archiveSha256: "0".repeat(64),
      baseReleaseDir: base,
      releaseDir: release,
      baseComponents: [{ id: "official-plugins", sha256: "a".repeat(64), paths: ["runtime/packages"], sizeBytes: 6 }],
      runtimeManifest: {
        product: "raspberrycode-server",
        target: "linux-x64",
        appVersion: "2.0.0",
        nodeVersion: "22.16.0",
        entrypoints: { cli: "runtime/server-cli.js", core: "runtime/server-core.js", agent: "runtime/raspberrycode.cjs" },
        native: ["node-pty"],
        components: [],
      },
      changed: [],
    });

    await expect(access(join(release, "runtime", "packages", "legacy-plugin", "README.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
