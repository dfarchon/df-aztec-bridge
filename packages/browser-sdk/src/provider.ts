import type { EIP1193Provider } from "viem";

// React's development instrumentation can traverse objects held in component
// state. Some extension providers are proxies whose unrelated properties throw
// when read, so expose only the EIP-1193 surface used by the application.
const adapters = new WeakMap<EIP1193Provider, EIP1193Provider>();

export function toUiSafeProvider(provider: EIP1193Provider): EIP1193Provider {
  const existing = adapters.get(provider);
  if (existing) return existing;

  const safe = { request: provider.request.bind(provider) } as EIP1193Provider;
  if (typeof provider.on === "function") safe.on = provider.on.bind(provider);
  if (typeof provider.removeListener === "function") {
    safe.removeListener = provider.removeListener.bind(provider);
  }
  adapters.set(provider, safe);
  adapters.set(safe, safe);
  return safe;
}
