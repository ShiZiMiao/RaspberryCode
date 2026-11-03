import type { RaspberryCodeProvider } from "@raspberrycode/shared";

type SkillSourceType = "agent" | "unknown";

export function resolveSkillSourceType(skillPath: string): SkillSourceType {
  const normalized = skillPath.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/.raspberrycode/skills/")) {
    return "agent";
  }
  if (normalized.includes("/.raspberrycode/cli/plugins/cache/")) {
    return "agent";
  }
  return "unknown";
}

const SKILL_ID_PROVIDER_RE = /^glm:/;

function isRaspberrycodeSkill(skill: { id?: string; path: string; scope?: string }): boolean {
  return (
    // plugin skill 的真实路径在 CLI plugin cache 下，不在 `.raspberrycode/skills`。
    // 服务层已用 scope 标记来源，前端过滤时要放行，否则 `/` 和 `$` 面板会漏掉插件技能。
    skill.scope === "plugin" ||
    (typeof skill.id === "string" && SKILL_ID_PROVIDER_RE.test(skill.id)) ||
    resolveSkillSourceType(skill.path) === "agent"
  );
}

export function filterSkillsForProvider<T extends { path: string; id?: string; scope?: string }>(
  skills: T[],
  _legacyProvider: RaspberryCodeProvider,
): T[] {
  return skills.filter(isRaspberrycodeSkill);
}
