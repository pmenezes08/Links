import { Link } from "react-router-dom";

export const Footer = () => {
  return (
    <footer className="border-t border-black/[0.06] py-12 bg-muted/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <a href="/" className="text-lg font-bold tracking-tight text-foreground">
              C<span className="text-primary">.</span>Point
            </a>
            <p className="text-sm text-muted-foreground mt-1">
              High-signal networking, powered by AI.
            </p>
          </div>

          <div className="flex items-center gap-6">
            <a href="#networking" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Networking</a>
            <a href="#communities" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Communities</a>
            <a href="#tools" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Tools</a>
          </div>

          <div className="flex items-center gap-6">
            <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link to="/support" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Support
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-black/[0.06] text-center">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} C.Point. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
