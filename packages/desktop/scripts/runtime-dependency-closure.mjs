import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { builtinModules, createRequire } from "node:module";

function findPackageRoot(entryPath) {
  let currentDir = dirname(entryPath);
  const root = parse(currentDir).root;
  while (currentDir !== root) {
    const packageJsonPath = resolve(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return null;
}

function readRuntimePackage(moduleLookupRoots, moduleName, parentPackagePath = null) {
  if (parentPackagePath) {
    try {
      const requireFromParent = createRequire(parentPackagePath);
      const entryPath = requireFromParent.resolve(moduleName);
      const packageRoot = findPackageRoot(entryPath);
      if (packageRoot) {
        const packageJsonPath = resolve(packageRoot, "package.json");
        return {
          packageJson: JSON.parse(readFileSync(packageJsonPath, "utf8")),
          packageJsonPath,
          packageRoot,
        };
      }
    } catch {
      // 父包相对解析失败时，继续走 workspace lookup roots 兜底。
    }
  }

  for (const lookupRoot of moduleLookupRoots) {
    const packageJsonPath = resolve(lookupRoot, "node_modules", moduleName, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    return {
      packageJson: JSON.parse(readFileSync(packageJsonPath, "utf8")),
      packageJsonPath,
      packageRoot: dirname(packageJsonPath),
    };
  }
  return null;
}

export function collectRuntimeModuleClosure(moduleNames, moduleLookupRoots) {
  return collectRuntimeModuleClosureEntries(moduleNames, moduleLookupRoots).map(
    (entry) => entry.moduleName,
  );
}

export function collectRuntimeModuleClosureEntries(moduleNames, moduleLookupRoots) {
  const collected = [];
  const visited = new Set();

  function visit(moduleName, optional = false, parentPackagePath = null) {
    if (visited.has(moduleName)) {
      return;
    }

    const runtimePackage = readRuntimePackage(moduleLookupRoots, moduleName, parentPackagePath);
    if (!runtimePackage && optional) {
      return;
    }

    visited.add(moduleName);
    collected.push({
      moduleName,
      sourceModulePath: runtimePackage?.packageRoot ?? null,
      packageJsonPath: runtimePackage?.packageJsonPath ?? null,
    });

    if (!runtimePackage) {
      return;
    }

    const { packageJson, packageJsonPath } = runtimePackage;
    const dependencies = packageJson.dependencies ?? {};
    const optionalDependencies = packageJson.optionalDependencies ?? {};
    const dependencyEntries = [
      ...Object.keys(dependencies).map((dependencyName) => [dependencyName, false]),
      ...Object.keys(optionalDependencies).map((dependencyName) => [dependencyName, true]),
    ];

    for (const [dependencyName, isOptional] of dependencyEntries.sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      // 运行时外置包进了 app.asar 时，它的 hoisted 子依赖不会自动跟着进包。
      // 递归收集 dependencies，让打包注入和产物校验覆盖完整运行时解析链。
      // pnpm 多版本同名依赖下，不能每层都从固定 lookup roots 取第一个目录。
      // 例如 yazl 需要 buffer-crc32@1.x，而 desktop 测试依赖里还有 0.2.x；
      // 必须从父包 package.json 相对解析，才能复制到真实运行时会加载的版本。
      visit(dependencyName, isOptional, packageJsonPath);
    }
  }

  for (const moduleName of moduleNames) {
    visit(moduleName);
  }

  return collected;
}

/**
 * 扫描桌面构建产物（out/main、out/host、out/preload、out/plugin-sandbox）中被
 * require/import 的裸外部包名——这是运行时对 node_modules 的真实需求全集。
 *
 * 修复：bundle.mjs 的 requiredRuntimeModules 与 electron-builder.config 的
 * REQUIRED_ASAR_RUNTIME_MODULES 是两份手工清单，长期互相漂移；yaml、electron-updater、
 * ssh2 等运行时外部依赖双双缺席，安装包能生成但主进程启动即 Cannot find module
 * （v0.1.0 Windows 实机复现）。以产物扫描为唯一事实来源，手工清单只作安全下限保留。
 */
export function collectBundleExternalPackageNames(outDirs) {
  const specifierPattern = /(?:\brequire\(\s*|\bimport\(\s*|\bfrom\s*)["']([^"']+)["']/gu;
  const builtinNames = new Set(builtinModules);
  const names = new Set();

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!/\.(?:js|cjs|mjs)$/u.test(entry.name)) continue;
      const source = readFileSync(fullPath, "utf8");
      for (const match of source.matchAll(specifierPattern)) {
        const specifier = match[1];
        if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
        const name = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0];
        if (name === "electron" || builtinNames.has(name)) continue;
        // 过滤压缩产物里被正则误命中的表达式碎片（如 `);if(n.kind===`）。
        if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/iu.test(name)) continue;
        names.add(name);
      }
    }
  }

  for (const dir of outDirs) {
    if (existsSync(dir)) walk(dir);
  }
  return [...names].sort();
}
