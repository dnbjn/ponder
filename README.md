# Frankencoin Ponder

## Deployment of service

-   Main branch should auto. deploy to: **ponder.zchf.app**
-   Test Deployment deploy to: **ponder.test.zchf.app**

## Ponder needs .env.local

check out ".env.local" file to adjust environment.
For SQLite, REMOVE THE DATABASE_URL LINE.

```
# Select port (default: 3000) and profile
PORT=42069
PONDER_PROFILE=testnet

# RPC URL used for fetching blockchain data. Alchemy is recommended.
RPC_URL_MAINNET=https://eth-mainnet.g.alchemy.com/v2...
RPC_URL_POLYGON=https://polygon-mainnet.g.alchemy.com/v2...

# (Optional) Postgres database URL. If not provided, SQLite will be used.
DATABASE_URL=
```

## Config Files for Multichain Setup

Since Frankencoin transitioned to multichain and updated to the latest Ponder version, there are now two separate configuration files to manage mainnet and testnet deployments.

You can adjust the default chain settings as well as chain-specific parameters in either `ponder.config.mainnet.ts` or `ponder.config.testnet.ts`, depending on your deployment needs.Config Files for Multichain Setup\*\*

## Add / Adjust custom chain(s)

Edit and add your custom chain: "ponder.chains.ts"

Example:

```
export const ethereum3 = {
	id: 1337,
	name: 'Ethereum3',
	nativeCurrency: { name: 'Ethereum3', symbol: 'ETH3', decimals: 18 },
	rpcUrls: {
		default: { http: ['https://ethereum3.domain.com'] },
	},
	blockExplorers: {
		default: { name: 'Blockscout', url: 'https://blockscout3.domain.com' },
	},
} as const satisfies Chain;
```
