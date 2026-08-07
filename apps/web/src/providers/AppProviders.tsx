import type { ReactNode } from "react";
import { RouterProvider } from "../app/router.tsx";
import { UiProvider } from "./UiProvider.tsx";
import { NetworkProvider } from "./NetworkProvider.tsx";
import { WalletProvider } from "./WalletProvider.tsx";
import { VaultProvider } from "./VaultProvider.tsx";

export function AppProviders(props: { children: ReactNode }) {
  return (
    <RouterProvider>
      <UiProvider>
        <VaultProvider>
          <NetworkProvider>
            <WalletProvider>{props.children}</WalletProvider>
          </NetworkProvider>
        </VaultProvider>
      </UiProvider>
    </RouterProvider>
  );
}
