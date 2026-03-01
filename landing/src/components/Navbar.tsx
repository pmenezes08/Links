import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/cpoint/id6755534074";

const navLinks = [
  { label: "Networking", href: "#networking" },
  { label: "Communities", href: "#communities" },
  { label: "Tools", href: "#tools" },
];

export const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled
        ? "bg-white/90 backdrop-blur-xl border-b border-black/[0.04] shadow-sm"
        : "bg-transparent"
    }`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="/" className={`text-xl font-bold tracking-tight transition-colors ${scrolled ? "text-foreground" : "text-white"}`}>
          C<span className={scrolled ? "text-primary" : "text-white/80"}>.</span>Point
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map(link => (
            <a
              key={link.href}
              href={link.href}
              className={`text-sm transition-colors ${
                scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white"
              }`}
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              scrolled
                ? "bg-foreground text-background hover:opacity-90"
                : "bg-white/20 text-white backdrop-blur-sm border border-white/25 hover:bg-white/30"
            }`}
          >
            Get the App
          </a>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden p-2" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X size={20} className={scrolled ? "" : "text-white"} /> : <Menu size={20} className={scrolled ? "" : "text-white"} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-black/[0.04] px-6 py-4 space-y-3">
          {navLinks.map(link => (
            <a
              key={link.href}
              href={link.href}
              className="block text-sm text-muted-foreground hover:text-foreground py-2"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center px-4 py-2.5 rounded-full bg-foreground text-background text-sm font-medium"
          >
            Get the App
          </a>
        </div>
      )}
    </nav>
  );
};
