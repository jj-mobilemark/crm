import { describe, expect, it } from "bun:test";
import { resolveTripOwnership } from "../src/trip-plan";

describe("resolveTripOwnership", () => {
	it("marks the planner's own accounts as mine", () => {
		expect(resolveTripOwnership("user_sarah", "user_sarah")).toBe("mine");
	});

	it("marks null owner as unassigned", () => {
		expect(resolveTripOwnership(null, "user_sarah")).toBe("unassigned");
		expect(resolveTripOwnership(undefined, "user_sarah")).toBe("unassigned");
	});

	it("marks another rep's account as other", () => {
		expect(resolveTripOwnership("user_ken", "user_sarah")).toBe("other");
	});
});
