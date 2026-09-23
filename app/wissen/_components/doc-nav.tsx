import Link from "next/link";
import type { NavGroup, NavItem } from "@/lib/docs/nav";
import { cn } from "cn";

/** The same small caps label the viewer's sidebar uses for its sections. */
export const SECTION_LABEL =
  "font-semibold text-[11px] uppercase leading-none tracking-widest text-muted-foreground";

function Entry({ current, item }: { current: string; item: NavItem }) {
  const here = item.href === current;
  const open = here || item.children.some((c) => c.href === current);
  return (
    <li>
      <Link
        aria-current={here ? "page" : undefined}
        className={cn(
          "block rounded-md px-2 py-1.5 text-[13px] leading-snug hover:bg-accent",
          here
            ? "bg-primary/8 font-medium text-primary hover:bg-primary/10"
            : "text-foreground/80"
        )}
        href={item.href}
      >
        {item.title}
      </Link>
      {open && item.children.length > 0 ? (
        <ul className="my-1 ml-3 flex flex-col gap-px border-l pl-2">
          {item.children.map((child) => (
            <Entry current={current} item={child} key={child.file} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The knowledge base's menu: guide (de, en) and developer docs, in index order. */
export function DocNav({
  current,
  groups,
}: {
  current: string;
  groups: NavGroup[];
}) {
  return (
    <nav aria-label="Wissen" className="flex flex-col gap-7">
      {groups.map((group) => (
        <div className="flex flex-col gap-2.5" key={group.id}>
          <span className={cn(SECTION_LABEL, "px-2")}>{group.label}</span>
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => (
              <Entry current={current} item={item} key={item.file} />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
