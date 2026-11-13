import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/design-system";

// The build's mark: the IVY leaf (ps) or the ETS boomerangs (ETS). Square
// and transparent in both, so every placement sizes it the same way.
interface AppLogoProps {
  className?: string;
  width?: number;
  height?: number;
  // Decorative by default: every current placement sits next to the app name.
  alt?: string;
}

export function AppLogo({
  className,
  width = 32,
  height = 32,
  alt = "",
}: AppLogoProps) {
  return (
    <img
      src={BRAND.mark}
      alt={alt}
      width={width}
      height={height}
      className={cn("flex-shrink-0 object-contain", className)}
    />
  );
}
