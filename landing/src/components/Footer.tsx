import { Link } from "react-router-dom";

export const Footer = () => {
  return (
    <footer className="bg-[#4db6ac] py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="text-center lg:text-left">
            <a href="/" className="text-lg font-bold tracking-tight text-white">
              C<span className="text-white/80">-</span>Point
            </a>
            <p className="text-sm text-white/60 mt-1">
              A global platform of private networks — invitation-only, with Steve in every community.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <a href="#manifesto" className="text-sm text-white/70 hover:text-white transition-colors">
              Manifesto
            </a>
            <a href="#why-cpoint" className="text-sm text-white/70 hover:text-white transition-colors">
              Why C-Point
            </a>
            <a href="#audiences" className="text-sm text-white/70 hover:text-white transition-colors">
              Who it's for
            </a>
            <a href="#steve" className="text-sm text-white/70 hover:text-white transition-colors">
              Steve
            </a>
            <a href="#communities" className="text-sm text-white/70 hover:text-white transition-colors">
              Communities
            </a>
            <a href="#tools" className="text-sm text-white/70 hover:text-white transition-colors">
              Tools
            </a>
            <a href="#membership" className="text-sm text-white/70 hover:text-white transition-colors">
              Plans
            </a>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link to="/privacy" className="text-sm text-white/70 hover:text-white transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="text-sm text-white/70 hover:text-white transition-colors">
              Terms
            </Link>
            <Link to="/support" className="text-sm text-white/70 hover:text-white transition-colors">
              Support
            </Link>
            <Link to="/safety" className="text-sm text-white/70 hover:text-white transition-colors">
              Safety
            </Link>
            <Link to="/admin" className="text-sm text-white/70 hover:text-white transition-colors">
              Operator login
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/15 text-center">
          <p className="text-xs text-white/50">
            &copy; {new Date().getFullYear()} C-Point. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
