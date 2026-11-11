/// <reference types="vite/client" />

// renderer 构建期注入的环境变量（Vite define / import.meta.env）。
// 只声明本仓库实际读取的字段，避免把整个 vite/client 类型泄漏到业务代码。
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
