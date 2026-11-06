import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act, render } from "@testing-library/react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { vi } from "vitest";
import {
  type UserSkill,
  type UserSkillDraft,
  createSkill,
  deleteSkill,
  getUserSkills,
} from "@/lib/user-skills";

// Shared setup for the skills tests: the store is one module-level cache over
// localStorage, so every test empties it through the public API first.

export function clearSkills() {
  act(() => {
    for (const skill of getUserSkills()) deleteSkill(skill.id);
  });
  window.localStorage.clear();
}

export function seedSkills(...drafts: Partial<UserSkillDraft>[]): UserSkill[] {
  let created: UserSkill[] = [];
  act(() => {
    created = drafts.map((draft) =>
      createSkill({
        name: "Skill",
        description: "",
        instructions: "Do the thing.",
        ...draft,
      }),
    );
  });
  return created;
}

/**
 * Renders inside nuqs' testing adapter, which keeps URL updates in memory the
 * way the app router would. `url()` is the query string as it stands now.
 */
export function renderWithUrl(ui: ReactNode, searchParams = "") {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
  const result = render(
    <NuqsTestingAdapter
      searchParams={searchParams}
      onUrlUpdate={onUrlUpdate}
      hasMemory
    >
      {ui}
    </NuqsTestingAdapter>,
  );
  const url = () =>
    onUrlUpdate.mock.lastCall?.[0].searchParams ??
    new URLSearchParams(searchParams);
  return { ...result, onUrlUpdate, url };
}

/**
 * Renders the tree to HTML the way the server does, then hydrates that HTML
 * the way the browser does, and returns every mismatch React reported.
 */
export async function hydrationErrors(
  ui: ReactNode,
  searchParams = "",
): Promise<string[]> {
  const tree = (
    <NuqsTestingAdapter searchParams={searchParams}>{ui}</NuqsTestingAdapter>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree);
  document.body.appendChild(container);

  const errors: string[] = [];
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
  try {
    const root = await act(async () =>
      hydrateRoot(container, tree, {
        onRecoverableError: (error) => errors.push(String(error)),
      }),
    );
    act(() => root.unmount());
  } finally {
    consoleError.mockRestore();
    container.remove();
  }
  return errors.filter((e) => /hydrat|did(n't| not) match/i.test(e));
}
