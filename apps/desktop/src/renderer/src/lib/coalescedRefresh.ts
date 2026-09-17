/**
 * 合并刷新原语（移植 Cindy #4602）：同一时刻只保留一个在飞读 + 最新一次失效
 * 标记，尾部合并重读。并发调用共享同一次在飞读；读取途中再次失效会在当前读
 * 完成后立刻补一次读。调用方需在调度前同步失效自己的快照代次。
 * 不持有结果、重试、定时器或所有权决策——纯并发合并。
 */
export function createCoalescedRefresh<T>(): (read: () => Promise<T>) => Promise<T> {
  let active: Promise<T> | undefined;
  let latest: (() => Promise<T>) | undefined;
  return (read) => {
    latest = read;
    if (!active) {
      active = Promise.resolve().then(async () => {
        try {
          let result!: T;
          while (latest) {
            const next = latest;
            latest = undefined;
            try {
              result = await next();
            } catch (error) {
              if (!latest) throw error;
            }
          }
          return result;
        } finally {
          active = undefined;
        }
      });
    }
    return active;
  };
}
