import { cn } from "@crm/ui/lib/utils";
import type * as React from "react";

/**
 * Mobile Mark signal mark — used in the app header, auth shell, and agent panel.
 * Served from the Next app `public/` folder.
 */
const Logo = ({
	className,
	alt = "Mobile Mark CRM",
	...props
}: React.ImgHTMLAttributes<HTMLImageElement>) => (
	<img
		src="/mobile-mark-mark.png"
		alt={alt}
		draggable={false}
		className={cn("object-contain", className)}
		{...props}
	/>
);

export default Logo;
