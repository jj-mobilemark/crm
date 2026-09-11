import { describe, expect, test } from "bun:test";
import {
	isSagePaginationFault,
	isSageSessionLost,
	isSageTransientFailure,
	isSageWalkRestartable,
} from "../src/sage/sage.constants";

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

describe("isSageTransientFailure", () => {
	test("matches the overnight connect failure", () => {
		expect(
			isSageTransientFailure(
				"Unable to connect. Is the computer able to access the url?",
			),
		).toBe(true);
	});

	test("matches our SOAP timeout string", () => {
		expect(
			isSageTransientFailure("Sage SOAP timed out after 90000ms."),
		).toBe(true);
	});

	test("ignores SOAP business faults", () => {
		expect(
			isSageTransientFailure("Query failed to run successfully"),
		).toBe(false);
		expect(isSageTransientFailure("You are not logged on.")).toBe(false);
	});
});

describe("isSagePaginationFault", () => {
	test("matches the production next-fault strings", () => {
		expect(isSagePaginationFault("List index out of bounds (75)")).toBe(
			true,
		);
		expect(
			isSagePaginationFault("Query failed to run successfully."),
		).toBe(true);
	});

	test("ignores session and transport faults", () => {
		expect(isSagePaginationFault("You are not logged on.")).toBe(false);
		expect(isSagePaginationFault("Unable to connect.")).toBe(false);
		expect(isSagePaginationFault(undefined)).toBe(false);
	});
});

describe("isSageWalkRestartable", () => {
	test("covers session loss, transport blips, and pagination faults", () => {
		expect(isSageWalkRestartable("You are not logged on.")).toBe(true);
		expect(
			isSageWalkRestartable(
				"Unable to connect. Is the computer able to access the url?",
			),
		).toBe(true);
		expect(
			isSageWalkRestartable("List index out of bounds (75)"),
		).toBe(true);
		expect(isSageWalkRestartable("Query failed to run successfully")).toBe(
			true,
		);
		expect(isSageWalkRestartable("Entity 'case' does not exist")).toBe(
			false,
		);
	});
});
