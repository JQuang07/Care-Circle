"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/family", label: "Family phones" },
  { href: "/dashboard", label: "Rose's week" },
  { href: "/tablet", label: "Rose's tablet" },
  { href: "/demo", label: "Demo controls" },
];

export function Nav() {
  const path = usePathname();
  // The tablet is Rose's screen: no chrome, nothing to tap by mistake.
  if (path?.startsWith("/tablet")) return null;
  return (
    <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-heron/20 bg-white/70 px-5 py-3">
      <span className="text-lg font-bold">Care Circle</span>
      <ul className="flex flex-wrap gap-1">
        {LINKS.map((l) => {
          const active = path?.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-[15px] ${active ? "bg-ink text-white" : "text-heron hover:bg-heron/10 hover:text-ink"}`}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
