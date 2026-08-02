import { Injectable } from "@nestjs/common";
import { GraphApiClient, type GraphResult } from "./graph-api.client";

const BASE = "https://graph.microsoft.com/v1.0";

/** One Graph internet-message header, as returned in `internetMessageHeaders`. */
export type GraphHeader = { name?: string; value?: string };

/** A Graph email address, e.g. `{ name: "Jane", address: "jane@acme.com" }`. */
export type GraphEmailAddress = { name?: string; address?: string };

export type GraphRecipient = { emailAddress?: GraphEmailAddress };

/** The slice of a Graph `message` resource we ask for and read. */
export type GraphMessage = {
	id?: string;
	internetMessageId?: string;
	subject?: string;
	from?: GraphRecipient;
	sender?: GraphRecipient;
	toRecipients?: GraphRecipient[];
	ccRecipients?: GraphRecipient[];
	receivedDateTime?: string;
	sentDateTime?: string;
	bodyPreview?: string;
	body?: { contentType?: string; content?: string };
	conversationId?: string;
	internetMessageHeaders?: GraphHeader[];
	/** Present on a delta page when the message was deleted/moved out. */
	"@removed"?: { reason?: string };
};

/** A page of a mail delta query. */
export type MailDeltaPage = {
	value?: GraphMessage[];
	"@odata.nextLink"?: string;
	"@odata.deltaLink"?: string;
};

export type MailboxProfile = {
	mail?: string;
	userPrincipalName?: string;
};

/**
 * The fields we pull for each message. Narrowing here rather than after
 * fetching is the difference between reading a mailbox and reading the part of
 * it we store — and each field left out is bytes off every delta page.
 */
const MESSAGE_SELECT = [
	"id",
	"internetMessageId",
	"subject",
	"from",
	"toRecipients",
	"ccRecipients",
	"receivedDateTime",
	"bodyPreview",
	"body",
	"conversationId",
	"internetMessageHeaders",
].join(",");

@Injectable()
export class OutlookMailClient {
	constructor(private readonly api: GraphApiClient) {}

	/** The mailbox's own address, so a message can be classed in/outbound. */
	async profile(accessToken: string): Promise<GraphResult<MailboxProfile>> {
		return this.api.get<MailboxProfile>(`${BASE}/me`, accessToken, {
			$select: "mail,userPrincipalName",
		});
	}

	/**
	 * One page of the inbox delta.
	 *
	 * With a `cursor` (a full `@odata.nextLink` or `@odata.deltaLink`) it GETs
	 * that URL as-is — Graph bakes the token and every parameter into the link.
	 * Without one it opens a fresh delta on the inbox.
	 */
	async delta(
		accessToken: string,
		options: { cursor?: string } = {},
	): Promise<GraphResult<MailDeltaPage>> {
		if (options.cursor) {
			return this.api.get<MailDeltaPage>(options.cursor, accessToken);
		}

		return this.api.get<MailDeltaPage>(
			`${BASE}/me/mailFolders/inbox/messages/delta`,
			accessToken,
			{ $select: MESSAGE_SELECT, $top: 50 },
		);
	}

	/**
	 * Messages that involve one address — used for contact-add backfill.
	 *
	 * Graph KQL `$search` needs `ConsistencyLevel: eventual`. Quotes around the
	 * search string are required. Pass a full `@odata.nextLink` as `cursor` to
	 * continue a page chain.
	 */
	async searchByParticipant(
		accessToken: string,
		address: string,
		options: { top?: number; cursor?: string } = {},
	): Promise<GraphResult<MailDeltaPage>> {
		if (options.cursor) {
			return this.api.get<MailDeltaPage>(
				options.cursor,
				accessToken,
				{},
				{
					ConsistencyLevel: "eventual",
				},
			);
		}

		const trimmed = address.trim().toLowerCase();
		return this.api.get<MailDeltaPage>(
			`${BASE}/me/messages`,
			accessToken,
			{
				$search: `"participants:${trimmed}"`,
				$select: MESSAGE_SELECT,
				$top: options.top ?? 50,
			},
			{
				ConsistencyLevel: "eventual",
			},
		);
	}
}
