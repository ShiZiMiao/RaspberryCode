import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

import engineeringTestFiles from "./scripts/engineering-test-files.json";

const processLifecycleTests = [
  "packages/services/test/processTreeTerminator.test.ts",
  "packages/services/test/raspberrycodeAgentService.test.ts",
  "packages/services/test/raspberrycodeAgentService.v4.test.ts",
  "packages/services/test/raspberrycodeAgentProcessManager.test.ts",
  "packages/services/test/raspberrycodeStdioTransport.test.ts",
];
const forkIsolatedTests = [
  ...processLifecycleTests,
  // 独立配置读者在 5 秒内等待启动；放入串行组保留真实进程和原时限。
  "packages/provider-node/test/personal-config-read-lock.test.ts",
  // electron-builder 下载 NSIS 时把进程 stdio 传给子进程，不能使用 threads 的虚拟 stdio。
  "packages/desktop/test/windowsInstallerCompile.test.ts",
  // NSIS makensis 编译属重资源子进程：两个安装器用例并发编译曾互相打挂（单跑均过）。
  "packages/desktop/test/windowsInstallerNshSmoke.test.ts",
  "packages/desktop/test/windowsInstallerPreserveFiles.test.ts",
  // 原生 fs.watch 通知在批量并发下曾等不到（单跑过），串行验证真实接线。
  "packages/services/test/subagentRuntimeConfigWatcher.test.ts",
  "packages/desktop/test/cdnPreloadScript.test.ts",
  "packages/desktop/test/desktopRuntimeEnv.test.ts",
  "packages/desktop/test/e2eDesktopBuildCache.test.ts",
  "packages/desktop/test/pluginE2EAdmissionScripts.test.ts",
  "packages/server/test/remoteDeploy.test.ts",
  // Bugfix: 该集成测试会启动数百个真实 Git 子进程；放在普通 threads 并发组会让
  // macOS 进程启动队列饥饿，表现为 git init 长时间停在 dyld_start。
  "packages/services/test/gitService.test.ts",
  // Bugfix: checkpoint 集成测试同样会连续创建真实 Git 仓库；related 全量并发时会因
  // 子进程与磁盘调度饥饿超过 30 秒，隔离串行后保持聚焦运行时的真实耗时口径。
  "packages/services/test/gitCheckpointService.test.ts",
  "packages/services/test/mcpSyncService.test.ts",
  "packages/services/test/providerRuntimeResolver.test.ts",
  "packages/services/test/runtimeToolResolver.test.ts",
  // 该集成测试会真实启动 tsx、Supervisor 与多代 Core；放在普通 threads 中时，
  // 并行 worker 的进程启动压力会让 15 秒 ready barrier 偶发超时。
  "packages/raspberrycode-server-cli/test/runtimeUpdateIntegration.test.ts",
  // Bugfix: pdfjs-dist legacy build 在 threads worker 内偶发原生崩溃（0xC0000005，
  // 测试自身通过、worker 收尾时崩，会把整场全量跑拦腰截断）。隔离到 fork 池后崩溃
  // 波及面收敛到本文件，其余测试结果可完整收集；崩溃根因见
  // docs/windows-test-compatibility.md。
  "packages/ui/test/pdfJsCMapSupport.test.ts",
];

export default defineConfig({
  // 测试固定注入事件上报端点，使遥测上报链路在单测中可验证；真实构建由 scripts/build-time-config.mjs 决定。
  define: {
    __RASPBERRYCODE_TELEMETRY_REPORT_ENDPOINT__: JSON.stringify("https://raspberrycode.example.com/api/v1/event/report"),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "packages/ui/src"),
      "@desktop": resolve(__dirname, "packages/desktop/src"),
      "@web": resolve(__dirname, "packages/web/src"),
      // 间接 import desktopNetworkTelemetry 等的单测无需真实 ARMS；需 vi.fn 的用例在文件内 vi.mock 覆盖
      // Bugfix: 具体的 /browser 子路径必须排在包根别名前，否则会被根别名拼成不存在的 stub.ts/browser。
      "@arms/rum-electron/browser": resolve(
        __dirname,
        "packages/desktop/test/mocks/armsRumElectronStub.ts",
      ),
      "@arms/rum-electron": resolve(
        __dirname,
        "packages/desktop/test/mocks/armsRumElectronStub.ts",
      ),
    },
  },
  test: {
    // 先于 worker 启动关闭 WorkBuddy 删除护栏（详见文件内注释），避免测试清理被误拦。
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // 官方依赖图不追踪 setupFiles；公共配置变化必须明确选中整个工程套件并报告跳过。
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      "**/{vitest,vite}.config.*",
      "**/vitest.setup.ts",
      // managed worktree 路径含 .codex，globstar 默认不匹配隐藏目录；关键入口用精确绝对路径。
      ...[
        "package.json",
        "vitest.config.ts",
        "vitest.setup.ts",
        "scripts/engineering-test-files.json",
      ].map((file) => resolve(__dirname, file)),
    ],
    // 修复原因：全量 run 的 stdout 会把**通过**测试里的 console 输出一并转发——services 层
    // 用 createServiceLogger 的用例在绿态下也要刷几千行多行日志，全量输出因此膨胀到
    // ~3.3MB，超过 CI/工作流门禁对单条命令 256KB 的 stdout 上限，导致门禁整条命令被判
    // 「无法执行」而非测试失败。passed-only 只隐藏通过测试的 console，失败用例的日志与
    // 断言 diff 原样保留（诊断能力不降级）；全绿时输出收敛到 ~140KB。
    silent: "passed-only",
    // 修复原因：全量单测并发跑 Git、zip、Electron 模块导入时，默认 5s 超时在低配或高负载机器上
    // 容易被提前打穿（spawn git 子进程、模块 import 变慢 → flaky 超时）；中断后的文件句柄清理在
    // Windows 上还会触发 EPERM/ENOTEMPTY。此前只给 Windows 放宽，但 macOS/Linux 低配机同样会因
    // 内存抖动（swap thrashing）拖慢 spawn，故统一降低并发并放宽超时。
    hookTimeout: 30_000,
    maxWorkers: 4,
    testTimeout: 30_000,
    // 工程测试使用明确清单；不再发现 App 业务单测。真实子进程测试串行运行。
    //
    // ⚠ `unit` 与 `fork-isolated` 两个 project 与上一句相矛盾，也与上游不一致：
    // 上游 zai-org/ZCode 的 vitest 配置只有 `engineering` + cua，并已按
    // docs/testing/unit-test-quality.md（2026-10-26）退役 App 业务单测。
    // 我们这条开发线从未删除这两个 project，于是 892 个 desktop + 714 个 ui
    // 测试仍在执行。这不是有意恢复，是分叉后没跟上上游的删除（内部代号
    // SYNC-DRIFT-UNIT，详见 docs/sync-drift-unit.md）。
    //
    // 在方向决定之前**不要**在这里新增 App 业务测试：新测试请写到
    // packages/raspberrycode-cua/test/（规范明确保留、有独立入口）。
    projects: [
      {
        extends: true,
        // 评测工具的回归测试以子进程运行这些脚本；声明为资源后测试可以 import 它们（只得到路径），
        // 依赖图里有了它们，改脚本时受影响工程测试才会选中 docker/plugin-eval/legal-bench/test/。
        assetsInclude: ["**/docker/plugin-eval/**/*.{pl,sh,py}"],
        test: {
          name: "unit",
          include: [
            "packages/*/test/**/*.test.ts",
            // 架构治理要求 managed 模块自带 contract.test.ts（见 architecture-policy.yaml），放在模块目录内。
            // 源码旁回归（plugin-sandbox/gen-ui 等目录）同样必须进默认入口执行，
            // 避免只在手动定向运行时生效（历史教训：src 旁置测试曾整族失联）。
            "packages/*/src/**/*.test.ts",
            // Gen UI 目录回归位于源码旁，默认入口也必须执行，避免只在手动定向运行时生效。
            "packages/shared/src/node/genUiPaths.test.ts",
            "packages/services/src/gen-ui/**/*.test.ts",
            "scripts/assert-safe-cua-helper-zip.test.mjs",
            "scripts/ci/ci-telemetry-keyword-guard.test.mjs",
          ],
          // 工程测试由下方 engineering project 按显式清单执行，这里排除以免同一文件重复跑两遍。
          exclude: [
            "packages/desktop/test/e2e/**",
            "packages/raspberrycode-cua/**",
            ...forkIsolatedTests,
            ...engineeringTestFiles,
          ],
          // Node 24/macOS 的 threads 全量运行可触发 V8 SIGSEGV；诊断时切换进程隔离，测试范围不变。
          pool: process.env.RASPBERRYCODE_TEST_POOL === "forks" ? "forks" : "threads",
          maxWorkers: process.env.RASPBERRYCODE_TEST_POOL === "forks" ? 2 : 4,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "fork-isolated",
          include: forkIsolatedTests,
          pool: "forks",
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        // 工程测试沿用上游的显式清单入口（scripts/engineering-test-files.json）；
        // `pnpm test:engineering` / `test:engineering:affected` 依赖此 project 名称。
        extends: true,
        test: {
          name: "engineering",
          include: engineeringTestFiles,
          pool: "forks",
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      "packages/raspberrycode-cua/vitest.config.ts",
    ],
  },
});
