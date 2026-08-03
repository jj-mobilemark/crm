import { Injectable } from "@nestjs/common";
import { GraphApiClient, type GraphResult } from "./graph-api.client";

const BASE = "https://graph.microsoft.com/v1.0";

export type SendMailInput = {
	to: string;
	subject: string;
	/** HTML body. */
	htmlBody: string;
	/**
	 * Optional custom internet-message headers (e.g. List-Unsubscribe,
	 * X-CRM-Sequence-Token). Graph accepts a small set; unknown ones may be
	 * dropped silently.
	 */
	headers?: Array<{ name: string; value: string }>;
	/**
	 * When set, Graph threads this as a reply in the same conversation.
	 * Requires the previous message's `internetMessageId`.
	 */
	inReplyTo?: string;
};

/**
 * Outbound mail via Microsoft Graph (`POST /me/sendMail`).
 *
 * Mechanical only — the sequences tick decides *what* and *when*; this
 * client just posts the payload with the rep's delegated token.
 */
@Injectable()
export class OutlookSendClient {
	constructor(private readonly api: GraphApiClient) {}

	async sendMail(
		accessToken: string,
		input: SendMailInput,
	): Promise<GraphResult<void>> {
		const internetMessageHeaders = [
			...(input.headers ?? []),
			...(input.inReplyTo
				? [
						{ name: "In-Reply-To", value: input.inReplyTo },
						{ name: "References", value: input.inReplyTo },
					]
				: []),
		];

		return this.api.post<void>(`${BASE}/me/sendMail`, accessToken, {
			message: {
				subject: input.subject,
				body: {
					contentType: "HTML",
					content: input.htmlBody,
				},
				toRecipients: [
					{
						emailAddress: { address: input.to },
					},
				],
				...(internetMessageHeaders.length > 0
					? { internetMessageHeaders }
					: {}),
			},
			saveToSentItems: true,
		});
	}
}
