import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="container mx-auto px-4 py-4">
          <Link to="/" className="text-2xl font-bold text-[#4db6ac]">
            C-Point
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center px-4">
          <div className="mb-6">
            <span className="text-8xl font-bold text-[#4db6ac]">404</span>
          </div>
          <h1 className="text-3xl font-bold mb-4">Page Not Found</h1>
          <p className="text-white/60 mb-8 max-w-md mx-auto">
            Sorry, the page you're looking for doesn't exist or has been moved.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link 
              to="/" 
              className="bg-[#4db6ac] text-black font-medium px-6 py-3 rounded-lg hover:bg-[#45a99c] transition-colors"
            >
              Go to Homepage
            </Link>
            <Link 
              to="/support" 
              className="bg-white/10 text-white font-medium px-6 py-3 rounded-lg hover:bg-white/20 transition-colors"
            >
              Contact Support
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-6">
        <div className="container mx-auto px-4 text-center text-white/60">
          <div className="flex justify-center gap-6">
            <Link to="/privacy" className="hover:text-[#4db6ac]">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-[#4db6ac]">Terms of Service</Link>
            <Link to="/support" className="hover:text-[#4db6ac]">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default NotFound;
