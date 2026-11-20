/**
 * 引导通道（bootstrap channel）。
 *
 * 解决的问题：**跨会话启动时，主进程拿不到 host 的管道名。**
 *
 * 同会话时 host 的 stdout 归主进程管，就绪事件里带着自己的管道地址，
 * 顺着 stdout 就回来了（见 `creator.ts`）。跨会话时那条通道不存在：
 * host 由 `CreateProcessAsUser` 直接创建，没有连到主进程的 stdout。
 *
 * 解法是**反向连接**：主进程先建一个名字可预测的管道（引导管道），
 * 把名字通过启动参数传给 host；host 起来后连上它，报出自己的地址，
 * 然后双方各自用真正的业务管道通信。
 *
 * 为什么这条路成立：Windows 命名管道在全局内核对象命名空间
 * （`\Device\NamedPipe`），**不随会话隔离**——这与窗口站、桌面不同。
 * 同一用户在不同会话里的进程可以连同一个管道名。
 *
 * 为什么不用共享文件：需要轮询、需要清理、有读到半截内容的竞态。
 * 管道有天然的连接语义，对端连上才算成功，也不需要事后清理。
 */

import { createServer, createConnection, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";

/** host 通过引导管道报回的自身信息。 */
export interface HostAddressReport {
  /** host 真正监听的管道地址。 */
  socket: string;
  /** host 的进程号。 */
  pid: number;
  /** host 所在的会话号。 */
  sessionId: number;
  /** 协议版本，用于版本不一致时提前失败。 */
  protocolVersion?: number;
}

export interface BootstrapChannel {
  /** 引导管道名，需通过启动参数传给 host。 */
  name: string;
  /**
   * 等待 host 报回地址。
   *
   * 超时即失败——不要无限等，那会让整个启动流程卡住而没有线索。
   */
  waitForAddress(timeoutMs: number): Promise<HostAddressReport>;
  /** 关闭引导管道。拿到地址后立刻调用，不必等 host 断开。 */
  close(): void;
}

/**
 * 引导管道名的前缀。
 *
 * 加前缀是为了在 `\\.\pipe\` 列表里可辨认；后缀用随机 UUID 而不是 pid，
 * 因为同一个进程可能同时带多个 host（不同会话），pid 会撞。
 */
const BOOTSTRAP_PREFIX = "raspberrycode-cua-bootstrap-";

/** 创建一个引导通道。用完必须 `close()`。 */
export function createBootstrapChannel(): BootstrapChannel {
  const id = randomUUID();
  const name =
    process.platform === "win32"
      ? `\\\\.\\pipe\\${BOOTSTRAP_PREFIX}${id}`
      : `/tmp/${BOOTSTRAP_PREFIX}${id}.sock`;

  let server: Server | undefined;
  let settled = false;
  let resolveReport: ((value: HostAddressReport) => void) | undefined;
  let rejectReport: ((error: Error) => void) | undefined;

  const report = new Promise<HostAddressReport>((resolve, reject) => {
    resolveReport = resolve;
    rejectReport = reject;
  });

  server = createServer((socket: Socket) => {
    let buffer = "";
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newlineAt = buffer.indexOf("\n");
      if (newlineAt === -1) return;

      const line = buffer.slice(0, newlineAt).trim();
      buffer = buffer.slice(newlineAt + 1);
      if (!line) return;

      try {
        const parsed = JSON.parse(line) as Partial<HostAddressReport>;
        if (
          typeof parsed.socket !== "string" ||
          typeof parsed.pid !== "number" ||
          typeof parsed.sessionId !== "number"
        ) {
          throw new Error("引导报文缺少 socket/pid/sessionId");
        }
        if (!settled) {
          settled = true;
          resolveReport?.({
            socket: parsed.socket,
            pid: parsed.pid,
            sessionId: parsed.sessionId,
            protocolVersion: parsed.protocolVersion,
          });
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          rejectReport?.(
            new Error(
              `引导报文无法解析：${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }
      // 报完就断开：这个连接的使命结束了，留着只会占资源
      socket.destroy();
    });

    socket.on("error", () => {
      // 单个连接出错不该毁掉整个引导过程：host 可能重连。
      // 真正的失败由超时兜底。
    });
  });

  server.on("error", (error) => {
    if (!settled) {
      settled = true;
      rejectReport?.(new Error(`引导管道监听失败：${error.message}`));
    }
  });

  server.listen(name);

  return {
    name,
    waitForAddress(timeoutMs: number): Promise<HostAddressReport> {
      return new Promise<HostAddressReport>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error(`等待 host 回报地址超时（${timeoutMs}ms）`));
        }, timeoutMs);
        // unref：这个定时器不该单独撑住进程
        timer.unref?.();

        report.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    },
    close(): void {
      if (!settled) {
        settled = true;
        rejectReport?.(new Error("引导通道在收到地址前被关闭"));
      }
      server?.close();
      server = undefined;
    },
  };
}

/**
 * 从 host 侧连上引导管道并报出自身地址。
 *
 * 失败不该让 host 退出：**同会话启动时没有引导管道，那是正常情况。**
 * 调用方根据是否有 `--bootstrap` 参数决定要不要调它。
 */
export function reportAddressToBootstrap(
  bootstrapName: string,
  payload: HostAddressReport,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection(bootstrapName);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`连接引导管道超时（${bootstrapName}）`));
    }, 5_000);
    timer.unref?.();

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(payload)}\n`, () => {
        clearTimeout(timer);
        // 写完就断开：主进程那边收到就会 destroy，不必等它确认
        socket.end();
        resolve();
      });
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`连接引导管道失败：${error.message}`));
    });
  });
}
