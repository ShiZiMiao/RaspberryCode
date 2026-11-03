import { useRaspberryCodeStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useRaspberryCodeStoreWithDefault((state) => state.interfaceMode === "office", false);
}
