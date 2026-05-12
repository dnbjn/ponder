import { ERC20ABI } from '@frankencoin/zchf';
import { type Context } from 'ponder:registry';
import { ERC20Metadata } from 'ponder:schema';
import { Address } from 'viem';
import { normalizeAddress } from '../utils/format';

interface GetERC20MetadataProps {
	client: Context['client'];
	db: Context['db'];
	chainId: number;
	token: Address;
	timestamp: bigint;
}

export async function getERC20Metadata({ client, db, chainId, token, timestamp }: GetERC20MetadataProps) {
	const normalizedToken = normalizeAddress(token);
	const cached = await db.find(ERC20Metadata, { chainId, token: normalizedToken });
	if (cached) {
		return {
			name: cached.name,
			symbol: cached.symbol,
			decimals: cached.decimals,
		};
	}

	const [name, symbol, decimals] = await Promise.all([
		client.readContract({ abi: ERC20ABI, address: token, functionName: 'name' }),
		client.readContract({ abi: ERC20ABI, address: token, functionName: 'symbol' }),
		client.readContract({ abi: ERC20ABI, address: token, functionName: 'decimals' }),
	]);

	await db
		.insert(ERC20Metadata)
		.values({
			chainId,
			token: normalizedToken,
			updated: timestamp,
			name,
			symbol,
			decimals,
		})
		.onConflictDoNothing();

	return { name, symbol, decimals };
}
