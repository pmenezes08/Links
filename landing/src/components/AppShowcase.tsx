export const AppShowcase = () => {
  return (
    <section className="section-padding bg-gradient-to-b from-muted/40 to-background overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">
            The Experience
          </p>
          <h2 className="heading-lg text-foreground mb-4">
            Designed for{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              Connection.
            </span>
          </h2>
          <p className="body-lg">
            A sleek, intuitive interface that puts meaningful conversations first.
            Communities, profiles, and messaging — all in one place.
          </p>
        </div>

        {/* Phone mockups */}
        <div className="flex justify-center items-end gap-4 md:gap-8">
          {/* Dashboard */}
          <div className="w-[160px] sm:w-[200px] md:w-[240px] flex-shrink-0 transform -rotate-3 hover:rotate-0 transition-transform duration-500">
            <div className="rounded-[24px] overflow-hidden shadow-2xl border border-black/10">
              <img
                src="/screenshots/Dashboard.png"
                alt="C.Point Dashboard - Your Communities"
                className="w-full h-auto"
              />
            </div>
            <p className="text-center text-xs text-muted-foreground mt-3 font-medium">Communities</p>
          </div>

          {/* Profile - center, slightly larger */}
          <div className="w-[180px] sm:w-[220px] md:w-[260px] flex-shrink-0 transform hover:scale-105 transition-transform duration-500 z-10">
            <div className="rounded-[24px] overflow-hidden shadow-2xl border border-black/10">
              <img
                src="/screenshots/profile.png"
                alt="C.Point Professional Profile"
                className="w-full h-auto"
              />
            </div>
            <p className="text-center text-xs text-muted-foreground mt-3 font-medium">Professional Profile</p>
          </div>

          {/* Chat */}
          <div className="w-[160px] sm:w-[200px] md:w-[240px] flex-shrink-0 transform rotate-3 hover:rotate-0 transition-transform duration-500">
            <div className="rounded-[24px] overflow-hidden shadow-2xl border border-black/10">
              <img
                src="/screenshots/chat.jpg"
                alt="C.Point Direct Messages"
                className="w-full h-auto"
              />
            </div>
            <p className="text-center text-xs text-muted-foreground mt-3 font-medium">Messaging</p>
          </div>
        </div>
      </div>
    </section>
  );
};
