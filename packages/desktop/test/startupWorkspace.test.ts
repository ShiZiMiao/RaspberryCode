import { readFile, stat, writeFile } from "node:fs/promises";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOpenWorkspaceStartupBootstrap,
  resolveStartupWindowBootstrap,
} from "../src/main/startupWorkspace.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("startup workspace", () => {
  it("新版 main 只预热活动 cwd，不读旧会话列表或 recent 项目", async () => {
    const root = makeTempDir("raspberrycode-startup-active-");
    const selected = join(root, "selected");
    mkdirSync(selected);
    const settingsFile = join(root, "setting.json");
    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        lastActiveWorkspace: {
          kind: "local",
          workspacePath: selected,
          workspacePurpose: "conversation",
        },
        lastWorkspaceSession: [{ kind: "local", workspacePath: "/deleted" }],
        recentProjects: ["/legacy-recent"],
      }),
    );
    expect(
      await resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir: join(root, "default"),
      }),
    ).toEqual({
      agentWarmupTargets: [{ workspacePath: selected }],
    });
  });
  it("open-workspace 冷启动目录同时作为首窗初始 workspace 和 agent 预热目标", () => {
    expect(createOpenWorkspaceStartupBootstrap("C:\\Users\\demo\\Project A")).toEqual({
      initialWorkspacePath: "C:\\Users\\demo\\Project A",
      initialWorkspacePurpose: "project",
      agentWarmupTargets: [{ workspacePath: "C:\\Users\\demo\\Project A" }],
    });
  });

  it("有可恢复会话时不覆盖成默认项目", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");
    const workspaceDir = join(rootDir, "workspace-a");
    mkdirSync(workspaceDir);

    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        recentProjects: [workspaceDir],
        locale: "zh-CN",
        lastWorkspaceSession: [
          {
            kind: "local",
            workspacePath: workspaceDir,
          },
        ],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }).then((bootstrap) => bootstrap.initialWorkspacePath),
    ).resolves.toBeUndefined();
    expect(existsSync(conversationWorkspaceDir)).toBe(false);
  });

  it("有本地可恢复会话时返回 active workspace 作为 agent 预热目标", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");
    const workspaceA = join(rootDir, "workspace-a");
    const workspaceB = join(rootDir, "workspace-b");
    mkdirSync(workspaceA);
    mkdirSync(workspaceB);

    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        recentProjects: [workspaceA, workspaceB],
        locale: "zh-CN",
        lastWorkspaceSession: [
          {
            kind: "local",
            workspacePath: workspaceA,
          },
          {
            kind: "local",
            workspacePath: workspaceB,
          },
        ],
        lastActiveTabIndex: 1,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }),
    ).resolves.toEqual({
      agentWarmupTargets: [{ workspacePath: workspaceB }],
    });
    expect(existsSync(conversationWorkspaceDir)).toBe(false);
  });

  it("active 会话是远端但前面有本地 workspace 时预热本地 workspace", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        recentProjects: ["/tmp/workspace-a"],
        locale: "zh-CN",
        lastWorkspaceSession: [
          {
            kind: "local",
            workspacePath: "/tmp/workspace-a",
          },
          {
            kind: "remote",
            workspacePath: "/repo/app",
            workspaceIdentity: "remote:ssh:dev:/repo/app",
            target: {
              kind: "ssh",
              host: "dev",
              username: "dev",
            },
            lastOpenedAt: 1,
            lastConnectionStatus: "connected",
          },
        ],
        lastActiveTabIndex: 1,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }),
    ).resolves.toEqual({
      agentWarmupTargets: [{ workspacePath: "/tmp/workspace-a" }],
    });
  });

  it("active 会话是远端但后面有本地 workspace 时预热本地 workspace", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        recentProjects: ["/tmp/workspace-a"],
        locale: "zh-CN",
        lastWorkspaceSession: [
          {
            kind: "remote",
            workspacePath: "/repo/app",
            workspaceIdentity: "remote:ssh:dev:/repo/app",
            target: {
              kind: "ssh",
              host: "dev",
              username: "dev",
            },
            lastOpenedAt: 1,
            lastConnectionStatus: "connected",
          },
          {
            kind: "local",
            workspacePath: "/tmp/workspace-a",
          },
        ],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }),
    ).resolves.toEqual({
      agentWarmupTargets: [{ workspacePath: "/tmp/workspace-a" }],
    });
  });

  it("active 本地 workspace 不存在时保留原路径并创建 agent cwd 兜底目录", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");
    const missingWorkspace = join(rootDir, "moved-workspace");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        lastWorkspaceSession: [{ kind: "local", workspacePath: missingWorkspace }],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).resolves.toEqual({
      unavailableWorkspacePath: missingWorkspace,
      agentWarmupTargets: [{ workspacePath: missingWorkspace }],
    });
    expect(existsSync(conversationWorkspaceDir)).toBe(true);
    expect(existsSync(missingWorkspace)).toBe(false);
  });

  it("active 本地 workspace 变成文件时按不可用目录处理", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");
    const workspaceFile = join(rootDir, "workspace-file");
    writeFileSync(workspaceFile, "not-a-directory", "utf-8");
    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        lastWorkspaceSession: [{ kind: "local", workspacePath: workspaceFile }],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).resolves.toEqual({
      unavailableWorkspacePath: workspaceFile,
      agentWarmupTargets: [{ workspacePath: workspaceFile }],
    });
    expect(existsSync(conversationWorkspaceDir)).toBe(true);
  });

  it.runIf(process.platform !== "win32" && process.getuid?.() !== 0)(
    "active 本地 workspace 无法访问时按不可用目录处理",
    async () => {
      const rootDir = makeTempDir("raspberrycode-startup-workspace-");
      const settingsFile = join(rootDir, "setting.json");
      const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");
      const inaccessibleWorkspace = join(rootDir, "inaccessible-workspace");
      mkdirSync(inaccessibleWorkspace);
      chmodSync(inaccessibleWorkspace, 0o000);
      writeFileSync(
        settingsFile,
        JSON.stringify({
          // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
          startupShowHome: false,
          lastWorkspaceSession: [{ kind: "local", workspacePath: inaccessibleWorkspace }],
          lastActiveTabIndex: 0,
        }),
        "utf-8",
      );

      try {
        await expect(
          resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
        ).resolves.toEqual({
          unavailableWorkspacePath: inaccessibleWorkspace,
          agentWarmupTargets: [{ workspacePath: inaccessibleWorkspace }],
        });
        expect(existsSync(conversationWorkspaceDir)).toBe(true);
      } finally {
        chmodSync(inaccessibleWorkspace, 0o700);
      }
    },
  );

  it.each(["active", "legacy"])(
    "远程活动项（%s）先准备本机存储 cwd，保持远程导航且不创建远程项目路径",
    async (format) => {
      const rootDir = makeTempDir("raspberrycode-startup-remote-");
      const settingsFile = join(rootDir, "setting.json");
      const conversationWorkspaceDir = join(rootDir, "new-data", ".raspberrycode", "workspace", "default");
      const remotePath = join(rootDir, "remote-only-project");
      const entry = {
        kind: "remote",
        workspacePath: remotePath,
        workspaceIdentity: `remote:server:source-1:${remotePath}`,
        target: { kind: "ssh", host: "dev.example.com", username: "dev" },
        lastOpenedAt: 1,
        lastConnectionStatus: "connected",
      };
      await writeFile(
        settingsFile,
        JSON.stringify(
          format === "active"
            ? { startupShowHome: false, lastActiveWorkspace: entry }
            : { startupShowHome: false, lastWorkspaceSession: [entry], lastActiveTabIndex: 0 },
        ),
      );
      await expect(
        resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
      ).resolves.toEqual({});
      expect((await stat(conversationWorkspaceDir)).isDirectory()).toBe(true);
      await expect(stat(remotePath)).rejects.toMatchObject({ code: "ENOENT" });
      // 目录准备是幂等的，不覆盖既有文件，也不把备用 cwd 变成活动项目。
      const canary = join(conversationWorkspaceDir, "keep.txt");
      await writeFile(canary, "existing data");
      await expect(
        resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
      ).resolves.toEqual({});
      expect(await readFile(canary, "utf8")).toBe("existing data");
    },
  );

  it("远程活动项的存储 cwd 无法创建时明确失败，不返回虚假的启动就绪", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-remote-blocked-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, "default");
    await writeFile(conversationWorkspaceDir, "existing file");
    await writeFile(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        lastActiveWorkspace: {
          kind: "remote",
          workspacePath: "/srv/project",
          workspaceIdentity: "remote:server:source-1:/srv/project",
          target: { kind: "ssh", host: "dev.example.com", username: "dev" },
          lastOpenedAt: 1,
          lastConnectionStatus: "connected",
        },
      }),
    );
    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).rejects.toThrow();
    expect(await readFile(conversationWorkspaceDir, "utf8")).toBe("existing file");
  });

  it("仅 active 本地 workspace 参与可用性校验", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");
    const activeWorkspace = join(rootDir, "active-workspace");
    const inactiveMissingWorkspace = join(rootDir, "inactive-missing");
    mkdirSync(activeWorkspace);
    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        lastWorkspaceSession: [
          { kind: "local", workspacePath: inactiveMissingWorkspace },
          { kind: "local", workspacePath: activeWorkspace },
        ],
        lastActiveTabIndex: 1,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).resolves.toEqual({ agentWarmupTargets: [{ workspacePath: activeWorkspace }] });
    expect(existsSync(conversationWorkspaceDir)).toBe(false);
  });

  it("没有可恢复会话时应直接兜底到 conversation backing workspace", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        recentProjects: ["/tmp/workspace-a"],
        locale: "zh-CN",
        lastWorkspaceSession: [],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }).then((bootstrap) => bootstrap.initialWorkspacePath),
    ).resolves.toBe(conversationWorkspaceDir);
    expect(existsSync(conversationWorkspaceDir)).toBe(true);
  });

  it("没有可恢复会话时 conversation workspace 也是 agent 预热目标", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-workspace-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 这些用例验证的是「恢复上次 workspace」语义；首页模式由默认值覆盖，另行单独测。
        startupShowHome: false,
        recentProjects: [],
        locale: "zh-CN",
        lastWorkspaceSession: [],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({
        settingsFile,
        conversationWorkspaceDir,
      }),
    ).resolves.toEqual({
      initialWorkspacePath: conversationWorkspaceDir,
      initialWorkspacePurpose: "conversation",
      agentWarmupTargets: [{ workspacePath: conversationWorkspaceDir }],
    });
    expect(existsSync(conversationWorkspaceDir)).toBe(true);
  });

  // 冷启动固定首页（spec：specs/2026-11-24-cold-start-home-design.md）。
  // 默认开启，必须压过 lastActiveWorkspace，否则用户看到的仍是上次项目。
  it("默认首页：即使存在 lastActiveWorkspace 也激活 conversation workspace", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-home-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");
    const projectWorkspace = join(rootDir, "workspace-a");
    mkdirSync(projectWorkspace);

    writeFileSync(
      settingsFile,
      JSON.stringify({
        // 不写 startupShowHome，验证 schema 默认值即首页。
        lastActiveWorkspace: {
          kind: "local",
          workspacePath: projectWorkspace,
          workspacePurpose: "project",
        },
        lastWorkspaceSession: [{ kind: "local", workspacePath: projectWorkspace }],
        recentProjects: [projectWorkspace],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).resolves.toEqual({
      initialWorkspacePath: conversationWorkspaceDir,
      initialWorkspacePurpose: "conversation",
      agentWarmupTargets: [{ workspacePath: conversationWorkspaceDir }],
    });
    // 激活目标必须是 conversation 目录，且该目录真实存在（Agent 需要可写 cwd）。
    expect(existsSync(conversationWorkspaceDir)).toBe(true);
    // 不能顺手删改用户的项目目录。
    expect(existsSync(projectWorkspace)).toBe(true);
  });

  it("默认首页：上次 active 是远程项目时也不预热远程、不返回远程 initialWorkspace", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-home-remote-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");

    writeFileSync(
      settingsFile,
      JSON.stringify({
        lastActiveWorkspace: {
          kind: "remote",
          workspacePath: "/srv/project",
          workspaceIdentity: "remote:server:source-1:/srv/project",
          target: { kind: "ssh", host: "dev.example.com", username: "dev" },
          lastOpenedAt: 1,
          lastConnectionStatus: "connected",
        },
        lastWorkspaceSession: [],
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).resolves.toEqual({
      initialWorkspacePath: conversationWorkspaceDir,
      initialWorkspacePurpose: "conversation",
      agentWarmupTargets: [{ workspacePath: conversationWorkspaceDir }],
    });
  });

  it("首页开关关闭后回到旧行为：恢复 lastActiveWorkspace", async () => {
    const rootDir = makeTempDir("raspberrycode-startup-home-off-");
    const settingsFile = join(rootDir, "setting.json");
    const conversationWorkspaceDir = join(rootDir, ".raspberrycode", "workspace", "default");
    const projectWorkspace = join(rootDir, "workspace-a");
    mkdirSync(projectWorkspace);

    writeFileSync(
      settingsFile,
      JSON.stringify({
        startupShowHome: false,
        lastActiveWorkspace: {
          kind: "local",
          workspacePath: projectWorkspace,
          workspacePurpose: "project",
        },
        lastActiveTabIndex: 0,
      }),
      "utf-8",
    );

    await expect(
      resolveStartupWindowBootstrap({ settingsFile, conversationWorkspaceDir }),
    ).resolves.toEqual({
      agentWarmupTargets: [{ workspacePath: projectWorkspace }],
    });
  });
});
