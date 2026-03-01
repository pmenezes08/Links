import { Link } from "react-router-dom";

export const Footer = () => {
  return (
    <footer className="bg-[#4db6ac] py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <a href="/" className="text-lg font-bold tracking-tight text-white">
              C<span className="text-white/80">-</span>Point
            </a>
            <p className="text-sm text-white/60 mt-1">
              High-signal networking, powered by AI.
            </p>
          </div>

          <div className="flex items-center gap-6">
            <a href="#networking" className="text-sm text-white/70 hover:text-white transition-colors">Networking</a>
            <a href="#communities" className="text-sm text-white/70 hover:text-white transition-colors">Communities</a>
            <a href="#tools" className="text-sm text-white/70 hover:text-white transition-colors">Tools</a>
          </div>

          <div className="flex items-center gap-6">
            <Link to="/privacy" className="text-sm text-white/70 hover:text-white transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="text-sm text-white/70 hover:text-white transition-colors">
              Terms
            </Link>
            <Link to="/support" className="text-sm text-white/70 hover:text-white transition-colors">
              Support
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
