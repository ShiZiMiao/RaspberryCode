> **归档声明（2026-11-03）**：本文档描述的「会话分享 / 内容分享」功能已在产品独立化改造中移除，内容保留为历史设计记录，不再反映产品现状。

# Share 独立构建与 CUA 依赖边界

## 状态

- 状态：已实现
- 范围：Share 静态落地页的构建依赖
- 不改变：Share API、OAuth 协议、Desktop 导入、手机 `/remote`、完整 Web 入口

## 当前问题

历史版本的 `build:web-share` 曾通过 `packages/web/src/main.tsx` 构建完整 Web 应用。
当前已切换为独立的 `@raspberrycode/web-share` 入口；Share 仅复用 `@raspberrycode/share-ui`、协议类型、
认证/Share API 客户端和只读 presentation，不再进入完整 Web 的 CUA 依赖闭包。

```text
历史：@raspberrycode/web -> @raspberrycode/client / @raspberrycode/ui -> @raspberrycode/services -> @raspberrycode/raspberrycode-cua
当前：@raspberrycode/web-share -> @raspberrycode/share-ui / @raspberrycode/shared
      @raspberrycode/web       -> @raspberrycode/client / @raspberrycode/ui -> @raspberrycode/services -> @raspberrycode/raspberrycode-cua
```

## 目标边界

- `@raspberrycode/web-share` 只包含 Share 路由、Preview API、OAuth callback 和只读时间线。
- Share 构建不声明、解析或下载 `@raspberrycode/services` 与 `@raspberrycode/raspberrycode-cua`。
- `@raspberrycode/share-ui` 提供 Share 所需的只读 presentation 入口；Desktop/Remote 继续使用完整
  `@raspberrycode/ui`。
- Share 与完整 Web 共用协议类型和已确认的只读展示实现，不共用运行态 service。
- Remote v4 构建从 workspace 内的 `packages/raspberrycode-cua` 构建 CUA，不涉及私有 Git 与凭据。

## 构建链路

```text
Dockerfile.web-share
  -> pnpm install --frozen-lockfile --filter @raspberrycode/web-share...
  -> pnpm --filter @raspberrycode/web-share build
  -> nginx static image
```

`.npmrc` 为 `node-linker=hoisted`，`--filter` 不裁剪 lockfile 平铺；CUA 并入 monorepo 后 lockfile
中已无 Git 来源，Share 镜像无需 git、BuildKit secret 或 Jenkins 凭据，也不需要 `packages/raspberrycode-cua`。

## 验收

- Share 镜像构建命令不包含 CUA secret。
- Share 构建不访问任何 Git 仓库。
- `/cn/share`、`/share`、callback、mock fixture 和资源路径保持可用。
- 完整 Web 和 Remote v4 的构建依赖边界不变。
- Share 页面不创建 Host、Agent、service 或 remote session。
