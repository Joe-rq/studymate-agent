/**
 * 轻量请求状态总线。
 *
 * 桌宠（PetLayer）订阅真实的 fetch 生命周期来驱动状态，不凭空猜测：
 * - 有活跃请求进行中 → working（视觉上用 thinking 帧近似）
 * - 全部完成且最后无失败 → happy
 * - 最后一个完成的请求失败（网络 / LLM 出错）→ concern
 * 请求结束且无新请求时回到 idle，绝不制造「正在学习」这类虚假状态。
 */
type RequestResult = 'success' | 'error';
type RequestListener = (active: number, lastResult: RequestResult | null) => void;

let active = 0;
let lastResult: RequestResult | null = null;
const listeners = new Set<RequestListener>();

/** 请求开始。 */
export function beginRequest(): void {
  active += 1;
  emit();
}

/** 请求结束。ok=true 表示成功。 */
export function endRequest(ok: boolean): void {
  active = Math.max(0, active - 1);
  lastResult = ok ? 'success' : 'error';
  emit();
}

function emit(): void {
  for (const listener of listeners) listener(active, lastResult);
}

/** 订阅请求状态变化。返回取消订阅函数。 */
export function subscribeRequestState(listener: RequestListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
