import { spawnSync } from "node:child_process";
import { join } from "node:path";

const windowsShellCommandPattern = /\.(cmd|bat)$/i;
const windowsShellCommandNames = new Set(["npm", "pnpm"]);

// Bugfix: Git Bash 会把 /usr/bin（GNU tar 1.35）注入 PATH 最前，构建脚本子进程 spawn "tar"
// 会解析到 GNU tar——它把归档参数里的盘符冒号（C:）当远程主机名（"Cannot connect to C"）。
// 真实 Windows 用户 PATH 中 System32 本就靠前（自带 bsdtar）；tar 类 spawn 用本函数恢复
// 同样顺序，与 vitest.setup.ts 的测试入口修复同语义（那边覆盖测试进程，这边覆盖构建子进程）。
export function system32FirstEnv(env = process.env, platform = process.platform) {
  if (platform !== "win32") return env;
  const system32 = join(env.SystemRoot ?? "C:\\Windows", "System32");
  const entries = (env.PATH ?? "").split(";");
  const rest = entries.filter((entry) => entry.toLowerCase() !== system32.toLowerCase());
  return { ...env, PATH: [system32, ...rest].join(";") };
}

export function resolveSpawnRuntimeOptions(command, platform = process.platform) {
  if (
    platform === "win32" &&
    (windowsShellCommandPattern.test(command) || windowsShellCommandNames.has(command))
  ) {
    return {
      // Windows runner 上 bare `pnpm` / `npm` 实际也是通过 cmd shim 提供。
      // 之前先把命令名改写成 `pnpm.cmd`，会让部分 `pnpm exec` 场景重新落回错误的包 cwd，
      // 最终把 tsup 入口解析成 scripts/src/... 并报“Cannot find src/main/index.ts”。
      // 这里保留原始命令名，只要求 shell/cmd.exe 负责解析 shim，避免再次改变 pnpm 的包上下文。
      shell: true,
    };
  }

  return {};
}

// shell:true 时 Node 只把 args 按空格拼接进命令行、不做转义（对应 DEP0190 警告）。
// Windows 上仓库路径含空格时（如 D:\my repo\...），pnpm --dir 的路径会被 cmd 按空格
// 截断成 D:\my 并报 ENOENT: lstat。这里按 cmd.exe 规则给含空格的参数补双引号；
// 无空格参数保持原样，不影响现有无空格路径与 CI 行为。
export function quoteArgsForWindowsShell(args) {
  return args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
}

export function runCommand(command, args, options = {}) {
  const runtimeOptions = resolveSpawnRuntimeOptions(command);
  const spawnArgs = runtimeOptions.shell ? quoteArgsForWindowsShell(args) : args;
  const result = spawnSync(command, spawnArgs, {
    stdio: "inherit",
    ...options,
    ...runtimeOptions,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status}`);
  }

  return result;
}

export function runCommandAndReadStdout(command, args, options = {}) {
  const runtimeOptions = resolveSpawnRuntimeOptions(command);
  const spawnArgs = runtimeOptions.shell ? quoteArgsForWindowsShell(args) : args;
  const result = spawnSync(command, spawnArgs, {
    encoding: "utf8",
    ...options,
    ...runtimeOptions,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status}`);
  }

  return result.stdout;
}
