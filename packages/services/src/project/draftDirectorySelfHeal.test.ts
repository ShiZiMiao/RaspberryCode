import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProjectRepositoryContract } from "#src/project-storage/contract.js";
import { createProjectService } from "#src/project/index.js";

/**
 * 草稿目录自愈（2026-11-20 真机事故的回归测试）。
 *
 * 事故经过：前端把 `{draftId, workspacePath}` 持久化在 localStorage
 * （`raspberrycode-pending-task-draft:v1:*`）。draft 目录被清理后，前端仍带着
 * 同一个 draftId + workspacePath 重试 → `reuseDraft=true` → 后端校验一个已不存在的
 * 目录 → 直接抛错 → **用户永久无法创建新任务**，界面只显示
 * `project.directory-required`，没有任何自救入口。
 *
 * 正确行为：草稿目录是我们自己分配的临时空间，失效时**重建**它，不丢用户数据。
 * 与之相对，用户指定的项目主目录失效必须报错（不能凭空复活用户的真实目录）。
 */
describe("prepareSession 草稿目录", () => {
  const makeService = async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-selfheal-"));
    const service = createProjectService({
      repository: async () =>
        ({
          readTree: () => ({ projects: [], tasks: [] }),
        }) as unknown as ProjectRepositoryContract,
      workspaceDirectory: join(root, "workspace"),
      afterChange: async () => {},
    });
    await mkdir(join(root, "workspace"), { recursive: true });
    return { root, service };
  };

  it("目录已消失时重建，不抛错", async () => {
    const { root, service } = await makeService();
    const draftId = "ff7191e6-b3cd-4807-902a-e4a915ca6b79";
    const expected = join(root, "workspace", `draft-${draftId}`);
    try {
      // 场景：localStorage 记着这个 draft，但目录被人删了。
      await expect(service.prepareSession({ draftId, reuseDraft: true })).resolves.toMatchObject({
        workspacePath: expected,
        projectId: null,
      });
      // 而且真的建出来了，后续写入才有地方落。
      expect((await stat(expected)).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("目录还在时原样复用，不重建（保留已有文件）", async () => {
    const { root, service } = await makeService();
    const draftId = "4f43abf1-bc3f-4f5a-b18f-2e3a80ab6217";
    const expected = join(root, "workspace", `draft-${draftId}`);
    try {
      // 先正常创建一次
      await service.prepareSession({ draftId, reuseDraft: false });
      const marker = join(expected, "keep.txt");
      await (await import("node:fs/promises")).writeFile(marker, "keep", "utf8");

      await expect(service.prepareSession({ draftId, reuseDraft: true })).resolves.toMatchObject({
        workspacePath: expected,
      });
      // 复用语义下不能清空用户已经放进去的东西。
      expect((await import("node:fs/promises")).readFile(marker, "utf8")).resolves.toBe("keep");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("新建草稿会 mkdir，不需要 reuseDraft", async () => {
    const { root, service } = await makeService();
    const draftId = "a50ef692-e86a-467b-bb99-c17260b509ae";
    const expected = join(root, "workspace", `draft-${draftId}`);
    try {
      await expect(service.prepareSession({ draftId })).resolves.toMatchObject({
        workspacePath: expected,
      });
      expect((await stat(expected)).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
