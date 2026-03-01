import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { AppShowcase } from "@/components/AppShowcase";
import { MeetSteve } from "@/components/MeetSteve";
import { Identity } from "@/components/Identity";
import { CommunitiesSection } from "@/components/CommunitiesSection";
import { Tools } from "@/components/Tools";
import { CTA } from "@/components/CTA";
import { Footer } from "@/components/Footer";
import { FloatingContactButton } from "@/components/FloatingContactButton";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <Hero />
      <AppShowcase />
      <MeetSteve />
      <Identity />
      <CommunitiesSection />
      <Tools />
      <CTA />
      <Footer />
      <FloatingContactButton />
    </div>
  );
};

export default Index;
