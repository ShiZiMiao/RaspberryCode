// Modified for RaspberryCode: 数据目录断言随 .raspberrycode 独立改名
//
// 本文件只覆盖「用户技能发现」：collectUserSkillCandidates 是数据同步
// （data-sync/skillDataSync.ts）与技能管理的共同底座。旧的候选/状态/归档
// 服务方法已随远端同步弹窗下线移除，其等价能力由 IDataSyncCategoryService
// 在 data-sync 层覆盖（见 desktop E2E 的 remote-data-sync-skill-push）。
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SKILL_SCAN_DEPTH } from "@raspberrycode/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectUserSkillCandidates } from "../src/skill-sync/skillSyncService.js";

async function symlinkSkillDirectory(target: string, linkPath: string) {
  // 修复原因：Windows 普通目录 symlink 依赖开发者模式或管理员权限，CI/本机 pre-push
  // 可能直接 EPERM；junction 能覆盖同样的 realpath 去重语义且不需要额外权限。
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function makeHome() {
  return mkdtempSync(join(tmpdir(), "raspberrycode-skill-sync-home-"));
}

async function writeSkill(
  home: string,
  directoryName: string,
  name = directoryName,
  root: ".raspberrycode" | ".agents" = ".raspberrycode",
) {
  const dir = join(home, root, "skills", directoryName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} desc\n---\nBody`,
  );
  return dir;
}

async function writeBareSkill(
  home: string,
  directoryName: string,
  root: ".raspberrycode" | ".agents" = ".raspberrycode",
) {
  const dir = join(home, root, "skills", directoryName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), "Body");
  return dir;
}

describe("user skill candidates", () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("lists local user raspberrycode skills as candidates", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeSkill(home, "review");

    const candidates = await collectUserSkillCandidates();

    expect(candidates.map((candidate) => candidate.directoryName)).toEqual(["review"]);
    expect(candidates[0]).toMatchObject({ name: "review", description: "review desc" });
  });

  it("lists local user agents skills as candidates when raspberrycode skills are empty", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeSkill(home, "lark-doc", "lark-doc", ".agents");

    const candidates = await collectUserSkillCandidates();

    expect(candidates.map((candidate) => candidate.directoryName)).toEqual(["lark-doc"]);
  });

  it("does not list skills beyond the shared scan depth limit", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const deepPath = Array.from(
      { length: MAX_SKILL_SCAN_DEPTH + 2 },
      (_, index) => `level-${index}`,
    ).join("/");
    await writeSkill(home, `${deepPath}/too-deep`);

    const candidates = await collectUserSkillCandidates();

    expect(candidates.map((candidate) => candidate.directoryName)).not.toContain(
      `${deepPath}/too-deep`,
    );
  });

  it("deduplicates agents skills already covered by raspberrycode skills", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await writeSkill(home, "review-raspberrycode", "review", ".raspberrycode");
    await writeSkill(home, "review-agents", "review", ".agents");

    const candidates = await collectUserSkillCandidates();

    expect(candidates.map((candidate) => candidate.directoryName)).toEqual([
      "review-raspberrycode",
    ]);
  });

  it("deduplicates agents skills already covered by raspberrycode symlink realpath", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const sourceDir = await writeBareSkill(home, "external-source", ".agents");
    const raspberrycodeRoot = join(home, ".raspberrycode", "skills");
    await mkdir(raspberrycodeRoot, { recursive: true });
    await symlinkSkillDirectory(sourceDir, join(raspberrycodeRoot, "linked-external"));

    const candidates = await collectUserSkillCandidates();

    expect(candidates.map((candidate) => candidate.directoryName)).toEqual(["linked-external"]);
  });

  it("deduplicates agents skills covered by raw raspberrycode directory names before realpath de-dupe", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const sourceDir = join(home, "external-source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "Body");
    const raspberrycodeRoot = join(home, ".raspberrycode", "skills");
    await mkdir(raspberrycodeRoot, { recursive: true });
    await symlinkSkillDirectory(sourceDir, join(raspberrycodeRoot, "aaa-link"));
    await symlinkSkillDirectory(sourceDir, join(raspberrycodeRoot, "agents-only"));
    await writeBareSkill(home, "agents-only", ".agents");

    const candidates = await collectUserSkillCandidates();

    expect(candidates.map((candidate) => candidate.directoryName)).toEqual(["aaa-link"]);
  });

  it("keeps nested agents skills' relative directory path", async () => {
    const localHome = makeHome();
    process.env.HOME = localHome;
    await writeSkill(localHome, "group/review", "review", ".agents");

    const candidates = await collectUserSkillCandidates();

    expect(candidates.map((candidate) => candidate.directoryName)).toEqual(["group/review"]);
  });

  it("keeps raspberrycode skill directory symlinks as regular candidate directories", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const sourceDir = join(home, "outside", "shared-skill");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: shared-skill\ndescription: shared desc\n---\nBody",
    );
    const raspberrycodeRoot = join(home, ".raspberrycode", "skills");
    await mkdir(raspberrycodeRoot, { recursive: true });
    await symlinkSkillDirectory(sourceDir, join(raspberrycodeRoot, "shared-skill"));

    const candidates = await collectUserSkillCandidates();

    expect(candidates.map((candidate) => candidate.directoryName)).toEqual(["shared-skill"]);
  });
});
