import { describe, expect, test } from "bun:test";
import { isSageSessionLost } from "../src/sage/sage.constants";

describe("isSageSessionLost", () => {
	test("matches the production fault string", () => {
		expect(isSageSessionLost("You are not logged on.")).toBe(true);
	});

	test("matches common session expiry wording", () => {
		expect(isSageSessionLost("Session has expired")).toBe(true);
		expect(isSageSessionLost("Invalid session")).toBe(true);
	});

	test("ignores unrelated faults", () => {
		expect(isSageSessionLost("Query failed to run successfully")).toBe(
			false,
		);
		expect(isSageSessionLost(undefined)).toBe(false);
		expect(isSageSessionLost("")).toBe(false);
	});
});
