import { LeadrateABI } from '@frankencoin/zchf';
import { type Context } from 'ponder:registry';
import { SavingsStatus } from 'ponder:schema';
import { Address } from 'viem';

interface GetSavingsRatePPMProps {
	client: Context['client'];
	db: Context['db'];
	chainId: number;
	module: Address;
}

export async function getSavingsRatePPM({ client, db, chainId, module }: GetSavingsRatePPMProps): Promise<number> {
	const status = await db.find(SavingsStatus, { chainId, module });
	if (status) return status.rate;

	return client.readContract({
		abi: LeadrateABI,
		address: module,
		functionName: 'currentRatePPM',
	});
}
