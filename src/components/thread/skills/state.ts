import { parseAsStringLiteral, useQueryState } from "nuqs";

// `?skill=<id>` opens that skill in the reading column in place of the
// conversation; `?skill=new` opens a blank one to write.
export const NEW_SKILL = "new";

export function useOpenSkill() {
  return useQueryState("skill");
}

const SIDEBAR_VIEWS = ["conversations", "skills"] as const;
export type SidebarView = (typeof SIDEBAR_VIEWS)[number];

// Which list the sidebar shows. Kept in the URL with the other panel state,
// so the desktop rail and the mobile sheet agree.
export function useSidebarView() {
  return useQueryState(
    "sidebar",
    parseAsStringLiteral(SIDEBAR_VIEWS).withDefault("conversations"),
  );
}
