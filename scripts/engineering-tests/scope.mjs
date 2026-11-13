import { resolve } from "node:path";
import { git, run } from "./process.mjs";
import { checkPushWorktree } from "../check-push-worktree.mjs";

async function commit(root, ref) {
  try {
    return (await git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]))
      .toString()
      .trim();
  } catch (error) {
    throw new Error(`无法解析基线或提交 ${ref}：${error.message}`, { cause: error });
  }
}
async function isAncestor(root, ancestor, head) {
  const check = await run("git", ["merge-base", "--is-ancestor", ancestor, head], {
    cwd: root,
    allowFailure: true,
  });
  return check.code === 0;
}

// rebase / force-push 后远端 SHA 不再是 HEAD 的祖先；直接拿它当基线会让 Vitest
// 找不到公共祖先而退化成全量选择。回退到双方 merge-base，永远给官方选择一个
// 真实分叉点（最坏也只是比严格推送范围多选 staging 侧的新增改动，不会全量）。
async function resolvePushBase(root, head, remote) {
  if (await isAncestor(root, remote, head)) {
    return remote;
  }

  return (await git(root, ["merge-base", remote, head])).toString().trim();
}

async function firstPushBase(root, head) {
  // 首次推送没有 remote SHA；优先用已确认的集成分支，缺失时按候选顺序回退。
  //
  // 本仓库从上游 fork 而来，主分支是 main，不存在上游模板假设的 staging。
  // 原先只认 origin/staging 会直接抛错，导致 pre-push 在 tag / 首次推送时
  // 一律失败（实测推 v0.2.1 tag 被卡住）。这里改为按候选探测，全缺失才报错。
  const candidates = ["origin/staging", "origin/main", "origin/master", "upstream/main"];
  let staging = null;
  for (const ref of candidates) {
    try {
      staging = await commit(root, ref);
      break;
    } catch {
      // 试下一个候选
    }
  }
  if (!staging) {
    throw new Error(
      `无法解析基线：以下分支均不存在 ${candidates.join(" / ")}。` +
        "请先 fetch，或用 RASPBERRYCODE_PRE_PUSH_BASE 显式指定基线。",
    );
  }
  return (await git(root, ["merge-base", staging, head])).toString().trim();
}

/** 只解析比较基线；改动文件与关联测试全部由 Vitest 官方选择。 */
export async function resolveScope(root, options = {}, env = process.env) {
  if (options.scope && !["worktree", "push"].includes(options.scope))
    throw new Error(`未知范围：${options.scope}`);
  const explicit = options.base ?? env.RASPBERRYCODE_AFFECTED_TEST_BASE ?? env.RASPBERRYCODE_PRE_PUSH_BASE;
  if (options.files && (options.scope === "push" || explicit))
    throw new Error("--files 不能与 push 或 --base 混用");
  if (options.files)
    return { files: [...new Set(options.files.map((file) => resolve(root, file)))], bases: [true] };
  if (options.scope !== "push") return { bases: [explicit ? await commit(root, explicit) : true] };

  await checkPushWorktree(root, env);
  const head = await commit(root, "HEAD");
  const entries = (env.RASPBERRYCODE_PRE_PUSH_STDIN ?? "")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split(/\s+/u));
  const bases = [];
  if (entries.length) {
    for (const entry of entries) {
      if (/^0+$/u.test(entry[1])) continue;
      // hook 曾直接使用 remote SHA，导致显式基线变量失效；校验目标后优先使用调用方指定基线。
      bases.push(
        explicit
          ? await commit(root, explicit)
          : /^0+$/u.test(entry[3])
            ? await firstPushBase(root, head)
            : await resolvePushBase(root, head, await commit(root, entry[3])),
      );
    }
    return { bases: [...new Set(bases)], deletedOnly: !bases.length };
  }
  if (explicit) return { bases: [await commit(root, explicit)] };
  const upstream = await run("git", ["rev-parse", "--verify", "@{upstream}^{commit}"], {
    cwd: root,
    allowFailure: true,
  });
  return {
    bases: [
      upstream.code === 0
        ? await resolvePushBase(root, head, upstream.stdout.toString().trim())
        : await firstPushBase(root, head),
    ],
  };
}
