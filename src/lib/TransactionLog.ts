import { and, eq, gte, inArray } from 'ponder';
import { type Context } from 'ponder:registry';
import {
	AnalyticTransactionLog,
	AnalyticDailyLog,
	CommonEcosystem,
	PositionAggregatesV1,
	PositionAggregatesV2,
	SavingsStatus,
} from 'ponder:schema';
import { EquityABI, FrankencoinABI, SavingsABI, SavingsV2ABI } from '@frankencoin/zchf';
import { parseEther } from 'viem';
import { addr, config } from '../../ponder.config';
import { mainnet } from 'viem/chains';
import { normalizeAddress } from '../utils/format';

// Time constants for efficient date calculations using BigInt arithmetic
const ONE_DAY_SECONDS = 86400n;
const ONE_YEAR_SECONDS = 365n * ONE_DAY_SECONDS;

interface updateTransactionLogProps {
	client: Context['client'];
	db: Context['db'];
	chainId: number;
	blockNumber: bigint;
	timestamp: bigint;
	kind: string;
	amount: bigint;
	txHash: string;
}

/**
 * @dev: update transaction log for mainnet only
 * this function need a rebuild to reflect multichain data.
 */
export async function updateTransactionLog({ client, db, chainId, blockNumber, timestamp, kind, amount, txHash }: updateTransactionLogProps) {
	if (chainId != mainnet.id) return;

	const mainnetAddress = addr[mainnet.id];

	// Batch query for ecosystem data (single query instead of 8 sequential queries)
	const ecosystemIds = [
		'Equity:Profits',
		'Equity:Losses',
		'Equity:InvestedFeePaidPPM',
		'Equity:RedeemedFeePaidPPM',
		'Equity:EarningsPerFPS',
		'Savings:TotalSaved',
		'Savings:TotalInterestCollected',
		'Savings:TotalWithdrawn',
	];

	const ecosystemRecords = await db.sql.select().from(CommonEcosystem).where(inArray(CommonEcosystem.id, ecosystemIds));

	// Create lookup map for O(1) access
	const ecosystemData = new Map(ecosystemRecords.map((r) => [r.id, r.amount]));

	// Extract values with defaults
	const totalInflow = ecosystemData.get('Equity:Profits') ?? 0n;
	const totalOutflow = ecosystemData.get('Equity:Losses') ?? 0n;
	const investedFeePaid = (ecosystemData.get('Equity:InvestedFeePaidPPM') ?? 0n) / 1_000_000n;
	const redeemedFeePaid = (ecosystemData.get('Equity:RedeemedFeePaidPPM') ?? 0n) / 1_000_000n;
	const totalTradeFee = investedFeePaid + redeemedFeePaid;
	const earningsPerFPS = ecosystemData.get('Equity:EarningsPerFPS') ?? 0n;
	const totalSaved = ecosystemData.get('Savings:TotalSaved') ?? 0n;
	const totalInterestCollected = ecosystemData.get('Savings:TotalInterestCollected') ?? 0n;
	const totalWithdrawn = ecosystemData.get('Savings:TotalWithdrawn') ?? 0n;
	const totalSavings = totalSaved + totalInterestCollected - totalWithdrawn;

	const mintHubV2Started = blockNumber >= BigInt(config[mainnet.id].startMintingHubV2);
	const savingsReferalStarted = blockNumber >= BigInt(config[mainnet.id].startSavingsReferal);

	const mintModule = normalizeAddress(mainnetAddress.savingsV2);
	const saveModule = normalizeAddress(mainnetAddress.savingsReferral);

	// Fetch live values whose same-transaction ordering matters, and use indexed DB state for stable rates.
	const [
		totalSupply,
		totalEquity,
		fpsTotalSupply,
		fpsPrice,
		savingsStatuses,
		v1Agg,
		v2Agg,
	] = await Promise.all([
		client.readContract({ abi: FrankencoinABI, address: mainnetAddress.frankencoin, functionName: 'totalSupply' }),
		client.readContract({ abi: FrankencoinABI, address: mainnetAddress.frankencoin, functionName: 'equity' }),
		client.readContract({ abi: EquityABI, address: mainnetAddress.equity, functionName: 'totalSupply' }),
		client.readContract({ abi: EquityABI, address: mainnetAddress.equity, functionName: 'price' }),
		db.sql
			.select()
			.from(SavingsStatus)
			.where(and(eq(SavingsStatus.chainId, chainId), inArray(SavingsStatus.module, [mintModule, saveModule]))),
		// Read V1 aggregates (O(1) instead of O(n))
		db.find(PositionAggregatesV1, { chainId }),
		// Read V2 aggregates (O(1) instead of O(n))
		db.find(PositionAggregatesV2, { chainId }),
	]);

	const savingsStatusByModule = new Map(savingsStatuses.map((status) => [normalizeAddress(status.module), status]));

	// Fetch both mint lead rate (for V2 positions) and save lead rate (for savings) from indexed RateChanged state.
	const indexedMintLeadRate = savingsStatusByModule.get(mintModule)?.rate;
	const indexedSaveLeadRate = savingsStatusByModule.get(saveModule)?.rate;
	const [mintRateFallback, saveRateFallback] = await Promise.all([
		mintHubV2Started && indexedMintLeadRate === undefined
			? client.readContract({ abi: SavingsV2ABI, address: mainnetAddress.savingsV2, functionName: 'currentRatePPM' })
			: Promise.resolve(0n),
		savingsReferalStarted && indexedSaveLeadRate === undefined
			? client.readContract({ abi: SavingsABI, address: mainnetAddress.savingsReferral, functionName: 'currentRatePPM' })
			: Promise.resolve(0n),
	]);

	const currentMintLeadRate: bigint = mintHubV2Started
		? BigInt(indexedMintLeadRate ?? mintRateFallback)
		: 0n;
	// Fallback: if SavingsReferral not yet deployed, use mint rate
	const currentSaveLeadRate: bigint = savingsReferalStarted
		? BigInt(indexedSaveLeadRate ?? saveRateFallback)
		: currentMintLeadRate;

	const totalMintedV1 = v1Agg?.totalMinted ?? 0n;
	const annualV1Interests = v1Agg?.annualInterests ?? 0n;
	const totalMintedV2 = v2Agg?.totalMinted ?? 0n;
	const annualV2Interests = v2Agg?.annualInterests ?? 0n;

	// Calculate projected interests using save rate
	let projectedInterests: bigint = 0n;
	if (totalSavings > 0n && currentSaveLeadRate > 0) {
		projectedInterests = (totalSavings * currentSaveLeadRate) / 1_000_000n;
	}

	// avg borrow interest
	const annualV1BorrowRate = totalMintedV1 > 0n ? (annualV1Interests * parseEther('1')) / totalMintedV1 : 0n;
	const annualV2BorrowRate = totalMintedV2 > 0n ? (annualV2Interests * parseEther('1')) / totalMintedV2 : 0n;

	// net calc
	const annualNetEarnings = annualV1Interests + annualV2Interests - projectedInterests;

	// calc realized earnings, rolling latest 365days
	// Use BigInt arithmetic to avoid unnecessary conversions
	const dayTimestamp = timestamp - (timestamp % ONE_DAY_SECONDS);
	const last365dayTimestamp = dayTimestamp - ONE_YEAR_SECONDS;

	const last356dayEntry = await db.sql
		.select()
		.from(AnalyticDailyLog)
		.where(gte(AnalyticDailyLog.timestamp, last365dayTimestamp))
		.orderBy(AnalyticDailyLog.timestamp)
		.limit(1);

	let realizedNetEarnings = totalInflow - totalOutflow;
	if (last356dayEntry.length > 0) {
		const item = last356dayEntry.at(0);
		const inflowAdjusted = totalInflow - item!.totalInflow;
		const outflowAdjusted = totalOutflow - item!.totalOutflow;
		realizedNetEarnings = inflowAdjusted - outflowAdjusted;
	}

	const counter = await db
		.insert(CommonEcosystem)
		.values({
			id: 'Analytics:TransactionLogCounter',
			value: '',
			amount: 1n,
		})
		.onConflictDoUpdate((current) => ({
			amount: current.amount + 1n,
		}));

	await db.insert(AnalyticTransactionLog).values({
		chainId,
		timestamp,
		count: counter.amount,
		kind,
		amount,
		txHash: txHash as `0x${string}`,

		totalInflow,
		totalOutflow,
		totalTradeFee,

		totalSupply,
		totalEquity,
		totalSavings,

		fpsTotalSupply,
		fpsPrice,

		totalMintedV1,
		totalMintedV2,

		currentMintLeadRate,
		currentSaveLeadRate,
		projectedInterests,
		annualV1Interests,
		annualV2Interests,

		annualV1BorrowRate,
		annualV2BorrowRate,

		annualNetEarnings,
		realizedNetEarnings,
		earningsPerFPS,
	});

	// Use BigInt arithmetic to get day boundary (more efficient than Date manipulations)
	const timestampDay = timestamp - (timestamp % ONE_DAY_SECONDS);
	// Only convert to Date for string formatting
	const dateString = new Date(Number(timestampDay) * 1000).toISOString().split('T')[0]!;

	const dailyLogData = {
		date: dateString,
		timestamp: timestampDay,
		txHash: txHash as `0x${string}`,

		totalInflow,
		totalOutflow,
		totalTradeFee,

		totalSupply,
		totalEquity,
		totalSavings,

		fpsTotalSupply,
		fpsPrice,

		totalMintedV1,
		totalMintedV2,

		currentMintLeadRate,
		currentSaveLeadRate,
		projectedInterests,
		annualV1Interests,
		annualV2Interests,

		annualV1BorrowRate,
		annualV2BorrowRate,

		annualNetEarnings,
		realizedNetEarnings,
		earningsPerFPS,
	};

	await db
		.insert(AnalyticDailyLog)
		.values(dailyLogData)
		.onConflictDoUpdate(() => dailyLogData);
}
