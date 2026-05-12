import { ponder } from 'ponder:registry';
import { CommonEcosystem, SavingsActivity, SavingsMapping, SavingsStatus } from 'ponder:schema';
import { Address } from 'viem';
import { updateTransactionLog } from './lib/TransactionLog';
import { getSavingsRatePPM } from './lib/SavingsRate';
import { normalizeAddress } from './utils/format';

/*
Events

SavingsV2:Saved
SavingsV2:InterestCollected
SavingsV2:Withdrawn
*/

ponder.on('SavingsV2:Saved', async ({ event, context }) => {
	const { client } = context;
	const { amount } = event.args;

	const updated = event.block.timestamp;
	const chainId = context.chain.id;
	const module = normalizeAddress(event.log.address);
	const account: Address = normalizeAddress(event.args.account);

	const ratePPM = await getSavingsRatePPM({ client, db: context.db, chainId, module });

	// update total saved
	await context.db
	.insert(CommonEcosystem)
	.values({
		id: 'Savings:TotalSaved',
		value: '',
		amount: amount,
	})
	.onConflictDoUpdate((current) => ({
		amount: current.amount + amount,
	}));

	// update global status
	const status = await context.db
		.insert(SavingsStatus)
		.values({
			chainId,
			module,
			updated,
			save: amount,
			withdraw: 0n,
			interest: 0n,
			balance: amount,
			rate: ratePPM,
			counterSave: 1n,
			counterWithdraw: 0n,
			counterInterest: 0n,
			counterRateProposed: 0n,
			counterRateChanged: 0n,
		})
		.onConflictDoUpdate((current) => ({
			updated,
			rate: ratePPM,
			save: current.save + amount,
			balance: current.balance + amount,
			counterSave: current.counterSave + 1n,
		}));

	// update mapping
	const mapping = await context.db
		.insert(SavingsMapping)
		.values({
			chainId,
			module,
			account,
			created: updated,
			updated,
			save: amount,
			withdraw: 0n,
			interest: 0n,
			balance: amount,
			counterSave: 1n,
			counterWithdraw: 0n,
			counterInterest: 0n,
		})
		.onConflictDoUpdate((current) => ({
			updated,
			save: current.save + amount,
			balance: current.balance + amount,
			counterSave: current.counterSave + 1n, // count
		}));

	const counter = mapping.counterSave + mapping.counterInterest + mapping.counterWithdraw;

	// flat indexing
	await context.db.insert(SavingsActivity).values({
		chainId,
		module,
		account,
		created: updated,
		blockheight: event.block.number,
		count: counter,
		txHash: event.transaction.hash,
		kind: 'Saved',
		amount,
		rate: ratePPM,
		save: mapping.save,
		withdraw: mapping.withdraw,
		interest: mapping.interest,
		balance: mapping.balance,
	});

	await updateTransactionLog({
		client: context.client,
		db: context.db,
		chainId,
		blockNumber: event.block.number,
		timestamp: event.block.timestamp,
		kind: 'Savings:Saved',
		amount: event.args.amount,
		txHash: event.transaction.hash,
	});
});

ponder.on('SavingsV2:InterestCollected', async ({ event, context }) => {
	const { client } = context;
	const { interest } = event.args;

	const updated = event.block.timestamp;
	const chainId = context.chain.id;
	const module = normalizeAddress(event.log.address);
	const account: Address = normalizeAddress(event.args.account);

	const ratePPM = await getSavingsRatePPM({ client, db: context.db, chainId, module });

	// update total interest collected
	await context.db
	.insert(CommonEcosystem)
	.values({
		id: 'Savings:TotalInterestCollected',
		value: '',
		amount: interest,
	})
	.onConflictDoUpdate((current) => ({
		amount: current.amount + interest,
	}));

	// update global status
	const status = await context.db.update(SavingsStatus, { chainId, module }).set((current) => ({
		updated,
		rate: ratePPM,
		interest: current.interest + interest,
		balance: current.balance + interest,
		counterInterest: current.counterInterest + 1n,
	}));

	// update mapping
	const mapping = await context.db.update(SavingsMapping, { chainId, module, account }).set((current) => ({
		updated,
		interest: current.interest + interest,
		balance: current.balance + interest,
		counterInterest: current.counterInterest + 1n, // count
	}));

	const counter = mapping.counterSave + mapping.counterInterest + mapping.counterWithdraw;

	// flat indexing
	await context.db.insert(SavingsActivity).values({
		chainId,
		module,
		account,
		created: updated,
		blockheight: event.block.number,
		count: counter,
		txHash: event.transaction.hash,
		kind: 'InterestCollected',
		amount: interest,
		rate: ratePPM,
		save: mapping.save,
		withdraw: mapping.withdraw,
		interest: mapping.interest,
		balance: mapping.balance,
	});

	await updateTransactionLog({
		client: context.client,
		db: context.db,
		chainId,
		blockNumber: event.block.number,
		timestamp: event.block.timestamp,
		kind: 'Savings:InterestCollected',
		amount: event.args.interest,
		txHash: event.transaction.hash,
	});
});

ponder.on('SavingsV2:Withdrawn', async ({ event, context }) => {
	const { client } = context;
	const { amount } = event.args;

	const updated = event.block.timestamp;
	const chainId = context.chain.id;
	const module = normalizeAddress(event.log.address);
	const account: Address = normalizeAddress(event.args.account);

	const ratePPM = await getSavingsRatePPM({ client, db: context.db, chainId, module });

	// update total withdrawn
	await context.db
	.insert(CommonEcosystem)
	.values({
		id: 'Savings:TotalWithdrawn',
		value: '',
		amount: amount,
	})
	.onConflictDoUpdate((current) => ({
		amount: current.amount + amount,
	}));

	// update global status
	const status = await context.db.update(SavingsStatus, { chainId, module }).set((current) => ({
		updated,
		rate: ratePPM,
		withdraw: current.withdraw + amount, // double entry
		balance: current.balance - amount, // deduct from balance
		counterWithdraw: current.counterWithdraw + 1n,
	}));

	// update mapping
	const mapping = await context.db.update(SavingsMapping, { chainId, module, account }).set((current) => ({
		updated,
		withdraw: current.withdraw + amount,
		balance: current.balance - amount,
		counterWithdraw: current.counterWithdraw + 1n, // count
	}));

	const counter = mapping.counterSave + mapping.counterInterest + mapping.counterWithdraw;

	// flat indexing
	await context.db.insert(SavingsActivity).values({
		chainId,
		module,
		account,
		created: updated,
		blockheight: event.block.number,
		count: counter,
		txHash: event.transaction.hash,
		kind: 'Withdrawn',
		amount: amount,
		rate: ratePPM,
		save: mapping.save,
		withdraw: mapping.withdraw,
		interest: mapping.interest,
		balance: mapping.balance,
	});

	await updateTransactionLog({
		client: context.client,
		db: context.db,
		chainId,
		blockNumber: event.block.number,
		timestamp: event.block.timestamp,
		kind: 'Savings:Withdrawn',
		amount: event.args.amount,
		txHash: event.transaction.hash,
	});
});
