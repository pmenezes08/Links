export const Footer = () => {
  return (
    <footer className="bg-card border-t border-border py-12">
      <div className="container mx-auto px-4">
        <div className="text-center">
          <h3 className="text-2xl font-bold text-foreground mb-2">C-Point</h3>
          <p className="text-muted-foreground mb-4">
            Enter the network where ideas connect people
          </p>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} C-Point. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
