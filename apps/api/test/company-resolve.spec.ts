import { describe, expect, test } from "bun:test";
import { db } from "@crm/db";
import { CompanyResolveService } from "../src/sage/company-resolve.service";

/**
 * Hits the local DB (Sage-pulled MCL ENTERPRISES fixture). Skip when the
 * company is not present — CI without a seeded Sage pull should not fail.
 */
describe("CompanyResolveService", () => {
	const service = new CompanyResolveService(db);

	test("auto-accepts MCL from letterhead + ZIP + email domain", async () => {
		const known = await db.company.findFirst({
			where: { sage100CustomerNo: "0007242" },
			select: { id: true },
		});
		if (!known) return;

		const result = await service.resolve(
			{
				buyer_name: "MCL",
				buyer_zip: "45030",
				email: "malouis@mcl-enterprises.net",
				email_domain: "mcl-enterprises.net",
				ship_to_name: "Urban Transportation Associates",
				ship_to_zip: "45226",
			},
			{ require_mas_customer_no: true, allow_ship_to_as_account: false },
		);

		expect(result.matched).toBe(true);
		expect(result.ambiguous).toBe(false);
		expect(result.mas_customer_no).toBe("0007242");
		expect(result.name).toBe("MCL ENTERPRISES");
		expect(result.has_mas_id).toBe(true);
		expect(
			result.rejected_signals.some((r) => r.signal === "ship_to_name"),
		).toBe(true);
		expect(result.fields_used.length).toBeGreaterThan(0);
	});

	test("pads a short MAS hint to the stored 7-digit number", async () => {
		const known = await db.company.findFirst({
			where: { sage100CustomerNo: "0007242" },
			select: { id: true },
		});
		if (!known) return;

		const result = await service.resolve({ mas_customer_no: "7242" });
		expect(result.matched).toBe(true);
		expect(result.mas_customer_no).toBe("0007242");
		expect(result.match_method).toContain("mas_customer_no");
	});

	test("rejects Mobile Mark as a buyer name", async () => {
		const result = await service.resolve({
			buyer_name: "Mobile Mark, Inc.",
			buyer_zip: "60143",
		});
		expect(result.matched).toBe(false);
		expect(
			result.rejected_signals.some((r) => r.reason === "vendor_name_rejected"),
		).toBe(true);
	});
});
