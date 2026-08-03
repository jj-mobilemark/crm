"use client";

import {
	Map,
	MapBoundsListener,
	MapFlyTo,
	MapMarker,
	MapMarkerClusterGroup,
	MapTileLayer,
	MapZoomControl,
	type MapLatLngBounds,
} from "@crm/ui/components/map";

export type MapCompanyPoint = {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	isMine: boolean;
	sageCrmCompanyId: string | null;
};

export type { MapLatLngBounds };

const US_CENTER: [number, number] = [39.8283, -98.5795];
const SELECT_ZOOM = 12;

type MarkerWithCompany = {
	options: { title?: string; crmCompanyId?: string };
	getLatLng?: () => { lat: number; lng: number };
};

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

function SelectedPinIcon({ className }: { className: string }) {
	return (
		<span
			className={`relative flex size-10 items-center justify-center ${className}`}
		>
			<span
				className="absolute size-9 rounded-full bg-background/95 ring-2 ring-current"
				aria-hidden
			/>
			<span
				className="absolute size-9 animate-ping rounded-full bg-current opacity-25"
				aria-hidden
			/>
			<svg
				aria-hidden
				viewBox="0 0 24 24"
				className="relative size-7 drop-shadow-md"
				fill="currentColor"
			>
				<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />
			</svg>
		</span>
	);
}

function companyIdFromMarker(
	marker: MarkerWithCompany,
	pointsByCoord: globalThis.Map<string, string[]>,
): string[] {
	const fromOptions = marker.options.crmCompanyId ?? marker.options.title;
	if (fromOptions) return [fromOptions];
	const latLng = marker.getLatLng?.();
	if (!latLng) return [];
	return pointsByCoord.get(`${latLng.lat},${latLng.lng}`) ?? [];
}

export function CompaniesMapCanvas({
	points,
	selectedId,
	onSelect,
	onClusterSelect,
	onBoundsChange,
}: {
	points: MapCompanyPoint[];
	selectedId: string;
	onSelect: (id: string) => void;
	onClusterSelect: (ids: string[]) => void;
	onBoundsChange: (bounds: MapLatLngBounds) => void;
}) {
	const first = points[0];
	const center: [number, number] =
		points.length === 1 && first
			? [first.latitude, first.longitude]
			: US_CENTER;

	const selectedPoint =
		selectedId === ""
			? null
			: (points.find((point) => point.id === selectedId) ?? null);

	const pointsByCoord = new globalThis.Map<string, string[]>();
	for (const point of points) {
		const key = `${point.latitude},${point.longitude}`;
		const list = pointsByCoord.get(key);
		if (list) list.push(point.id);
		else pointsByCoord.set(key, [point.id]);
	}

	return (
		<Map
			center={center}
			zoom={points.length === 1 ? 10 : 4}
			className="size-full min-h-[28rem] rounded-lg"
		>
			<MapTileLayer />
			<MapZoomControl />
			<MapBoundsListener onBoundsChange={onBoundsChange} />
			{selectedPoint ? (
				<MapFlyTo
					focusKey={selectedPoint.id}
					latitude={selectedPoint.latitude}
					longitude={selectedPoint.longitude}
					zoom={SELECT_ZOOM}
				/>
			) : null}
			<MapMarkerClusterGroup
				eventHandlers={{
					clusterclick: (event: {
						layer: { getAllChildMarkers: () => MarkerWithCompany[] };
					}) => {
						const ids = [
							...new globalThis.Set(
								event.layer
									.getAllChildMarkers()
									.flatMap((marker) =>
										companyIdFromMarker(marker, pointsByCoord),
									),
							),
						];
						if (ids.length > 0) onClusterSelect(ids);
					},
				}}
			>
				{points.map((point) => {
					const isSelected = selectedId === point.id;
					return (
						<MapMarker
							key={point.id}
							title={point.id}
							position={[point.latitude, point.longitude]}
							opacity={selectedId && !isSelected ? 0.45 : 1}
							zIndexOffset={isSelected ? 500 : 0}
							eventHandlers={{
								click: () => onSelect(point.id),
								add: (event: { target: MarkerWithCompany }) => {
									event.target.options.crmCompanyId = point.id;
								},
							}}
							icon={
								<PinIcon
									className={`${markerTone(point)} ${
										isSelected ? "scale-125" : ""
									}`}
								/>
							}
							iconAnchor={[12, 24]}
						/>
					);
				})}
			</MapMarkerClusterGroup>
			{/* Unclustered highlight so the selection stays visible above clusters. */}
			{selectedPoint ? (
				<MapMarker
					key={`focus-${selectedPoint.id}`}
					position={[selectedPoint.latitude, selectedPoint.longitude]}
					zIndexOffset={2000}
					interactive={false}
					icon={
						<SelectedPinIcon className={markerTone(selectedPoint)} />
					}
					iconAnchor={[20, 28]}
				/>
			) : null}
		</Map>
	);
}
