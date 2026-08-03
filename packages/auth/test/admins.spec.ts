import { afterEach, describe, expect, it } from "bun:test";
import {
	canEditOwnedRecord,
	canReassignOwner,
	isCrmAdmin,
} from "../src/admins";

const ORIGINAL = process.env.CRM_ADMIN_EMAILS;

afterEach(() => {
	if (ORIGINAL === undefined) {
		delete process.env.CRM_ADMIN_EMAILS;
	} else {
		process.env.CRM_ADMIN_EMAILS = ORIGINAL;
	}
	// Force re-parse on next call (module caches by source string).
});

describe("isCrmAdmin", () => {
	it("matches listed emails case-insensitively", () => {
		process.env.CRM_ADMIN_EMAILS = "jjohnson@mobilemark.com,Other@Example.com";
		expect(isCrmAdmin("jjohnson@mobilemark.com")).toBe(true);
		expect(isCrmAdmin("JJOHNSON@mobilemark.com")).toBe(true);
		expect(isCrmAdmin("other@example.com")).toBe(true);
		expect(isCrmAdmin("ken@mobilemark.com")).toBe(false);
	});

	it("ignores domains (addresses only)", () => {
		process.env.CRM_ADMIN_EMAILS = "mobilemark.com";
		expect(isCrmAdmin("jjohnson@mobilemark.com")).toBe(false);
	});
});

describe("canEditOwnedRecord", () => {
	it("allows the owner", () => {
		process.env.CRM_ADMIN_EMAILS = "";
		expect(
			canEditOwnedRecord({
				actingUserId: "u1",
				actingEmail: "rep@mobilemark.com",
				ownerId: "u1",
			}),
		).toBe(true);
	});

	it("allows an admin who is not the owner", () => {
		process.env.CRM_ADMIN_EMAILS = "admin@mobilemark.com";
		expect(
			canEditOwnedRecord({
				actingUserId: "admin",
				actingEmail: "admin@mobilemark.com",
				ownerId: "u1",
			}),
		).toBe(true);
	});

	it("blocks a non-owner non-admin", () => {
		process.env.CRM_ADMIN_EMAILS = "admin@mobilemark.com";
		expect(
			canEditOwnedRecord({
				actingUserId: "u2",
				actingEmail: "other@mobilemark.com",
				ownerId: "u1",
			}),
		).toBe(false);
	});
});

describe("canReassignOwner", () => {
	it("is admin-only", () => {
		process.env.CRM_ADMIN_EMAILS = "admin@mobilemark.com";
		expect(canReassignOwner("admin@mobilemark.com")).toBe(true);
		expect(canReassignOwner("rep@mobilemark.com")).toBe(false);
	});
});
