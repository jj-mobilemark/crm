/**
 * One-shot Sage CRM full backfill, run from this machine (plan §6, Part D).
 *
 * Walks every non-deleted company (+ nested people) then every non-deleted
 * opportunity into the local DB, inside the one global Sage session. Idempotent
 * — safe to re-run; a crash just costs the time to re-walk.
 *
 *   bun run scripts/sage-backfill.ts --dry-run --max=200   # canary, no writes
 *   bun run scripts/sage-backfill.ts --max=200             # small real slice
 *   bun run scripts/sage-backfill.ts                       # full run (off-peak)
 *   bun run scripts/sage-backfill.ts --incremental --dry-run  # preview a nightly pull
 *   bun run scripts/sage-backfill.ts --incremental            # run a nightly pull
 *
 * Run it off-peak. It holds one Sage session and pages slowly on purpose so the
 * sales team never sees Sage slow down.
 */
import "@crm/env/load";
import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { validateEnv } from "../src/config/env.validation";
import { DatabaseModule } from "../src/database/database.module";
import { SagePullService } from "../src/sage/sage-pull.service";
import { SageModule } from "../src/sage/sage.module";

@Module({
	imports: [
		ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
		DatabaseModule,
		SageModule,
	],
})
class BackfillModule {}

function parseArgs(argv: string[]): {
	dryRun: boolean;
	incremental: boolean;
	maxCompanies?: number;
} {
	const dryRun = argv.includes("--dry-run");
	const incremental = argv.includes("--incremental");
	const maxArg = argv.find((a) => a.startsWith("--max="));
	const max = maxArg ? Number.parseInt(maxArg.slice("--max=".length), 10) : NaN;
	return {
		dryRun,
		incremental,
		maxCompanies: Number.isFinite(max) && max > 0 ? max : undefined,
	};
}

async function main(): Promise<void> {
	const logger = new Logger("SageBackfillScript");
	const { dryRun, incremental, maxCompanies } = parseArgs(
		process.argv.slice(2),
	);

	const app = await NestFactory.createApplicationContext(BackfillModule, {
		logger: ["log", "warn", "error"],
	});
	app.enableShutdownHooks();

	const pull = app.get(SagePullService);

	const mode = incremental ? "incremental" : "backfill";
	logger.log({
		message: "Sage sync starting",
		mode,
		dryRun,
		maxCompanies,
	});
	const startedAt = Date.now();

	const summary = incremental
		? await pull.runIncremental({ dryRun })
		: await pull.runBackfill({ dryRun, maxCompanies });

	const durationMs = Date.now() - startedAt;
	logger.log({ message: "Sage sync done", mode, durationMs, ...summary });

	await app.close();
	process.exit(summary.outcome === "ok" ? 0 : 1);
}

void main().catch((error: unknown) => {
	new Logger("SageBackfillScript").fatal(
		{ message: "Sage backfill script crashed" },
		error instanceof Error ? error.stack : String(error),
	);
	process.exit(1);
});
