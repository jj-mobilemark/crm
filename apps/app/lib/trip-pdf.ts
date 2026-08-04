import { jsPDF } from "jspdf";

export type TripPdfStop = {
	companyId: string;
	companyName: string;
	city: string | null;
	stateCode: string | null;
	streetAddress: string | null;
	sage100CustomerNo: string | null;
	contactCount: number;
	milesFromHub: number | null;
	notes: string | null;
};

export type TripPdfDay = {
	day: number;
	label: string | null;
	stops: TripPdfStop[];
};

export type TripPdfPlan = {
	hubCity: string;
	hubStateCode: string;
	dayCount: number;
	radiusMiles: number;
	activityMode: "ACTIVE" | "SALVAGE";
	activityYears: number;
	itinerary: {
		summary: string | null;
		days: TripPdfDay[];
	};
};

/**
 * Client-only PDF download for a saved trip itinerary. Nothing is stored on
 * the server — generate once and download.
 */
export function downloadTripPdf(plan: TripPdfPlan) {
	const itinerary = plan.itinerary;
	const doc = new jsPDF({ unit: "pt", format: "letter" });
	const margin = 48;
	const pageWidth = doc.internal.pageSize.getWidth();
	const maxWidth = pageWidth - margin * 2;
	let y = margin;

	const ensureSpace = (needed: number) => {
		if (y + needed > doc.internal.pageSize.getHeight() - margin) {
			doc.addPage();
			y = margin;
		}
	};

	const write = (
		text: string,
		size = 11,
		style: "normal" | "bold" = "normal",
	) => {
		doc.setFont("helvetica", style);
		doc.setFontSize(size);
		const lines = doc.splitTextToSize(text, maxWidth) as string[];
		for (const line of lines) {
			ensureSpace(size + 6);
			doc.text(line, margin, y);
			y += size + 4;
		}
	};

	write("Sales trip plan", 18, "bold");
	y += 4;
	write(`${plan.hubCity}, ${plan.hubStateCode} · ${plan.dayCount} day(s)`, 12);
	write(
		`Radius ${plan.radiusMiles} mi · ${plan.activityMode === "ACTIVE" ? "Active" : "Salvage"} (${plan.activityYears} yr)`,
		10,
	);
	if (itinerary.summary) {
		y += 6;
		write(itinerary.summary, 11);
	}
	y += 10;

	for (const day of itinerary.days) {
		ensureSpace(40);
		write(`Day ${day.day}${day.label ? ` — ${day.label}` : ""}`, 13, "bold");
		y += 2;
		for (const stop of day.stops) {
			const place = [stop.streetAddress, stop.city, stop.stateCode]
				.filter(Boolean)
				.join(", ");
			const meta = [
				stop.sage100CustomerNo ? `#${stop.sage100CustomerNo}` : null,
				stop.contactCount > 0 ? `${stop.contactCount} contacts` : null,
				stop.milesFromHub != null ? `${stop.milesFromHub} mi` : null,
			]
				.filter(Boolean)
				.join(" · ");
			write(`• ${stop.companyName}`, 11, "bold");
			if (place) write(`  ${place}`, 10);
			if (meta) write(`  ${meta}`, 9);
			if (stop.notes) write(`  ${stop.notes}`, 9);
			y += 4;
		}
		y += 8;
	}

	const filename = `trip-${plan.hubCity.replace(/\s+/g, "-").toLowerCase()}-${plan.hubStateCode.toLowerCase()}.pdf`;
	doc.save(filename);
}
