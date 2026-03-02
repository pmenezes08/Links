import { Link } from "react-router-dom";

const Safety = () => {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="container mx-auto px-4 py-4">
          <Link to="/" className="text-2xl font-bold text-[#4db6ac]">
            C-Point
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-4xl font-bold mb-8">Safety Standards</h1>
        <p className="text-white/60 mb-8">Last updated: March 2026</p>

        <div className="prose prose-invert prose-lg max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">Our Commitment to Safety</h2>
            <p className="text-white/80 leading-relaxed">
              C-Point is committed to maintaining a safe, respectful, and lawful environment for all users.
              We take the safety of our community extremely seriously and have implemented strict policies
              and procedures to protect our users, with particular emphasis on the protection of minors.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">Zero Tolerance Policy</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              C-Point maintains a <strong className="text-white">zero tolerance policy</strong> for
              child sexual abuse and exploitation (CSAE) content of any kind. This includes, but is not limited to:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Any imagery, video, or other media depicting the sexual exploitation or abuse of minors</li>
              <li>Any content that sexualises minors in any way</li>
              <li>Solicitation or grooming of minors</li>
              <li>Sharing, distributing, or requesting CSAE material</li>
              <li>Any communication intended to facilitate the exploitation of a minor</li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              Users found to be in violation of this policy will have their accounts
              <strong className="text-white"> immediately and permanently terminated</strong>, and
              all associated content will be removed from our platform without notice.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">How to Report Illegal or Harmful Content</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              If you encounter any content on C-Point that you believe is illegal, harmful, or violates our
              safety standards, we strongly encourage you to report it immediately. You can report content
              through the following channels:
            </p>

            <h3 className="text-xl font-medium mb-3 mt-6">In-App Reporting</h3>
            <p className="text-white/80 leading-relaxed mb-4">
              Use the <strong className="text-white">Report</strong> button available on any post, message,
              or user profile within the app. Tap the three-dot menu (⋯) on any content and select "Report"
              to flag it for immediate review by our moderation team.
            </p>

            <h3 className="text-xl font-medium mb-3 mt-6">Email Reporting</h3>
            <p className="text-white/80 leading-relaxed mb-4">
              You can report content or safety concerns directly to our team at:{" "}
              <a href="mailto:safety@c-point.co" className="text-[#4db6ac] hover:underline">
                safety@c-point.co
              </a>
            </p>
            <p className="text-white/80 leading-relaxed">
              When reporting, please include as much detail as possible, including the username of the
              offending account, a description of the content or behaviour, and any screenshots if available.
              All reports are treated with strict confidentiality.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">Our Response to Illegal Content</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              When illegal content is identified or reported on our platform, C-Point will take the
              following actions promptly:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-3 ml-4">
              <li>
                <strong className="text-white">Immediate Removal:</strong> The content will be removed from
                the platform as soon as it is identified, without prior notice to the offending user.
              </li>
              <li>
                <strong className="text-white">Account Termination:</strong> The account responsible for
                posting the content will be permanently banned from C-Point.
              </li>
              <li>
                <strong className="text-white">Reporting to Authorities:</strong> We will report all instances
                of CSAE content to the{" "}
                <a href="https://www.missingkids.org/gethelpnow/cybertipline" target="_blank" rel="noopener noreferrer" className="text-[#4db6ac] hover:underline">
                  National Center for Missing & Exploited Children (NCMEC)
                </a>{" "}
                via the CyberTipline, as required by law. We will also cooperate fully with law enforcement
                agencies in any jurisdiction where applicable.
              </li>
              <li>
                <strong className="text-white">Evidence Preservation:</strong> In accordance with legal
                requirements, we will preserve relevant evidence and data to assist law enforcement
                investigations.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">Community Guidelines</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              Beyond illegal content, C-Point prohibits the following on our platform:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Harassment, bullying, or intimidation of other users</li>
              <li>Hate speech, discrimination, or content promoting violence</li>
              <li>Spam, scams, or fraudulent activity</li>
              <li>Impersonation of other users or public figures</li>
              <li>Sharing of others' private information without consent</li>
              <li>Any content that violates applicable laws or regulations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">Contact Us</h2>
            <p className="text-white/80 leading-relaxed">
              If you have questions about our safety policies, need to report a safety concern, or require
              assistance, please contact us:
            </p>
            <ul className="list-none text-white/80 space-y-2 mt-4">
              <li>
                Safety Team:{" "}
                <a href="mailto:safety@c-point.co" className="text-[#4db6ac] hover:underline">
                  safety@c-point.co
                </a>
              </li>
              <li>
                General Support:{" "}
                <a href="mailto:support@c-point.co" className="text-[#4db6ac] hover:underline">
                  support@c-point.co
                </a>
              </li>
            </ul>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-12">
        <div className="container mx-auto px-4 py-6 text-center text-white/40 text-sm">
          <p>&copy; {new Date().getFullYear()} C-Point. All rights reserved.</p>
          <div className="flex justify-center gap-4 mt-2">
            <Link to="/" className="hover:text-[#4db6ac]">Home</Link>
            <Link to="/privacy" className="hover:text-[#4db6ac]">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-[#4db6ac]">Terms of Service</Link>
            <Link to="/support" className="hover:text-[#4db6ac]">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Safety;
