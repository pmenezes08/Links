import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "./i18n/LanguageContext";
import "./redesign/redesign.css";
import Home from "./pages/Home";
import Platform from "./pages/Platform";
import Organizations from "./pages/Organizations";
import Manifesto from "./pages/Manifesto";
import Plans from "./pages/Plans";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Support from "./pages/Support";
import Safety from "./pages/Safety";
import PrivacyPt from "./pages/legal/PrivacyPt";
import TermsPt from "./pages/legal/TermsPt";
import SafetyPt from "./pages/legal/SafetyPt";
import AdminLogin from "./pages/AdminLogin";
import ForCommunityOwners from "./pages/ForCommunityOwners";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/platform" element={<Platform />} />
          <Route path="/organizations" element={<Organizations />} />
          <Route path="/organisations" element={<Organizations />} />
          <Route path="/manifesto" element={<Manifesto />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/support" element={<Support />} />
          <Route path="/safety" element={<Safety />} />
          <Route path="/pt/privacy" element={<PrivacyPt />} />
          <Route path="/pt/terms" element={<TermsPt />} />
          <Route path="/pt/safety" element={<SafetyPt />} />
          <Route path="/for-community-owners" element={<ForCommunityOwners />} />
          <Route path="/admin" element={<AdminLogin />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
