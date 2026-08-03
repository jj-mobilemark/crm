"use client";

import {
	Map,
	MapMarker,
	MapMarkerClusterGroup,
	MapTileLayer,
	MapZoomControl,
} from "@crm/ui/components/map";

export type MapCompanyPoint = {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	isMine: boolean;
	sageCrmCompanyId: string | null;
};

const US_CENTER: [number, number] = [39.8283, -98.5795];

function markerTone(point: MapCompanyPoint): string {
	if (point.isMine) return "text-primary";
	if (point.sageCrmCompanyId) return "text-chart-2";
	return "text-warning";
}

function PinIcon({ className }: { className: string }) {
	return (
		<svg
			aria-hidden
			viewBox="0 0 24 24"
			className={`size-6 drop-shadow-sm ${className}`}
			fill="currentColor"
		>
			<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />
		</svg>
	);
}

export function CompaniesMapCanvas({
	points,
	selectedId,
	onSelect,
}: {
	points: MapCompanyPoint[];
	selectedId: string;
	onSelect: (id: string) => void;
}) {
	const first = points[0];
	const center: [number, number] =
		points.length === 1 && first
			? [first.latitude, first.longitude]
			: US_CENTER;

	return (
		<Map
			center={center}
			zoom={points.length === 1 ? 10 : 4}
			className="size-full min-h-[28rem] rounded-lg"
		>
			<MapTileLayer />
			<MapZoomControl />
			<MapMarkerClusterGroup>
				{points.map((point) => (
					<MapMarker
						key={point.id}
						position={[point.latitude, point.longitude]}
						eventHandlers={{
							click: () => onSelect(point.id),
						}}
						icon={
							<PinIcon
								className={`${markerTone(point)} ${
									selectedId === point.id ? "scale-125" : ""
								}`}
							/>
						}
						iconAnchor={[12, 24]}
					/>
				))}
			</MapMarkerClusterGroup>
		</Map>
	);
}
