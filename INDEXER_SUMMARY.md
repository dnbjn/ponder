# Frankencoin Ponder Indexer - Comprehensive Summary

## Executive Overview

This is a production blockchain indexer for the Frankencoin (ZCHF) decentralized stablecoin ecosystem, built on Ponder framework. It indexes events from **8 blockchain networks** (Ethereum mainnet + 7 L2s: Polygon, Arbitrum, Optimism, Base, Avalanche, Gnosis, Sonic) and exposes all data via a GraphQL API.

**Deployment:**
- Production: `ponder.zchf.app`
- Test: `ponder.test.zchf.app`

**Technology Stack:**
- Framework: Ponder v0.11.2 (blockchain indexing framework)
- Database: PostgreSQL (production) / SQLite (development)
- API: Hono + GraphQL
- Blockchain Library: Viem v2.13.8
- Contract Package: `@frankencoin/zchf` (addresses and ABIs)

---

## Architecture

### Multichain Support

The indexer implements a **native + bridged** architecture:

**Native Chain (Ethereum Mainnet only):**
- Core Frankencoin contracts (minting, governance, equity)
- MintingHub V1 & V2 (collateralized position creation)
- Position contracts V1 & V2 (dynamically discovered)
- Equity token (FPS) trading and governance
- Savings V2 contract
- Position Roller V2
- Uniswap V3 price discovery pool

**Bridged Chains (All 8 chains):**
- CCIP-bridged Frankencoin token
- Bridged Savings contracts
- Transfer Reference (cross-chain tracking)

**Chain Configuration (`ponder.config.ts`):**
```typescript
config[chainId] = {
  rpc: string,              // Alchemy RPC endpoint
  maxRequestsPerSecond: 50, // Rate limiting
  pollingInterval: 5000,    // 5s block polling
  start{Contract}: number   // Start block per contract
}
```

### Data Model Pattern

All tables use **composite primary keys with `chainId`** to support multichain data:

```typescript
primaryKey({ columns: [table.chainId, table.identifier] })
```

This enables:
- Single database for all chains
- Easy filtering by chain
- Cross-chain aggregations
- No data conflicts between chains

### Dynamic Contract Discovery

Uses Ponder's `factory()` pattern for contracts deployed at runtime:

1. **Position Contracts (V1/V2):** Discovered from `PositionOpened` events on MintingHub
2. **ERC20 Collateral Tokens:** Discovered from position collateral parameters

---

## Schema Breakdown (44+ Tables)

### 1. Frankencoin Core (Mainnet Only)

**Tables:** `FrankencoinMinter`, `FrankencoinProfitLoss`

**Purpose:** Tracks minter applications and profit/loss events

**Key Fields:**
- `FrankencoinMinter`: Minter applications with approval status, fees, and veto tracking
- `FrankencoinProfitLoss`: Time-series profit/loss events with per-FPS calculations

**Indexed Events:** `MinterApplied`, `MinterDenied`, `Profit`, `Loss`

---

### 2. Equity (FPS Token) - Mainnet Only

**Tables:** `EquityDelegation`, `EquityTrade`, `EquityTradeChart`

**Purpose:** Tracks FPS token trading, prices, and voting delegation

**Key Fields:**
- `EquityDelegation`: Voting power delegation mapping (owner → delegatedTo)
- `EquityTrade`: Full trade history with price, shares, ZCHF amount
- `EquityTradeChart`: Price time-series for charting (timestamp → lastPrice)

**Trade Types:** `Trade`, `Mint`, `Redeem`

**Indexed Events:** `Trade`, `Delegation`

---

### 3. MintingHub V1 - Mainnet Only

**Tables:**
- `MintingHubV1Status`
- `MintingHubV1PositionV1`
- `MintingHubV1OwnerTransfersV1`
- `MintingHubV1MintingUpdateV1`
- `MintingHubV1ChallengeV1`
- `MintingHubV1ChallengeBidV1`

**Purpose:** Complete lifecycle tracking of V1 collateralized debt positions

**Position Fields:**
```typescript
{
  position: Address,           // Position contract address
  owner: Address,
  collateral: Address,         // ERC20 collateral token
  price: bigint,              // Liquidation price
  created: bigint,            // Timestamp
  isOriginal: boolean,
  isClone: boolean,
  denied: boolean,
  closed: boolean,
  minimumCollateral: bigint,
  annualInterestPPM: number,  // Annual interest in parts per million
  reserveContribution: number, // Fee in PPM
  start: bigint,              // Position start time
  cooldown: bigint,
  expiration: bigint,
  challengePeriod: bigint,
  collateralBalance: bigint,
  limitForPosition: bigint,   // Max minting limit
  minted: bigint,             // Current minted amount
  // Token metadata (name, symbol, decimals) for both ZCHF and collateral
}
```

**Challenge System:**
- Tracks active challenges with liquidation price, size, duration
- Bid-by-bid tracking with `ChallengeBidV1` table
- Status: "Active" | "Success"
- Bid types: "Averted" (position saved) | "Succeeded" (position liquidated)

**Counters:** Status table tracks event counters per position for efficient pagination

---

### 4. MintingHub V2 - Mainnet Only

**Tables:**
- `MintingHubV2Status`
- `MintingHubV2PositionV2`
- `MintingHubV2OwnerTransfersV2`
- `MintingHubV2MintingUpdateV2`
- `MintingHubV2ChallengeV2`
- `MintingHubV2ChallengeBidV2`

**Key Differences from V1:**
- `riskPremiumPPM` instead of `annualInterestPPM`
- `parent` field for position genealogy
- `basePremiumPPM` + `riskPremiumPPM` in minting updates
- `availableForMinting` (unlocked amount) vs V1's separate limits
- `start` is integer (not bigint)
- `expiration` is integer (not bigint)
- `challengePeriod` is integer (not bigint)

**Position Schema:** Nearly identical to V1 but with V2-specific fields

---

### 5. Savings (Multichain)

**Tables:**
- `SavingsStatus` (per chain, per module)
- `SavingsMapping` (per account, per module, per chain)
- `SavingsActivity` (time-series events)
- `SavingsReferrerMapping` (referral tracking)
- `SavingsReferrerEarnings` (referrer earnings per account)

**Purpose:** Complete savings account tracking with interest accrual and referral system

**Key Fields:**

`SavingsStatus` (module-level aggregates):
```typescript
{
  chainId: number,
  module: Address,            // Savings contract address
  updated: bigint,
  save: bigint,              // Cumulative deposits
  withdraw: bigint,          // Cumulative withdrawals
  interest: bigint,          // Cumulative interest paid
  balance: bigint,           // Current total balance (excl. real-time accrual)
  rate: number,              // Current interest rate (PPM)
  counterSave: bigint,       // Event counters
  counterWithdraw: bigint,
  counterInterest: bigint,
  counterRateProposed: bigint,
  counterRateChanged: bigint,
}
```

`SavingsMapping` (per-account tracking):
```typescript
{
  chainId: number,
  module: string,
  account: string,
  created: bigint,           // First activity timestamp
  updated: bigint,           // Latest activity timestamp
  save: bigint,             // Cumulative deposits
  withdraw: bigint,         // Cumulative withdrawals
  interest: bigint,         // Cumulative interest received
  balance: bigint,          // Current balance (excl. real-time accrual)
  counterSave: bigint,
  counterWithdraw: bigint,
  counterInterest: bigint,
}
```

`SavingsActivity` (time-series events):
```typescript
{
  chainId, module, account, created, blockheight,
  count: bigint,            // Activity counter
  txHash: Address,
  kind: string,             // "Saved" | "Withdrawn" | "Interest"
  amount: bigint,           // Activity amount
  rate: number,             // Rate at time of activity
  save: bigint,             // Cumulative at this point
  withdraw: bigint,
  interest: bigint,
  balance: bigint,          // Balance after this activity
}
```

**Referral System:**
- `SavingsReferrerMapping`: Links accounts to their referrers with fee share
- `SavingsReferrerEarnings`: Tracks total earnings per referrer per account

---

### 6. Lead Rate (Interest Rate Governance) - Multichain

**Tables:** `LeadrateRateChanged`, `LeadRateProposed`

**Purpose:** Track interest rate changes and proposals across all savings modules

**Key Fields:**
- `LeadrateRateChanged`: Approved rate changes with timestamp
- `LeadRateProposed`: Proposed rates with proposer and activation time (`nextChange`)

**Contracts:** Tracks both SavingsV2 and SavingsReferral contracts on mainnet, and bridged savings on all L2s

---

### 7. ERC20 Tracking (Multichain)

**Tables:**
- `ERC20Status` (per token, per chain)
- `ERC20Mint` (mint events)
- `ERC20Burn` (burn events)
- `ERC20TotalSupply` (time-series supply)
- `ERC20Balance` (transfer history)
- `ERC20BalanceMapping` (current balances per account)

**Purpose:** Complete ERC20 token tracking for Frankencoin, Equity, and collateral tokens

**Tracked Tokens:**
- ZCHF (all chains)
- FPS/Equity (mainnet only)
- Position collateral tokens (mainnet only, optional via `INDEX_ERC20POSITION_V1/V2` env vars)

**Balance Tracking:**
```typescript
ERC20BalanceMapping: {
  chainId, token, account,
  updated: bigint,
  mint: bigint,              // Cumulative mints to this account
  burn: bigint,              // Cumulative burns from this account
  balance: bigint,           // Current balance
}

ERC20Balance: {              // Full transfer history
  chainId, token, count, txHash, created, blockheight,
  from, to, amount,
  balanceFrom: bigint,       // Balance of sender after transfer
  balanceTo: bigint,         // Balance of receiver after transfer
}
```

**Helper Library:** `src/lib/ERC20Balance.ts` - `indexERC20Balance()` handles upserts with balance calculations

---

### 8. Cross-Chain Bridge Accounting - Mainnet Only

**Tables:** `BridgedAccountingReceivedSettlement`

**Purpose:** Track CCIP bridge settlements between mainnet and L2s

**Key Fields:**
```typescript
{
  chain: bigint,             // Remote chain ID
  sender: Address,           // Bridge sender
  created: bigint,
  count: bigint,
  kind: string,              // Settlement type
  profits: bigint,
  losses: bigint,
}
```

**Contract:** `CCIPBridgedAccounting` on mainnet

---

### 9. Transfer Reference (Multichain)

**Tables:** `TransferReference`

**Purpose:** Track transfers with reference strings (payment memos) and cross-chain transfers

**Key Fields:**
```typescript
{
  chainId, count, created, txHash,
  sender: Address,
  from: Address,
  to: Address,
  toBytes: Address,          // Recipient as bytes (for cross-chain)
  targetChain: bigint,       // Destination chain ID
  amount: bigint,
  reference: string,         // Payment memo/reference
}
```

**Indexed Events:** `TransferReference`, `CrossChainTransfer`

---

### 10. Price Discovery - Mainnet Only

**Tables:** `PriceDiscovery`

**Purpose:** Track ZCHF price from Uniswap V3 pool

**Key Fields:**
```typescript
{
  txHash, sender, source,
  created: bigint,
  blockheight: bigint,
  count: bigint,
  price: bigint,             // ZCHF price
  oracle: bigint,            // Oracle price (if available)
}
```

**Source:** Uniswap V3 ZCHF/USDT pool swaps

---

### 11. Position Roller V2 - Mainnet Only

**Tables:** `RollerV2Rolled`

**Purpose:** Track position rollovers (migrating collateral from one position to another)

**Key Fields:**
```typescript
{
  created, count, blockheight,
  owner: Address,
  source: Address,           // Source position
  collWithdraw: bigint,      // Collateral withdrawn from source
  repay: bigint,             // ZCHF repaid on source
  target: Address,           // Target position
  collDeposit: bigint,       // Collateral deposited to target
  mint: bigint,              // ZCHF minted on target
}
```

---

### 12. Position Aggregates (Performance Optimization) - Mainnet Only

**Tables:** `PositionAggregatesV1`, `PositionAggregatesV2`

**Purpose:** Cache pre-computed position totals to eliminate N+1 query patterns

**Schema:**
```typescript
{
  chainId: number,              // Primary key
  totalMinted: bigint,          // Sum of all open position minted amounts
  annualInterests: bigint,      // Sum of annual interest across all open positions
  updated: bigint,              // Last update timestamp
}
```

**Update Mechanism:**
- Recalculated on every `MintingUpdate` event
- Queries all open positions (closed=false, denied=false, minted>0)
- V1 formula: `annualInterests = sum(minted * annualInterestPPM / 1_000_000)`
- V2 formula: `annualInterests = sum(minted * (riskPremiumPPM + mintLeadRate) / 1_000_000)`

**Performance Impact:**
- Before: 1000+ DB queries per transaction (N+1 pattern)
- After: 2 DB queries per transaction (O(1) aggregate reads)
- 100-1000x reduction in database load for transaction logging

---

### 13. Analytics & Aggregations - Mainnet Only

**Tables:** `AnalyticTransactionLog`, `AnalyticDailyLog`

**Purpose:** Pre-computed analytics snapshots for dashboard and reporting

**Computed Metrics (updated on every relevant transaction):**

```typescript
{
  // Equity metrics
  totalInflow: bigint,            // Cumulative equity profits
  totalOutflow: bigint,           // Cumulative equity losses
  totalTradeFee: bigint,          // Trading fees paid
  earningsPerFPS: bigint,         // Cumulative earnings per FPS share

  // Token supplies
  totalSupply: bigint,            // ZCHF total supply
  totalEquity: bigint,            // Reserve/equity balance
  totalSavings: bigint,           // Total in savings (excl. real-time interest)
  fpsTotalSupply: bigint,         // FPS total supply
  fpsPrice: bigint,               // FPS price from contract

  // Position metrics (read from aggregates)
  totalMintedV1: bigint,          // Total ZCHF minted in V1 positions
  totalMintedV2: bigint,          // Total ZCHF minted in V2 positions

  // Dual lead rate system
  currentMintLeadRate: bigint,    // Mint rate from SavingsV2 (for V2 positions)
  currentSaveLeadRate: bigint,    // Save rate from SavingsReferral (for savings projections)
  projectedInterests: bigint,     // Projected annual interest payments (using save rate)
  annualV1Interests: bigint,      // Annual interest from V1 positions
  annualV2Interests: bigint,      // Annual interest from V2 positions (using mint rate)
  annualV1BorrowRate: bigint,     // Weighted avg V1 borrow rate
  annualV2BorrowRate: bigint,     // Weighted avg V2 borrow rate

  // Net earnings
  annualNetEarnings: bigint,      // Annual earnings - savings costs
  realizedNetEarnings: bigint,    // Rolling 365-day realized earnings
}
```

**Dual Lead Rate System:**

The indexer tracks two separate interest rates:

1. **Mint Lead Rate** (from SavingsV2 contract):
   - Used for Position V2 interest calculations
   - Combined with position's `riskPremiumPPM`
   - Reflects borrowing costs for V2 positions
   - Stored in `currentMintLeadRate`

2. **Save Lead Rate** (from SavingsReferral contract):
   - Used for savings projections and interest payments
   - More saver-friendly rate (deployed later)
   - Stored in `currentSaveLeadRate`
   - Fallback: Uses mint rate if save rate unavailable
   - If both unavailable: defaults to 0

**Rate Calculation Example:**
```typescript
// V2 position annual interest
annualV2Interest = minted * (riskPremiumPPM + mintLeadRatePPM) / 1_000_000

// Savings projected interest
projectedInterests = totalSavings * saveLeadRatePPM / 1_000_000
```

**AnalyticTransactionLog:** Time-series snapshots on every significant transaction (with counter)

**AnalyticDailyLog:** Daily rollup (one entry per day at midnight UTC)

**Helper Library:** `src/lib/TransactionLog.ts` - `updateTransactionLog()` computes all metrics

**Calculation Details:**
- Reads from `CommonEcosystem` aggregates (batched query for O(1) lookups)
- Makes on-chain calls for real-time supply/price data
- Fetches mint rate from SavingsV2 contract
- Fetches save rate from SavingsReferral contract (with mint rate fallback)
- Reads pre-computed aggregates from `PositionAggregatesV1` and `PositionAggregatesV2` (O(1) instead of N+1)
- Performs 365-day rolling window for realized earnings

**Performance Optimizations:**
- Position totals read from aggregate tables (2 queries instead of 1000+)
- Ecosystem metrics batched into single query using `inArray`
- Efficient BigInt arithmetic for date calculations

---

### 14. Common/Utility Tables

**Tables:** `ActiveUser`, `CommonEcosystem`

**Purpose:** Track active users and store key-value aggregates

**CommonEcosystem Examples:**
```
Equity:Profits                    - Total equity profits
Equity:Losses                     - Total equity losses
Equity:InvestedFeePaidPPM        - Cumulative investment fees
Equity:RedeemedFeePaidPPM        - Cumulative redemption fees
Equity:EarningsPerFPS            - Cumulative earnings per share
Savings:TotalSaved               - Total deposits
Savings:TotalInterestCollected   - Total interest paid
Savings:TotalWithdrawn           - Total withdrawals
Analytics:TransactionLogCounter  - Counter for analytics entries
```

**ActiveUser:** Tracks last active timestamp per user address (used for DAU/MAU metrics)

---

## Event Handler Patterns

### Handler Organization

Event handlers mirror schema files by name:
- `src/Frankencoin.ts` → `schema/Frankencoin.ts`
- `src/MintingHubV1.ts` → `schema/MintingHubV1.ts`
- `src/Equity.ts` → `schema/Equity.ts`
- etc.

### Handler Structure

```typescript
import { ponder } from 'ponder:registry';

ponder.on('ContractName:EventName', async ({ event, context }) => {
  const { args, block, transaction, log } = event;
  const { db, client, chain } = context;

  // 1. Extract event data
  const chainId = chain.id;
  const timestamp = block.timestamp;

  // 2. Perform database upserts
  await db.insert(TableName)
    .values({ /* ... */ })
    .onConflictDoUpdate((current) => ({
      // Compute updates based on current state
      field: current.field + newValue
    }));

  // 3. Make on-chain reads if needed
  const data = await client.readContract({
    abi: ContractABI,
    address: contractAddress,
    functionName: 'functionName',
  });

  // 4. Call helper libraries
  await updateTransactionLog({ client, db, chainId, timestamp, ... });
  await indexERC20Balance(event, context, { /* options */ });
});
```

### Key Patterns

**1. Upsert with Computed Updates:**
```typescript
.onConflictDoUpdate((current) => ({
  balance: current.balance + amount,
  counter: current.counter + 1n,
  updated: timestamp,
}))
```

**2. Address Normalization:**
```typescript
const address = event.args.address.toLowerCase() as Address;
```

**3. Composite Keys:**
```typescript
primaryKey({ columns: [table.chainId, table.identifier] })
```

**4. Counter-based Pagination:**
- Most tables include a `count` field that increments
- Enables efficient pagination and event ordering
- Status tables track counters for each entity

**5. Cross-chain Reads:**
```typescript
// context.client is locked to event source chain
// For cross-chain reads, create separate client:
import { createPublicClient, http } from 'viem';
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(config[mainnet.id].rpc),
});
```

---

## Helper Libraries

### 1. `src/lib/TransactionLog.ts`

**Function:** `updateTransactionLog()`

**Purpose:** Update analytics snapshots on every major transaction

**When Called:** Equity trades, position operations, minting/burning

**What It Does:**
1. Batches `CommonEcosystem` queries using `inArray` for O(1) lookups
2. Makes on-chain calls for real-time supply/price data
3. Fetches both mint and save lead rates separately (with fallback logic)
4. Reads position aggregates from `PositionAggregatesV1/V2` (O(1) instead of N+1)
5. Computes annual vs realized net earnings (365-day rolling window)
6. Inserts into `AnalyticTransactionLog` (time-series)
7. Upserts into `AnalyticDailyLog` (daily rollup)

**Performance:** Optimized to minimize DB queries and use pre-computed aggregates

**Limitation:** Mainnet only (requires refactor for multichain support)

### 2. `src/lib/ERC20Balance.ts`

**Function:** `indexERC20Balance()`

**Purpose:** Track ERC20 transfers with balance snapshots

**Parameters:**
- `indexFrom`: Track sender balance (default: true)
- `indexTo`: Track receiver balance (default: true)
- `indexEntry`: Store transfer history entry (default: true)

**What It Does:**
1. Updates `ERC20Status` (increments transfer counter)
2. Updates `ERC20BalanceMapping` for sender (balance - value)
3. Updates `ERC20BalanceMapping` for receiver (balance + value)
4. Inserts into `ERC20Balance` (full transfer history)

**Special Handling:** Skips zero address (mint/burn events handled separately)

### 3. `src/lib/ERC20MintBurn.ts`

**Functions:** `indexERC20Mint()`, `indexERC20Burn()`

**Purpose:** Track mint/burn events separately from transfers

**What They Do:**
1. Update `ERC20Status` (increment mint/burn counters, update supply)
2. Insert into `ERC20Mint` or `ERC20Burn` tables
3. Update `ERC20TotalSupply` (time-series supply tracking)
4. Call `indexERC20Balance()` if needed for balance tracking

---

## GraphQL API

### Endpoint

`/` (root) - Auto-generated GraphQL endpoint

### Implementation

```typescript
// src/api/index.ts
import { db } from 'ponder:api';
import schema from 'ponder:schema';
import { Hono } from 'hono';
import { graphql } from 'ponder';

const app = new Hono();
app.use('/', graphql({ db, schema }));
```

### Auto-Generated Schema

Ponder automatically generates GraphQL types from all `onchainTable` definitions:

**For each table, you get:**
1. **Single Item Query:** `tableName(id: ID!): TableName`
2. **List Query:** `tableNames(filter: FilterInput, orderBy: OrderInput, limit: Int, offset: Int): [TableName!]!`
3. **Count Query:** `tableNamesCount(filter: FilterInput): Int!`

**Example Queries:**

```graphql
# Get specific position
query {
  MintingHubV2PositionV2(id: "0x123...") {
    position
    owner
    collateral
    minted
    price
    closed
  }
}

# List all open positions
query {
  MintingHubV2PositionV2s(
    filter: { closed: false, denied: false }
    orderBy: "created"
    limit: 100
  ) {
    position
    owner
    collateral
    minted
    availableForMinting
  }
}

# Get savings for specific account
query {
  SavingsMappings(
    filter: {
      chainId: 1,
      module: "0x...",
      account: "0x..."
    }
  ) {
    save
    withdraw
    interest
    balance
  }
}

# Get daily analytics
query {
  AnalyticDailyLogs(
    orderBy: "timestamp"
    limit: 365
  ) {
    date
    totalSupply
    totalEquity
    totalSavings
    fpsTotalSupply
    fpsPrice
    annualNetEarnings
    realizedNetEarnings
  }
}

# Get all ERC20 balances for account
query {
  ERC20BalanceMappings(
    filter: { account: "0x..." }
  ) {
    chainId
    token
    balance
    updated
  }
}
```

### Filter Operators

Ponder supports:
- `eq`, `ne` (equals, not equals)
- `gt`, `gte`, `lt`, `lte` (comparisons)
- `in`, `notIn` (array membership)
- `contains`, `startsWith`, `endsWith` (string matching)
- `and`, `or` (logical combinations)

---

## Key Insights for API Application Design

### 1. Data Availability

**Multichain Data:**
- All tables with `chainId` support 8 chains
- Filter by chain for single-chain queries
- Aggregate across chains for totals

**Historical Data:**
- All events since contract deployment (see `ponder.config.ts` for start blocks)
- Transfer history, balance snapshots, price time-series
- Activity logs with timestamps and counters for pagination

### 2. Pre-Computed Aggregations

**Analytics Tables Are Pre-Computed:**
- `AnalyticTransactionLog`: Every transaction with full ecosystem snapshot
- `AnalyticDailyLog`: Daily rollups (one query for 365 days of data)
- `CommonEcosystem`: Key-value store for global aggregates
- `SavingsStatus`, `ERC20Status`: Per-module/per-token rollups

**Don't Re-Compute:**
- Total supply, equity, savings balance → Use `AnalyticDailyLog`
- Interest rates, net earnings → Use `AnalyticDailyLog`
- Cumulative deposits/withdrawals → Use `SavingsMapping`
- Token balances → Use `ERC20BalanceMapping`

### 3. Real-Time Interest Accrual

**Important:** Savings balances in database **exclude real-time interest accrual**

To get current balance with accrued interest:
1. Get `balance` from `SavingsMapping`
2. Get `rate` from `SavingsStatus`
3. Get `updated` timestamp
4. Calculate: `currentBalance = balance + (balance * rate * timeElapsed / 365 days / 1_000_000)`

**Or:** Make on-chain call to Savings contract for exact balance

### 4. Position Lifecycle

**V1 & V2 Positions Go Through:**
1. **Opened:** `PositionOpened` event → Create entry in `MintingHubV{n}PositionV{n}`
2. **Minting Updates:** `MintingUpdate` events → Insert into `MintingUpdateV{n}` table
3. **Owner Transfers:** `OwnershipTransferred` events → Insert into `OwnerTransfersV{n}` table
4. **Challenged:** `ChallengeStarted` event → Insert into `ChallengeV{n}` table
5. **Bids:** `NewBid` events → Insert into `ChallengeBidV{n}` table
6. **Success/Averted:** Update challenge status
7. **Closed:** `PositionDenied` or `isClosed()` → Update `denied` or `closed` flag

**Query Pattern:**
- Position details: `MintingHubV{n}PositionV{n}` (single source of truth)
- Position history: Join with `OwnerTransfersV{n}`, `MintingUpdateV{n}`, `ChallengeV{n}`
- Use `{table}Status.{event}Counter` for pagination

### 5. Challenge System

**Active Challenges:**
```graphql
MintingHubV2ChallengeV2s(filter: { status: "Active" }) {
  position
  number
  challenger
  start
  duration
  size
  liqPrice
  filledSize
  bids
}
```

**Challenge Bids:**
```graphql
MintingHubV2ChallengeBidV2s(
  filter: { position: "0x...", number: 1 }
  orderBy: "numberBid"
) {
  bidder
  bid
  price
  bidType
  acquiredCollateral
}
```

### 6. Cross-Chain Transfer Tracking

**TransferReference Table:**
- Captures cross-chain transfers with `targetChain` field
- Reference strings enable payment memos
- Track bridge accounting via `BridgedAccountingReceivedSettlement`

**Pattern:**
1. User sends ZCHF on mainnet with reference
2. Event captured in `TransferReference` on mainnet
3. Bridge settles on L2
4. L2 transfer captured in `TransferReference` on L2 chain
5. Settlement recorded in `BridgedAccountingReceivedSettlement` on mainnet

### 7. Price Discovery

**Sources:**
1. **Uniswap V3 ZCHF/USDT Pool:** `PriceDiscovery` table (swap events)
2. **FPS Price:** `AnalyticDailyLog.fpsPrice` (on-chain contract call)
3. **Position Liquidation Prices:** `MintingHubV{n}PositionV{n}.price`

**Time-Series Charting:**
- `EquityTradeChart` for FPS price history
- `PriceDiscovery` for ZCHF price history
- `AnalyticDailyLog` for daily aggregates

### 8. Token Metadata

**Embedded in Schemas:**
- Position tables include collateral token metadata (name, symbol, decimals)
- No need for separate token registry queries
- Denormalized for query performance

### 9. Referral Tracking

**Complete Referral System:**
- `SavingsReferrerMapping`: Who referred whom
- `SavingsReferrerEarnings`: Total earnings per referrer per account
- Calculate referrer share: `earnings = account.interest * referrerFee / 1_000_000`

### 10. Performance Considerations

**Indexed Columns:**
- All primary key columns (automatic)
- Common filter columns: `chainId`, `owner`, `account`, `position`, `token`

**Large Tables:**
- `ERC20Balance`: Every transfer (use pagination)
- `SavingsActivity`: Every savings transaction (use pagination)
- `AnalyticTransactionLog`: Every tracked transaction (use daily log instead)

**Efficient Queries:**
- Use `AnalyticDailyLog` for historical charts (365 rows vs 100k+ rows)
- Use `{table}Mapping` for current state (1 row vs N history rows)
- Use `{table}Status` for per-module/per-token aggregates
- Position totals come from `PositionAggregatesV1/V2` tables (pre-computed, not calculated on-demand)

---

## API Application Migration Strategy

### Recommended Approach

1. **Direct GraphQL Queries:**
   - Use Ponder's GraphQL endpoint for all data needs
   - No need to replicate data to separate database
   - GraphQL schema is auto-generated and always in sync

2. **Caching Layer:**
   - Add Redis cache for frequently accessed data
   - Cache analytics endpoints (24h TTL)
   - Cache user balances (1min TTL)
   - Cache position lists (5min TTL)

3. **REST API Wrapper (Optional):**
   - Create thin REST layer over GraphQL if needed
   - Map REST endpoints to GraphQL queries
   - Example:
     ```
     GET /api/positions → MintingHubV2PositionV2s query
     GET /api/positions/:id → MintingHubV2PositionV2 query
     GET /api/analytics/daily → AnalyticDailyLogs query
     GET /api/savings/:account → SavingsMappings query
     ```

4. **WebSocket for Real-Time:**
   - Subscribe to Ponder's GraphQL subscriptions (if needed)
   - Or poll high-priority endpoints (1-5s interval)

5. **Computed Endpoints:**
   - For endpoints requiring complex calculations:
     - Fetch base data from GraphQL
     - Apply business logic in API layer
     - Cache result

### Data You Can Eliminate from Current API

If your current API duplicates any of these, they can be removed:

- Token balances (use `ERC20BalanceMapping`)
- Transfer history (use `ERC20Balance`)
- Position data (use `MintingHubV{n}PositionV{n}`)
- Position totals (use `PositionAggregatesV1/V2` - pre-computed)
- Savings balances (use `SavingsMapping`)
- Analytics/metrics (use `AnalyticDailyLog`)
- Price history (use `PriceDiscovery`, `EquityTradeChart`)
- Challenge data (use `ChallengeV{n}`, `ChallengeBidV{n}`)
- Interest rate data (use `AnalyticDailyLog.currentMintLeadRate` and `currentSaveLeadRate`)

### Data You May Still Need to Compute

- Real-time interest accrual (requires calculation)
- Cross-chain aggregates (sum across chainId)
- User-specific views (filter + aggregate)
- External data (price feeds, gas prices, etc.)

---

## Environment Variables

```bash
PORT=42069                        # Server port
ALCHEMY_RPC_KEY=xxx              # Required: Alchemy API key
DATABASE_URL=postgres://...      # Optional: Postgres URL (uses SQLite if omitted)
MAX_REQUESTS_PER_SECOND=10       # RPC rate limiting (default: 10)
INDEX_ERC20POSITION_V1=false     # Index V1 position collateral tokens (default: false)
INDEX_ERC20POSITION_V2=false     # Index V2 position collateral tokens (default: false)
```

**Note:** Position collateral token indexing is **disabled by default** because it tracks every ERC20 collateral token for every position, which can be hundreds of contracts. Enable only if needed for balance tracking.

---

## Start Blocks (Important for Performance)

Start blocks are **critical for indexing performance**. They prevent scanning from block 0 and enable fast sync.

**Mainnet Start Blocks:**
```
Frankencoin:        18451518
MintingHubV1:       18451536
MintingHubV2:       21280757
TransferReference:  22678761
SavingsReferral:    22536327
CCIP Bridge:        22623046
Uniswap V3 Pool:    19122801
```

**L2 Start Blocks:** See `ponder.config.ts` for each chain (Polygon, Arbitrum, etc.)

---

## Limitations & Considerations

1. **Analytics are Mainnet-Only:**
   - `updateTransactionLog()` only runs on mainnet
   - Multichain analytics require refactor

2. **Real-Time Interest Not Stored:**
   - Savings balances exclude accruing interest
   - Must calculate or query on-chain for exact balance

3. **Position Collateral Token Indexing:**
   - Disabled by default (hundreds of contracts)
   - Enable via env vars if needed

4. **No Historical Position States:**
   - Position tables store current state only
   - Use `MintingUpdateV{n}` for historical snapshots

5. **Cross-Chain Reads:**
   - `context.client` locked to event source chain
   - Create separate client for cross-chain reads

---

## Summary for API Overhaul

### What This Indexer Provides

✅ **Complete blockchain data:** Every event, transaction, balance since deployment
✅ **8 chains:** Mainnet + 7 L2s with consistent schema
✅ **Pre-computed analytics:** Daily rollups, cumulative metrics, interest rates
✅ **Time-series data:** Price history, balance history, activity logs
✅ **Referral tracking:** Complete referral system with earnings
✅ **Challenge system:** Full liquidation data with bid-by-bid tracking
✅ **Auto-generated GraphQL API:** Query any table with filters, sorting, pagination
✅ **Real-time sync:** 5-second polling interval, low latency

### What You Should Build on Top

🔨 **REST API wrapper:** Map common queries to REST endpoints
🔨 **Caching layer:** Redis for frequently accessed data
🔨 **Real-time calculations:** Interest accrual, cross-chain aggregates
🔨 **User-specific views:** Portfolio, activity feed, notifications
🔨 **External data integration:** Price feeds, gas prices, exchange rates
🔨 **Authentication:** User accounts, API keys, rate limiting
🔨 **WebSocket feeds:** Real-time updates for positions, challenges, prices

### Recommended Tech Stack for API

- **Framework:** Node.js + Express/Fastify/Hono
- **GraphQL Client:** `@ponder/client` or `graphql-request`
- **Cache:** Redis (with TTL strategies)
- **Database:** Not needed (query Ponder directly)
- **WebSocket:** Socket.io or native WebSocket
- **Authentication:** JWT + API keys

### Key Design Principles

1. **Don't Replicate Data:** Query Ponder directly, don't copy to your DB
2. **Cache Strategically:** Cache slow queries and analytics, not real-time data
3. **Embrace GraphQL:** Let Ponder handle filtering, sorting, pagination
4. **Compute at API Layer:** Only for data that requires cross-query calculations
5. **Leverage Pre-Computed Tables:** Use `AnalyticDailyLog`, not raw events

---

**Generated:** 2026-02-13
**Ponder Version:** 0.11.2
**Indexer Package:** `@frankencoin/ponder` v0.3.2

## Recent Updates (2026-02-13)

### Position Aggregates Performance Optimization
- Added `PositionAggregatesV1` and `PositionAggregatesV2` tables for caching position totals
- Eliminated N+1 query pattern in TransactionLog (100-1000x performance improvement)
- Aggregates updated incrementally on position changes, not on every transaction

### Dual Lead Rate System
- Separated mint lead rate (SavingsV2) from save lead rate (SavingsReferral)
- Mint rate used for V2 position interest calculations
- Save rate used for savings projections (with mint rate fallback)
- Both rates stored in analytics tables for historical tracking

### Schema Improvements
- Fixed address fields in Savings schema (`t.text()` → `t.hex()`)
- Updated TransactionLog schema with dual rate fields
- Added dev:ui script for development with Ponder UI
