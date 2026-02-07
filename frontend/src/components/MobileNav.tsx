"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="mobile-nav-toggle"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open && (
        <nav
          className="shell-nav nav-open"
          aria-label="Mobile navigation"
        >
          <Link href="/app" onClick={() => setOpen(false)}>Dashboard</Link>
          <Link href="/profile" onClick={() => setOpen(false)}>Profile</Link>
        </nav>
      )}
    </>
  );
}
