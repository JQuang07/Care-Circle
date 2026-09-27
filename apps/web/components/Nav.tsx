"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/stage", label: "Stage" },
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
    <nav className="glass sticky top-3 z-30 mx-auto mt-3 flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-x-5 gap-y-2 rounded-full py-1.5 pl-5 pr-1.5">
      <span className="text-[17px] font-bold tracking-tight">Care Circle</span>
      <ul className="flex flex-wrap gap-1">
        {LINKS.map((l) => {
          const active = path?.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-full px-3.5 py-1.5 text-[15px] transition-colors ${active ? "glass-ink" : "text-heron hover:bg-white/55 hover:text-ink"}`}
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
