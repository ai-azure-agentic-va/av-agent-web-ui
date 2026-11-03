import {
  KeyboardEvent,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowDownLeft, LibraryBig, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardHeader, CardTitle, cardVariants } from "@/components/ui/card";

export type StarterPrompt = { label?: string; message: string };

// The welcome screen shows this many prompts as Starter tiles; the library
// holds every prompt, listing the same first four as Starters, then the rest.
export const STARTER_TILE_COUNT = 4;

// Marks the elements that open the library, so a press on one isn't read as
// an outside click that closes it just before it re-opens.
const TRIGGER_ATTR = "data-prompt-library-trigger";
const triggerProps = { [TRIGGER_ATTR]: "" };

// The card never rides up under the 60px sticky header.
const HEADER_CLEARANCE = 72;
const MAX_CARD_HEIGHT = 520;
const MIN_CARD_HEIGHT = 240;

function isTrigger(el: EventTarget | null) {
  return el instanceof Element && !!el.closest(`[${TRIGGER_ATTR}]`);
}

export function PromptLibraryButton({
  open,
  onOpenChange,
  controlsId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controlsId: string;
}) {
  return (
    <button
      type="button"
      {...triggerProps}
      onClick={() => onOpenChange(!open)}
      aria-label="Prompt library"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? controlsId : undefined}
      title="Prompt library"
      className={cn(
        "text-foreground hover:bg-accent focus-visible:ring-ring flex h-8 w-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2",
        open && "bg-accent",
      )}
    >
      <LibraryBig className="h-4 w-4" />
    </button>
  );
}

// The welcome screen's way into the library, under the Starter tiles. Same
// icon as the composer button, so it teaches where the library lives.
export function PromptLibraryLink({
  count,
  open,
  onOpenChange,
}: {
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <button
      type="button"
      {...triggerProps}
      onClick={() => onOpenChange(!open)}
      aria-haspopup="dialog"
      aria-expanded={open}
      className="text-foreground focus-visible:ring-ring inline-flex items-center gap-2 self-start rounded-md text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-offset-2"
    >
      <LibraryBig
        aria-hidden="true"
        className="size-4"
      />
      <span>See all {count} prompts</span>
    </button>
  );
}

function focusItem(
  card: HTMLElement | null,
  pick: (items: HTMLElement[], i: number) => number,
  options?: FocusOptions,
) {
  if (!card) return;
  const items = Array.from(
    card.querySelectorAll<HTMLElement>("[data-prompt-item]"),
  );
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  items[pick(items, current)]?.focus(options);
}

/**
 * The library as a card that slides out of the composer. It opens on the side
 * of the composer with more room (above it once a conversation has started,
 * either way on the welcome screen) and spans the composer's width. Picking a
 * prompt hands it to `onPick` and the card goes away; the composer owns what
 * happens to the text.
 */
export function PromptLibraryCard({
  id,
  open,
  onOpenChange,
  prompts,
  onPick,
  anchorRef,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompts: StarterPrompt[];
  onPick: (message: string) => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Where focus was when the card opened, to hand it back on dismiss.
  const openerRef = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<{
    side: "top" | "bottom";
    maxHeight: number;
  }>({ side: "top", maxHeight: MAX_CARD_HEIGHT });

  const starters = prompts.slice(0, STARTER_TILE_COUNT);
  const more = prompts.slice(STARTER_TILE_COUNT);

  const dismiss = useCallback(
    (restoreFocus: boolean) => {
      onOpenChange(false);
      const opener = openerRef.current;
      if (restoreFocus && opener?.isConnected) opener.focus();
    },
    [onOpenChange],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const above = rect.top - HEADER_CLEARANCE;
      const below = window.innerHeight - rect.bottom - 16;
      const side =
        above >= Math.min(MAX_CARD_HEIGHT, MIN_CARD_HEIGHT * 1.5) ||
        above >= below
          ? "top"
          : "bottom";
      const room = side === "top" ? above : below;
      setPlacement({
        side,
        maxHeight: Math.max(
          Math.min(MAX_CARD_HEIGHT, room - 8),
          MIN_CARD_HEIGHT,
        ),
      });
    };
    // Opened from the welcome screen's link, the composer can be scrolled out
    // of view; bring it back so the card slides out of the box it will fill.
    anchorRef.current?.scrollIntoView({ block: "nearest" });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, anchorRef]);

  // Open: remember the opener, then move focus to the first prompt. Wait a
  // frame so the card is on its measured side, and don't let the focus scroll
  // the page out from under that measurement.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    openerRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    const frame = requestAnimationFrame(() =>
      focusItem(cardRef.current, () => 0, { preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Outside press and Escape close it, like any popover.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (cardRef.current?.contains(e.target as Node) || isTrigger(e.target))
        return;
      dismiss(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      dismiss(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, dismiss]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, (items: HTMLElement[], i: number) => number> = {
      ArrowDown: (items, i) => (i + 1) % items.length,
      ArrowUp: (items, i) => (i <= 0 ? items.length - 1 : i - 1),
      Home: () => 0,
      End: (items) => items.length - 1,
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    focusItem(cardRef.current, move);
  };

  return (
    <div
      ref={cardRef}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      data-side={placement.side}
      onKeyDown={onKeyDown}
      // Tabbing out of the card closes it; a press elsewhere is handled above.
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next && !cardRef.current?.contains(next) && !isTrigger(next))
          onOpenChange(false);
      }}
      style={{ maxHeight: placement.maxHeight }}
      className={cn(
        cardVariants({ tone: "float" }),
        "group/lib slide-card absolute inset-x-0 z-30 flex flex-col overflow-hidden",
        placement.side === "top" ? "bottom-full mb-2" : "top-full mt-2",
      )}
    >
      <CardHeader className="justify-between">
        {/* One line from 640px: the title, then how the library works. */}
        <div className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-3">
          <CardTitle
            as="h2"
            id={titleId}
            className="flex shrink-0 items-baseline gap-2"
          >
            Prompt library
            <span className="text-muted-foreground text-xs font-medium">
              {prompts.length}
            </span>
          </CardTitle>
          <p className="text-muted-foreground min-w-0 text-[13px] leading-5 sm:truncate">
            Pick one, edit it, then press Enter.
          </p>
        </div>
        <button
          type="button"
          onClick={() => dismiss(true)}
          aria-label="Close prompt library"
          title="Close"
          className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
        >
          <XIcon className="size-4" />
        </button>
      </CardHeader>

      <div className="flex scrollbar-thin flex-col gap-2 overflow-y-auto overscroll-contain p-2">
        <section aria-label="Starters">
          <h3 className="text-muted-foreground px-2 pt-1 pb-0.5 text-[13px] leading-5 font-medium">
            Starters
          </h3>
          <PromptList
            prompts={starters}
            onPick={onPick}
          />
        </section>

        {more.length > 0 && (
          <section aria-label="More prompts">
            <h3 className="text-muted-foreground px-2 pt-1 pb-0.5 text-[13px] leading-5 font-medium">
              More prompts
            </h3>
            <PromptList
              prompts={more}
              onPick={onPick}
            />
          </section>
        )}
      </div>
    </div>
  );
}

// Both groups in the card share one dense row: the title and a truncated
// description on one line from 640px (stacked below it), then the insert
// glyph. Only the welcome screen lays the Starters out as tiles.
function PromptList({
  prompts,
  onPick,
}: {
  prompts: StarterPrompt[];
  onPick: (message: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {prompts.map((prompt, i) => (
        <li key={i}>
          <button
            type="button"
            data-prompt-item
            onClick={() => onPick(prompt.message)}
            className="group/pi hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-2"
          >
            <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-3">
              <span
                className={cn(
                  "text-foreground text-sm leading-5 font-medium",
                  prompt.label
                    ? "shrink-0 truncate sm:max-w-[45%]"
                    : "line-clamp-2 sm:line-clamp-1",
                )}
              >
                {prompt.label || prompt.message}
              </span>
              {prompt.label && (
                <span className="text-muted-foreground min-w-0 truncate text-[13px] leading-5 font-light">
                  {prompt.message}
                </span>
              )}
            </span>
            <InsertGlyph />
          </button>
        </li>
      ))}
    </ul>
  );
}

// Points into the message box: down-left with the card above the composer,
// flipped to up-left when it opens below. Shown on hover and focus only.
function InsertGlyph() {
  return (
    <ArrowDownLeft
      aria-hidden="true"
      className="size-4 shrink-0 opacity-0 transition-opacity group-hover/pi:opacity-100 group-focus-visible/pi:opacity-100 group-data-[side=bottom]/lib:-scale-y-100"
    />
  );
}
