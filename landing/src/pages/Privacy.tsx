import { Link } from "react-router-dom";

const Privacy = () => {
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
        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
        <p className="text-white/60 mb-8">Last updated: December 2024</p>

        <div className="prose prose-invert prose-lg max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">1. Introduction</h2>
            <p className="text-white/80 leading-relaxed">
              Welcome to C-Point ("we," "our," or "us"). We are committed to protecting your personal information 
              and your right to privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard 
              your information when you use our mobile application and website (collectively, the "Service").
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">2. Information We Collect</h2>
            
            <h3 className="text-xl font-medium mb-3 mt-6">Personal Information</h3>
            <p className="text-white/80 leading-relaxed mb-4">
              When you register for an account, we collect:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Email address</li>
              <li>Username and display name</li>
              <li>Profile picture (optional)</li>
              <li>Password (encrypted)</li>
            </ul>

            <h3 className="text-xl font-medium mb-3 mt-6">User Content</h3>
            <p className="text-white/80 leading-relaxed mb-4">
              When you use our Service, we collect content you create:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Posts, comments, and messages</li>
              <li>Photos, videos, and voice recordings</li>
              <li>Community memberships and interactions</li>
              <li>Poll responses and event participation</li>
            </ul>

            <h3 className="text-xl font-medium mb-3 mt-6">Automatically Collected Information</h3>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Device information (device type, operating system)</li>
              <li>Push notification tokens</li>
              <li>Usage data and analytics</li>
              <li>IP address</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">3. How We Use Your Information</h2>
            <p className="text-white/80 leading-relaxed mb-4">We use your information to:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Provide, maintain, and improve our Service</li>
              <li>Create and manage your account</li>
              <li>Enable communication between users</li>
              <li>Send push notifications (with your consent)</li>
              <li>Respond to your inquiries and support requests</li>
              <li>Monitor and analyze usage patterns</li>
              <li>Detect and prevent fraud or abuse</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">4. Sharing Your Information</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We do not sell your personal information. We may share your information with:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Other Users:</strong> Your public profile, posts, and community activity are visible to other users</li>
              <li><strong>Service Providers:</strong> Third-party services that help us operate (cloud hosting, email delivery, analytics)</li>
              <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">5. Third-Party Services</h2>
            <p className="text-white/80 leading-relaxed mb-4">We use the following third-party services:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Google Cloud Platform:</strong> Hosting and infrastructure</li>
              <li><strong>Cloudflare:</strong> Content delivery and security</li>
              <li><strong>Firebase:</strong> Push notifications</li>
              <li><strong>Resend:</strong> Email delivery</li>
              <li><strong>OpenAI:</strong> AI features (voice note summaries)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">6. Data Retention</h2>
            <p className="text-white/80 leading-relaxed">
              We retain your information for as long as your account is active or as needed to provide you services. 
              You can request deletion of your account and associated data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">7. Your Rights (GDPR)</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              If you are in the European Economic Area (EEA), you have the following rights:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Rectification:</strong> Request correction of inaccurate data</li>
              <li><strong>Erasure:</strong> Request deletion of your data ("right to be forgotten")</li>
              <li><strong>Portability:</strong> Request transfer of your data</li>
              <li><strong>Restriction:</strong> Request limitation of processing</li>
              <li><strong>Objection:</strong> Object to processing of your data</li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              To exercise these rights, please contact us at <a href="mailto:privacy@c-point.co" className="text-[#4db6ac] hover:underline">privacy@c-point.co</a>
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">8. Data Security</h2>
            <p className="text-white/80 leading-relaxed">
              We implement appropriate technical and organizational measures to protect your personal information. 
              However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">9. Children's Privacy</h2>
            <p className="text-white/80 leading-relaxed">
              Our Service is not intended for children under 13 years of age. We do not knowingly collect 
              personal information from children under 13. If you believe we have collected information from 
              a child under 13, please contact us immediately.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">10. Changes to This Policy</h2>
            <p className="text-white/80 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting 
              the new Privacy Policy on this page and updating the "Last updated" date.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">11. Contact Us</h2>
            <p className="text-white/80 leading-relaxed">
              If you have questions about this Privacy Policy or our data practices, please contact us:
            </p>
            <ul className="list-none text-white/80 space-y-2 mt-4">
              <li>Email: <a href="mailto:privacy@c-point.co" className="text-[#4db6ac] hover:underline">privacy@c-point.co</a></li>
              <li>Website: <a href="https://www.c-point.co" className="text-[#4db6ac] hover:underline">www.c-point.co</a></li>
            </ul>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-white/60">
          <p>© {new Date().getFullYear()} C-Point. All rights reserved.</p>
          <div className="flex justify-center gap-6 mt-4">
            <Link to="/privacy" className="hover:text-[#4db6ac]">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-[#4db6ac]">Terms of Service</Link>
            <Link to="/support" className="hover:text-[#4db6ac]">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Privacy;
