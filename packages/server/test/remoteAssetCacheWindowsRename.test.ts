import { createHash } from "node:crypto";
import * as realFsPromises from "node:fs/promises";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RASPBERRYCODE_VERSION } from "@raspberrycode/shared";
import { createTarGzArchive } from "@raspberrycode/server/remote/localTarGz.js";

function remoteAssetRenameEperm(): NodeJS.ErrnoException {
  const error = new Error("operation not permitted, rename") as NodeJS.ErrnoException;
  error.code = "EPERM";
  error.errno = -4048;
  error.syscall = "rename";
  return error;
}

async function writeComponentArchive(options: {
  sourceRoot: string;
  cdnRoot: string;
  platformArch: string;
  id: string;
  version: string;
  mount: string;
  artifactPath: string;
}): Promise<string> {
  const archivePath = join(options.cdnRoot, options.artifactPath);
  const sourcePath = join(options.sourceRoot, ...options.mount.split("/"));
  const entries = await readdir(sourcePath);
  await createTarGzArchive(
    archivePath,
    entries.map((entry) => ({
      sourcePath: join(sourcePath, entry),
      archivePath: entry,
    })),
  );
  return createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
}

describe("remote asset cache Windows directory commit", () => {
  afterEach(async () => {
    vi.doUnmock("node:fs/promises");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("retries transient EPERM while committing a staged release component directory", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "raspberrycode-remote-cache-rename-"));
    const sourceRoot = join(rootDir, "source");
    const cdnRoot = join(rootDir, "cdn", RASPBERRYCODE_VERSION);
    const remoteCacheDir = join(rootDir, "remote-cache");
    const platformArch = "linux-x64";
    const failedRenameTargets: string[] = [];

    try {
      await mkdir(join(sourceRoot, "server"), { recursive: true });
      await mkdir(join(sourceRoot, "node", platformArch), { recursive: true });
      await mkdir(join(sourceRoot, "agent", platformArch), { recursive: true });
      await writeFile(join(sourceRoot, "server", "raspberrycode-server.cjs"), "server", "utf8");
      await writeFile(join(sourceRoot, "node", platformArch, "node"), "node", "utf8");
      await writeFile(join(sourceRoot, "agent", platformArch, "raspberrycode-agent"), "agent", "utf8");

      const components = [
        {
          id: "server-bundle",
          version: `${RASPBERRYCODE_VERSION}-server-bundle`,
          artifactPath: `components/${platformArch}/server-bundle.tar.gz`,
          mount: "server",
        },
        {
          id: "node-runtime",
          version: "24.10.0-node-runtime",
          artifactPath: `components/${platformArch}/node-runtime.tar.gz`,
          mount: `node/${platformArch}`,
        },
        {
          id: "agent",
          version: "3.1.2-agent",
          artifactPath: `components/${platformArch}/agent.tar.gz`,
          mount: `agent/${platformArch}`,
        },
      ];
      const manifestComponents = [];
      for (const component of components) {
        manifestComponents.push({
          ...component,
          sha256: await writeComponentArchive({
            sourceRoot,
            cdnRoot,
            platformArch,
            ...component,
          }),
        });
      }
      const agentSha256 = manifestComponents.find((component) => component.id === "agent")?.sha256;
      if (!agentSha256) {
        throw new Error("missing agent component SHA");
      }
      await writeFile(
        join(cdnRoot, `manifest-${platformArch}.json`),
        JSON.stringify(
          {
            schemaVersion: 1,
            appVersion: RASPBERRYCODE_VERSION,
            platformArch,
            components: manifestComponents,
          },
          null,
          2,
        ),
        "utf8",
      );

      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof realFsPromises>("node:fs/promises");
        let failedGlmReleaseCommit = false;
        return {
          ...actual,
          rename: vi.fn(async (from: string, to: string) => {
            const normalizedTo = normalize(to);
            if (
              !failedGlmReleaseCommit &&
              normalizedTo.endsWith(normalize(join("agent", platformArch)))
            ) {
              failedGlmReleaseCommit = true;
              failedRenameTargets.push(normalizedTo);
              throw remoteAssetRenameEperm();
            }
            return actual.rename(from, to);
          }),
        };
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (!url.startsWith("file:")) {
            return new Response(null, { status: 404 });
          }
          try {
            const body = await readFile(fileURLToPath(url));
            return new Response(body, {
              status: 200,
              headers: { "content-length": String(body.byteLength) },
            });
          } catch {
            return new Response(null, { status: 404 });
          }
        }),
      );

      const { ensureRemoteReleaseDirFromCdn } =
        await import("@raspberrycode/server/remote/remoteAssetCache.js");
      const releaseDir = await ensureRemoteReleaseDirFromCdn(
        {
          remoteCdnBaseUrl: pathToFileURL(join(rootDir, "cdn")).href,
          remoteCacheDir,
          version: RASPBERRYCODE_VERSION,
          platformArch,
        },
        { log: () => undefined, logWarn: () => undefined },
      );

      expect(releaseDir).toBe(
        join(remoteCacheDir, "releases", RASPBERRYCODE_VERSION, platformArch, "agent-content", agentSha256),
      );
      expect(failedRenameTargets).toHaveLength(1);
      await expect(
        readFile(join(releaseDir, "agent", platformArch, "raspberrycode-agent"), "utf8"),
      ).resolves.toBe("agent");
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });
});
