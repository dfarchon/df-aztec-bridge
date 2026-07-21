# df-aztec-bridge-kit

从 [aztec-kit](https://github.com/AztecProtocol/aztec-kit) 的 **bridge / deploy 桥接逻辑** 抽出的独立工具包：把 **Fee Juice** 从 L1 桥到 Aztec L2 并在 L2 **claim**，让新地址能自己付 gas。

提供两种使用方式：

| 模式 | 入口 | 适用场景 |
|------|------|----------|
| **CLI** | `pnpm cli …` | 脚本、运维、本地一次性充值 |
| **API** | `pnpm api` | 后端集成、异步任务、内部服务 |

浏览器 Wizard（React + MetaMask）仍保留在 `aztec-kit/apps/bridge`；本仓库 **默认 L1 走 GoBridge**（与 UI 相同），也可切 **Portal** 直连。

---

## L1 两条路径分别做什么？

| 路径 | 做什么 | 何时用 |
|------|--------|--------|
| **`gobridge`（默认）** | 调 L1 上 CREATE2 固定的 **GoBridge** 合约：`mintAndBridge`（faucet）或 `approve` + `bridge`，再 `depositToAztecPublic` | 与 aztec-kit 浏览器 bridge 一致；支持后续扩展多收款人 `bridgeMultiple` |
| **`portal`** | Aztec.js **`L1FeeJuicePortalManager.bridgeTokensPublic`**，不经过 GoBridge | 链上未部署 GoBridge、或只想少一层合约时 |

**不是硬性二选一**：L2 等待 + claim 完全相同；差别只在 L1 谁发 deposit。

配置：`config/networks/*.json` 的 `"l1Backend": "gobridge"`，或 `.env` 里 `L1_BACKEND=portal`。CLI：`--l1-backend portal`。

GoBridge 需在各 L1 链部署一次（CREATE2 地址全链相同）：

```bash
DEPLOYER_KEY=0x… pnpm deploy-l1-bridge sepolia   # mainnet | anvil
```

---

## 原理（简版）

1. **L1**：按 `l1Backend` 走 GoBridge 或 Portal — 有 faucet 则 mint，否则转已有 FJ。
2. **等待**：轮询 Aztec node 直到 `isL1ToL2MessageReady`（local 可 `warp` 时间）。
3. **L2**：`FeeJuice.claim`，无 gas 时用 `FeeJuicePaymentMethodWithClaim` 自举（来自 `apps/bridge` 的 claim 流程）。

---

## 环境要求

- **Node.js 22+**
- **pnpm**
- Aztec **5.0.1**（与 `@aztec/aztec.js` 版本一致）
- **本地**：`aztec start --local-network` + L1 Anvil（8080 / 8545）
- **Testnet / Mainnet**：L1 钱包私钥、稳定 L1 RPC；主网无 faucet，需自备 FJ

---

## 配置

### 1. 复制环境变量

```bash
cp .env.example .env
```

### 2. 网络预设

编辑 `config/networks/<id>.json`：

| 文件 | 用途 |
|------|------|
| `local.json` | 本地 Anvil + 本地 node |
| `testnet.json` | Sepolia + Aztec testnet RPC |
| `mainnet.json` | Ethereum mainnet + Aztec mainnet RPC |

字段说明：

- `aztecNodeUrl` — Aztec JSON-RPC
- `l1RpcUrl` — 以太坊 RPC（L1 交易）
- `l1ChainId` — 1 或 11155111 等
- `bridgeTiming` — `warp`（仅 local）或 `poll`

环境变量可覆盖 JSON：`AZTEC_NODE_URL`、`L1_RPC_URL`、`L1_CHAIN_ID`、`AZTEC_API_KEY`、`NETWORK`、`L1_PRIVATE_KEY`。

---

## 公共参考配置（可复制）

以下为仓库默认与从 Aztec node 拉取的 **公开信息**（Aztec **5.0.1**）。  
**L1 合约地址**（`feeJuice` / `portal` / `faucet`）随 rollup 升级可能变化，上线前请用文末命令向 node 复核；**GoBridge** 为 CREATE2 固定地址，与链无关。

### 全环境相同

| 项 | 值 |
|----|-----|
| Aztec.js / 网络版本 | **5.0.1** |
| **GoBridge**（L1，`l1Backend=gobridge`） | `0xF8235ceEe817bE9221FD3B5D0a799Ec6A158f971` |
| CREATE2 部署代理（仅运维部署时用） | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |

### Testnet（Aztec Testnet + L1 Sepolia）

**官方 RPC（可写在 `config/networks/testnet.json` 或 `.env`）**

| 项 | 值 |
|----|-----|
| `NETWORK` | `testnet` |
| `AZTEC_NODE_URL` | `https://v5.testnet.rpc.aztec-labs.com` |
| `L1_RPC_URL` | `https://sepolia.drpc.org`（建议换成自有 Sepolia RPC） |
| `L1_CHAIN_ID` | `11155111` |
| `bridgeTiming` | `poll` |
| `l1Backend` | `gobridge`（或 `portal`） |
| Bootnodes | `http://static.aztec.network/testnet/bootnodes.json` |

**L1 合约（Sepolia，来源：testnet node `getNodeInfo`）**

| 合约 | 地址 |
|------|------|
| Fee Juice（L1 ERC20） | `0x762c132040fda6183066fa3b14d985ee55aa3c18` |
| FeeJuicePortal | `0xb4a9f8eadc8ca944729d61e59a9f491faff237a3` |
| Fee Asset Handler（faucet，有则可 `mintAndBridge`） | `0x5602c39a6e9c5ace589f64f754927bcda4f4bfc9` |

**`.env` 模板（把私钥和 RPC 换成你的）**

```env
NETWORK=testnet
AZTEC_NODE_URL=https://v5.testnet.rpc.aztec-labs.com
L1_RPC_URL=https://sepolia.drpc.org
L1_CHAIN_ID=11155111
L1_BACKEND=gobridge

# 必填：Sepolia 上签 bridge 的钱包（需 Sepolia ETH；无 FJ 时可走 faucet）
L1_PRIVATE_KEY=0x你的私钥

# 若 RPC 提供商要求 API Key（例如 gateway / dRPC）
# AZTEC_API_KEY=
```

**一键试跑（新建 L2 账户并充值）**

```bash
pnpm cli --network testnet run --amount 1000 --create-account
# 私钥已在 .env 时可省略 --l1-key
```

---

### Mainnet（Aztec Alpha + L1 Ethereum）

| 项 | 值 |
|----|-----|
| `NETWORK` | `mainnet` |
| `AZTEC_NODE_URL` | `https://aztec-mainnet.drpc.org` |
| `L1_RPC_URL` | `https://eth.drpc.org`（生产请用自有主网 RPC） |
| `L1_CHAIN_ID` | `1` |
| `bridgeTiming` | `poll` |
| `l1Backend` | `gobridge` |
| Bootnodes | `http://static.aztec.network/mainnet/bootnodes.json` |

**L1 合约（Ethereum mainnet，来源：mainnet node）**

| 合约 | 地址 |
|------|------|
| Fee Juice（L1 ERC20） | `0xa27ec0006e59f245217ff08cd52a7e8b169e62d2` |
| FeeJuicePortal | `0xaf73dd51d1eb8a079bb097f39c832cdd00ac691c` |
| Fee Asset Handler | **无**（`null` → 必须自备 L1 FJ + `approve`/`bridge`） |

**`.env` 模板**

```env
NETWORK=mainnet
AZTEC_NODE_URL=https://aztec-mainnet.drpc.org
L1_RPC_URL=https://eth.drpc.org
L1_CHAIN_ID=1
L1_BACKEND=gobridge

L1_PRIVATE_KEY=0x你的私钥

# 主网 Aztec / L1 RPC 若需鉴权
# AZTEC_API_KEY=
```

**部署 GoBridge（链上尚无 bytecode 时，一次性）**

```bash
DEPLOYER_KEY=0x… RPC_URL=https://eth.drpc.org pnpm deploy-l1-bridge mainnet
```

---

### Local（`aztec start --local-network` + Anvil）

| 项 | 值 |
|----|-----|
| `NETWORK` | `local` |
| `AZTEC_NODE_URL` | `http://localhost:8080` |
| `L1_RPC_URL` | `http://localhost:8545` |
| `L1_CHAIN_ID` | `31337` |
| `bridgeTiming` | `warp` |
| `l1Backend` | `gobridge` |

**L1 合约地址**：随本地 rollup 实例变化，**不要写死**；启动本地 node 后用下方「复核 L1 地址」命令查询。

**`.env` 模板（私钥可省略，默认 Anvil #0）**

```env
NETWORK=local
AZTEC_NODE_URL=http://localhost:8080
L1_RPC_URL=http://localhost:8545
L1_CHAIN_ID=31337
L1_BACKEND=gobridge

# 可选；不填则使用 Anvil 第一把开发钥
# L1_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**本地前置命令**

```bash
# 终端 1
aztec start --local-network

# 终端 2（GoBridge 模式建议）
pnpm deploy-l1-bridge anvil

pnpm cli --network local run --amount 1000 --create-account
```

---

### API 模式补充（任意网络）

```env
API_HOST=127.0.0.1
API_PORT=8787
DATA_DIR=./data
```

---

### 复核当前网络的 L1 合约地址

```bash
# 将 URL 换成你的 AZTEC_NODE_URL
node --import tsx -e "
import { createNode } from './src/core/node.ts';
import { fetchL1Addresses } from './src/core/l1/l1-addresses.ts';
const url = process.env.AZTEC_NODE_URL ?? 'https://v5.testnet.rpc.aztec-labs.com';
const node = createNode(url, process.env.AZTEC_API_KEY);
console.log(await fetchL1Addresses(node));
"
```

打印 **GoBridge** 确定性地址：

```bash
node --import tsx -e "import { getBridgeAddress } from './src/vendor/gobridge/deterministic.ts'; console.log(getBridgeAddress());"
```

---

### 3. 安装与构建

```bash
pnpm install
pnpm build
```

---

## CLI 模式

```bash
# 列出网络
pnpm cli networks

# 全流程：L1 bridge → 等消息 → L2 claim（新建 Aztec 账户并充值）
pnpm cli --network testnet run --amount 1000 --create-account --l1-key 0x...

# 充值到已有 Aztec 地址（需该地址对应 L2 secret 已在链上部署过账户）
pnpm cli --network testnet run --amount 1000 --recipient <aztec_address> --l1-key 0x... --l2-secret 0x...

# 仅 L1，输出 claim credentials（稍后再 claim）
pnpm cli --network testnet l1-bridge --amount 1000 --recipient <aztec_address> --l1-key 0x... -o claim.json

# 从 credentials 文件 claim
pnpm cli --network testnet claim --credentials claim.json --l2-secret 0x...
```

本地示例（Anvil 默认 dev key，无需 `L1_PRIVATE_KEY`）：

```bash
aztec start --local-network   # 另开终端
pnpm cli --network local run --amount 1000 --create-account
```

---

## API 模式

```bash
pnpm api
# 默认 http://127.0.0.1:8787
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/v1/networks` | 可用 network id |
| POST | `/v1/bridge` | 提交异步桥接任务 |
| GET | `/v1/jobs/:id` | 查询任务状态/结果 |

**POST /v1/bridge** 示例：

```json
{
  "network": "testnet",
  "amountFj": "1000",
  "createAccount": true,
  "l1PrivateKey": "0x..."
}
```

返回 `202` + `{ "jobId": "...", "status": "queued" }`。任务状态与结果写入 `DATA_DIR`（默认 `./data`）。

> API 若接收 `l1PrivateKey` 只适合内网；生产请走网关 + 仅注入 env，勿把密钥打进请求体。

---

## 与 aztec-kit bridge 的对应关系

| aztec-kit | 本仓库 |
|-----------|--------|
| `apps/bridge/src/services/l2/claim.ts` | `src/core/claim.ts` |
| `packages/common/src/deploy/bridging.ts` | `src/core/bridging.ts` |
| `packages/common/src/node/create-node.ts` | `src/core/node.ts` |
| `apps/bridge` Wizard UI | 仍在 aztec-kit |
| `apps/bridge/src/services/l1/bridge.ts` | `src/core/l1/gobridge.ts` |
| `packages/common/src/deploy/bridging.ts` | `src/core/bridging.ts`（Portal 路径） |
| GoBridge 合约 | `contracts/ethereum/solidity` + `src/vendor/gobridge/` |

---

## 目录结构

```
config/networks/     # 网络 JSON
src/core/            # 桥接 + claim + pipeline
src/cli/             # 命令行
src/api/             # HTTP 服务
data/                # API 任务持久化（gitignore）
```

---

## 常见问题

- **主网**：必须配置 `L1_PRIVATE_KEY`，且 L1 账户有足够 **ETH + FJ**（无 faucet）。
- **dRPC / gateway**：在 `.env` 设置 `AZTEC_API_KEY`，或在 network JSON 里用 `"apiKey": "${VITE_MAINNET_API_KEY}"` 并在 build 前导出变量（CLI 运行时直接读 `AZTEC_API_KEY` 即可）。
- ** proving 慢**：远程网络默认开启 prover；local 可关（pipeline 里 local 已 `proverEnabled: false`）。

---

## License

与上游 aztec-kit 保持一致（若单独发布请自行补充 LICENSE）。
