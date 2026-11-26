import Image from "next/image";
import { cn } from "@/lib/utils";

// The Gift Valy wordmark for the ERP: navy + orange on transparent, with its
// dark-mode twin (the navy turned white) so it stays readable on a dark
// background. Both files come from scripts/generate-brand-assets.ts.
// The files are 1454 × 388; this is the largest box the ERP draws (same ratio),
// so next/image serves 384/640 px copies instead of the full file.
export const LOGO_SIZE = { width: 300, height: 80 } as const;

/** Pass the height only (e.g. "h-8"); the width follows the logo. */
export function BrandLogo({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <>
      <Image
        src="/gift-valy-logo.png"
        alt="Gift Valy"
        {...LOGO_SIZE}
        priority={priority}
        className={cn("w-auto dark:hidden", className)}
      />
      {/* Lazy + display:none in light mode, so it is never downloaded there. */}
      <Image
        src="/gift-valy-logo-dark.png"
        alt="Gift Valy"
        {...LOGO_SIZE}
        className={cn("hidden w-auto dark:block", className)}
      />
    </>
  );
}
