import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { TripPlansRouter } from "./trip-plans.router";
import { TripPlansService } from "./trip-plans.service";

@Module({
	imports: [TrpcModule],
	providers: [TripPlansService, TripPlansRouter],
	exports: [TripPlansService],
})
export class TripPlansModule {}
