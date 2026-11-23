/**
 * 更新镜像探测脚本的判据单测。
 *
 * 这些判据是「发版前选镜像」的唯一把关点，写错的后果是：
 *   - atom 判据过宽 → 选到只回 200 但内容非 XML 的镜像，用户更新报解析错误；
 *   - Range 判据过宽 → 差量静默退化为整包，用户只觉得「更新慢」但查不出原因。
 * 因此这里把三条判据的边界都钉住。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRangeHonored,
  looksLikeAtomFeed,
  looksLikeLatestYml,
  parseLatestTagFromAtom,
  selectCandidates,
} from "../probe-update-mirrors.mjs";

/** 构造一个「合格」结果对象，只需速度与 atom 延迟参与排序。 */
function candidate(prefix, speedMBps, atomSeconds = 1) {
  return {
    prefix,
    speedBytesPerSec: Math.round(speedMBps * 1048576),
    atom: { bytes: 20000, seconds: atomSeconds },
    eligible: true,
  };
}

/**
 * 构造一个足够长的真实 Atom feed 样本。
 *
 * 条数取 40：真实 GitHub feed 有 20KB 量级，而判据要求 ≥2000 字节。
 * 用逼近阈值的样本（如 20 条 ≈1.9KB）会让测试对阈值调整过于敏感，
 * 也掩盖「内容长度确实是判据之一」这个事实。
 */
function buildAtomFeed(entries = 40) {
  const items = Array.from(
    { length: entries },
    (_, i) => `  <entry><id>tag:github.com,2008:Repository/1/v0.2.${i}</id><title>v0.2.${i}</title></entry>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <id>tag:github.com,2008:https://github.com/o/r/releases</id>
${items}
</feed>`;
}

describe("looksLikeAtomFeed", () => {
  it("真实 Atom feed 通过", () => {
    assert.equal(looksLikeAtomFeed(buildAtomFeed()), true);
  });

  it("假成功被拒：200 但内容是 ok（实测 gh.acmsz.top 返回 2–3 字节）", () => {
    assert.equal(looksLikeAtomFeed("ok"), false);
    assert.equal(looksLikeAtomFeed("ok\n"), false);
  });

  it("HTML 错误页被拒（镜像返回跳转页的情形）", () => {
    const html = `<!DOCTYPE html><html><head><title>Proxy</title></head><body>${"x".repeat(3000)}</body></html>`;
    assert.equal(looksLikeAtomFeed(html), false);
  });

  it("空/未定义被拒", () => {
    assert.equal(looksLikeAtomFeed(""), false);
    assert.equal(looksLikeAtomFeed(undefined), false);
    assert.equal(looksLikeAtomFeed(null), false);
  });

  it("过短的内容被拒（即使含 feed 字样）", () => {
    assert.equal(looksLikeAtomFeed("<feed></feed>"), false);
  });

  it("有 <feed> 但缺 </feed>（截断响应）被拒", () => {
    const truncated = `<feed xmlns="http://www.w3.org/2005/Atom">${"<entry>x</entry>".repeat(300)}`;
    assert.equal(looksLikeAtomFeed(truncated), false);
  });
});

describe("isRangeHonored", () => {
  const REQUESTED = 100;

  it("206 且长度等于请求区间 → 通过", () => {
    assert.equal(isRangeHonored(206, 100, REQUESTED), true);
  });

  it("206 但长度小于请求（文件比区间短）→ 通过", () => {
    assert.equal(isRangeHonored(206, 40, REQUESTED), true);
  });

  it("200 + 全量被拒（实测 777.z321.cc.cd 回 359B 而非 100B）", () => {
    assert.equal(isRangeHonored(200, 359, REQUESTED), false);
  });

  it("206 但长度超过请求区间被拒（镜像回 206 却给全量）", () => {
    assert.equal(isRangeHonored(206, 359, REQUESTED), false);
  });

  it("0 字节被拒（空响应不能算支持 Range）", () => {
    assert.equal(isRangeHonored(206, 0, REQUESTED), false);
    assert.equal(isRangeHonored(206, -1, REQUESTED), false);
  });

  it("其他状态码被拒", () => {
    for (const code of [301, 302, 403, 404, 429, 500, 530]) {
      assert.equal(isRangeHonored(code, 100, REQUESTED), false);
    }
  });
});

describe("looksLikeLatestYml", () => {
  it("完整 latest.yml 通过", () => {
    const yml = `version: 0.2.7
files:
  - url: RaspberryCode-0.2.7-win-x64.exe
    sha512: V4U+thF6y5CFDd+JYU5j99OT2Vetz2kqFTr9+m8NFlG24zaar11OX8QBCtV0uBht7p7q/1YUdMsvgsuw6Du6nA==
    size: 191467906
path: RaspberryCode-0.2.7-win-x64.exe
sha512: V4U+thF6y5CFDd+JYU5j99OT2Vetz2kqFTr9+m8NFlG24zaar11OX8QBCtV0uBht7p7q/1YUdMsvgsuw6Du6nA==
releaseDate: '2026-11-22T08:02:33.470Z'
`;
    assert.equal(looksLikeLatestYml(yml), true);
  });

  it("缺 sha512 被拒（无法校验完整性的清单不能用）", () => {
    assert.equal(looksLikeLatestYml("version: 0.2.7\nfiles:\n  - url: a.exe\n"), false);
  });

  it("缺 version 被拒", () => {
    assert.equal(looksLikeLatestYml("files:\n  - url: a.exe\n    sha512: abc\n"), false);
  });

  it("HTML 错误页被拒", () => {
    assert.equal(
      looksLikeLatestYml("<html><body>version: 1\nsha512: x</body></html>"),
      false,
    );
  });

  it("空内容被拒", () => {
    assert.equal(looksLikeLatestYml(""), false);
    assert.equal(looksLikeLatestYml(undefined), false);
  });
});

describe("selectCandidates（用户规则：速度排序取前 3，不足 3 有几个算几个）", () => {
  it("超过 3 家时只取最快的前 3 家", () => {
    const all = [
      candidate("https://slow.example/", 0.1),
      candidate("https://fast.example/", 5),
      candidate("https://mid.example/", 1),
      candidate("https://fastest.example/", 10),
      candidate("https://勉强.example/", 0.2),
    ];
    const picked = selectCandidates(all).map((r) => r.prefix);
    assert.deepEqual(picked, [
      "https://fastest.example/",
      "https://fast.example/",
      "https://mid.example/",
    ]);
  });

  it("不足 3 家时有几个算几个（不凑数、不抛错）", () => {
    assert.equal(selectCandidates([candidate("https://a.example/", 1)]).length, 1);
    assert.equal(
      selectCandidates([candidate("https://a.example/", 1), candidate("https://b.example/", 2)]).length,
      2,
    );
  });

  it("一家都没有时返回空数组", () => {
    assert.deepEqual(selectCandidates([]), []);
  });

  it("速度相同时按 atom 延迟升序（延迟低的优先）", () => {
    const picked = selectCandidates([
      candidate("https://slowatom.example/", 2, 3),
      candidate("https://fastatom.example/", 2, 0.5),
      candidate("https://other.example/", 1, 0.1),
    ]).map((r) => r.prefix);
    assert.deepEqual(picked, ["https://fastatom.example/", "https://slowatom.example/", "https://other.example/"]);
  });

  it("只有 3 家时全部保留（边界：等于上限）", () => {
    const all = [
      candidate("https://a.example/", 3),
      candidate("https://b.example/", 2),
      candidate("https://c.example/", 1),
    ];
    assert.equal(selectCandidates(all).length, 3);
  });

  it("不修改传入数组（排序在副本上进行）", () => {
    const all = [candidate("https://a.example/", 1), candidate("https://b.example/", 9)];
    const originalOrder = all.map((r) => r.prefix);
    selectCandidates(all);
    assert.deepEqual(
      all.map((r) => r.prefix),
      originalOrder,
    );
  });

  it("可传自定义上限（调用方需要全部合格项时用 MAX_SAFE_INTEGER）", () => {
    const all = [candidate("https://a.example/", 3), candidate("https://b.example/", 2)];
    assert.equal(selectCandidates(all, 1).length, 1);
    assert.equal(selectCandidates(all, Number.MAX_SAFE_INTEGER).length, 2);
  });
});

describe("parseLatestTagFromAtom（发版前版本号已改、资产还没上传时的回退依据）", () => {
  // 背景（2026-11-23 实际踩到）：本地版本号先于发版就改成 0.2.8，但 GitHub 上只有
  // v0.2.7 的资产。脚本用 v0.2.8 去探 latest.yml 得到 404，被判成「Range 未生效」，
  // 于是全部镜像不合格 —— 假警报。修法是用 atom 里的最新已发布 tag 兜底。
  const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <id>tag:github.com,2008:https://github.com/ShiZiMiao/RaspberryCode/releases</id>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.2.7</id>
    <link rel="alternate" type="text/html" href="https://github.com/ShiZiMiao/RaspberryCode/releases/tag/v0.2.7"/>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.2.6</id>
    <link rel="alternate" type="text/html" href="https://github.com/ShiZiMiao/RaspberryCode/releases/tag/v0.2.6"/>
  </entry>
</feed>`;

  it("取第一个（最新的）tag", () => {
    assert.equal(parseLatestTagFromAtom(ATOM), "v0.2.7");
  });

  it("feed 里没有 tag 时返回 null（调用方据此退化为只验 atom）", () => {
    assert.equal(parseLatestTagFromAtom("<feed></feed>"), null);
  });

  it("非字符串输入不抛错", () => {
    assert.equal(parseLatestTagFromAtom(null), null);
    assert.equal(parseLatestTagFromAtom(undefined), null);
    assert.equal(parseLatestTagFromAtom(""), null);
  });

  it("不会把 owner/repo 里的路径误认成 tag", () => {
    const noTag = `<feed><link href="https://github.com/o/r/releases"/></feed>`;
    assert.equal(parseLatestTagFromAtom(noTag), null);
  });
});
