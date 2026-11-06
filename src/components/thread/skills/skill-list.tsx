import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { skillHandle, useUserSkills } from "@/lib/user-skills";
import { NEW_SKILL, useOpenSkill } from "./state";

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** The sidebar's Skills view: search, a new-skill button and the list. */
export function SkillList({ onNavigate }: { onNavigate?: () => void }) {
  const skills = useUserSkills();
  const [openSkill, setOpenSkill] = useOpenSkill();
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => [...skills].sort(byName), [skills]);
  const q = query.trim().toLowerCase();
  const shown = q
    ? sorted.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          skillHandle(s.name).includes(q),
      )
    : sorted;

  const open = (id: string) => {
    void setOpenSkill(id);
    onNavigate?.();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {skills.length > 0 && (
        <div className="flex gap-2 px-4 pt-3.5 pb-1.5">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills"
            aria-label="Search skills"
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => open(NEW_SKILL)}
            aria-label="New skill"
            title="New skill"
          >
            <Plus />
          </Button>
        </div>
      )}

      <div className="flex flex-1 scrollbar-thin flex-col overflow-y-auto px-3 pb-3">
        {skills.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-2 py-4">
            <div className="flex flex-col gap-1">
              <p className="text-foreground text-sm font-medium">
                No skills yet
              </p>
              <p className="text-muted-foreground text-sm font-light">
                Write down how you like a task done once, then use it in any
                chat.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => open(NEW_SKILL)}
            >
              <Plus />
              New skill
            </Button>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground px-3 pt-3 pb-1.5 text-[13px] font-medium">
              Your skills · {skills.length}
            </p>
            {shown.length === 0 ? (
              <p className="text-muted-foreground px-3 py-2 text-sm font-light">
                No skills match &ldquo;{query.trim()}&rdquo;
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {shown.map((s) => {
                  const isActive = s.id === openSkill;
                  const handle = skillHandle(s.name);
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => open(s.id)}
                        className={cn(
                          "text-foreground focus-visible:ring-ring flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2",
                          isActive ? "bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <span
                          className={cn(
                            "truncate text-sm",
                            isActive && "font-medium",
                          )}
                        >
                          {s.name}
                        </span>
                        {handle && (
                          <span className="text-muted-foreground truncate text-xs">
                            @{handle}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <p className="text-muted-foreground px-6 pt-2 pb-4 text-xs">
        Your skills are saved in this browser only.
      </p>
    </div>
  );
}
