import { Link } from "react-router-dom";

const Terms = () => {
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
        <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
        <p className="text-white/60 mb-4">Last updated: January 2026</p>
        <div className="bg-[#4db6ac]/10 border border-[#4db6ac]/30 rounded-lg p-4 mb-8">
          <p className="text-[#4db6ac] font-semibold">Age Rating: 16+</p>
          <p className="text-white/70 text-sm">This app is intended for users aged 16 and older.</p>
        </div>

        <div className="prose prose-invert prose-lg max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">1. Acceptance of Terms</h2>
            <p className="text-white/80 leading-relaxed">
              By accessing or using C-Point ("the Service"), you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">2. Description of Service</h2>
            <p className="text-white/80 leading-relaxed">
              C-Point is a community platform that allows users to create and join communities, share content, 
              communicate with other users, and participate in community activities. The Service is provided 
              "as is" and we reserve the right to modify or discontinue it at any time.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">3. User Accounts</h2>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>You must be at least 16 years old to create an account</li>
              <li>You are responsible for maintaining the security of your account</li>
              <li>You must provide accurate and complete information</li>
              <li>You may not use another person's account without permission</li>
              <li>You are responsible for all activity under your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">4. User Content & Liability</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              You retain ownership of content you post on C-Point. By posting content, you grant us a 
              non-exclusive, worldwide, royalty-free license to use, display, and distribute your content 
              in connection with the Service.
            </p>
            <p className="text-white/80 leading-relaxed mb-4">
              <strong>You are solely responsible for your content and the consequences of posting it.</strong> This 
              includes any legal liability, claims, or damages that may arise from your content.
            </p>
            <p className="text-white/80 leading-relaxed">
              C-Point does not pre-screen, monitor, or endorse user-generated content. We are not responsible 
              for any content posted by users, including content that may be offensive, harmful, inaccurate, 
              or otherwise objectionable.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">5. Prohibited Conduct</h2>
            <p className="text-white/80 leading-relaxed mb-4">You agree not to:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Post illegal, harmful, threatening, abusive, or harassing content</li>
              <li>Impersonate any person or entity</li>
              <li>Post spam, advertisements, or unauthorized promotions</li>
              <li>Upload viruses or malicious code</li>
              <li>Attempt to gain unauthorized access to our systems</li>
              <li>Interfere with or disrupt the Service</li>
              <li>Collect user information without consent</li>
              <li>Use the Service for any illegal purpose</li>
              <li>Post content that infringes intellectual property rights</li>
              <li>Harass, bully, or intimidate other users</li>
              <li>Post sexually explicit content involving minors</li>
              <li>Engage in hate speech or discrimination</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">6. Content Moderation</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We reserve the right to remove any content that violates these Terms or that we find 
              objectionable, without prior notice. We may also suspend or terminate accounts that 
              violate our policies.
            </p>
            <p className="text-white/80 leading-relaxed">
              Users can report inappropriate content using the report feature. We review reports 
              and take appropriate action.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">7. Community Administration & Content Responsibility</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              <strong>Community owners and administrators bear full responsibility for monitoring, moderating, 
              reporting, and managing all content posted within their communities.</strong> This includes but 
              is not limited to: reviewing posts, removing inappropriate content, responding to user reports, 
              enforcing community rules, and taking action against users who violate guidelines.
            </p>
            <p className="text-white/80 leading-relaxed mb-4">
              Community administrators may establish additional rules for their communities, provided they 
              do not conflict with these Terms. By creating or administering a community, you acknowledge 
              and accept this responsibility.
            </p>
            <p className="text-white/80 leading-relaxed font-semibold">
              C-Point is not responsible or liable for any user-generated content, including but not 
              limited to posts, comments, images, videos, polls, or any other content uploaded or shared 
              by users. C-Point acts solely as a platform provider and does not endorse, verify, or 
              assume responsibility for any content created by users or community administrators.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">8. Intellectual Property</h2>
            <p className="text-white/80 leading-relaxed">
              The Service and its original content (excluding user content), features, and functionality 
              are owned by C-Point and are protected by international copyright, trademark, and other 
              intellectual property laws.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">9. Third-Party Links</h2>
            <p className="text-white/80 leading-relaxed">
              The Service may contain links to third-party websites. We are not responsible for the 
              content or practices of these websites. Access them at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">10. Disclaimer of Warranties</h2>
            <p className="text-white/80 leading-relaxed">
              The Service is provided "as is" and "as available" without warranties of any kind, 
              either express or implied. We do not warrant that the Service will be uninterrupted, 
              secure, or error-free.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">11. Limitation of Liability</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              To the maximum extent permitted by law, C-Point shall not be liable for any indirect, 
              incidental, special, consequential, or punitive damages arising from your use of the Service.
            </p>
            <p className="text-white/80 leading-relaxed mb-4">
              Without limiting the foregoing, C-Point shall not be liable for:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Any user-generated content, including posts, comments, images, videos, or other materials uploaded by users</li>
              <li>Any actions taken by community administrators or moderators</li>
              <li>Any disputes between users or between users and community administrators</li>
              <li>Any harm resulting from content posted within communities</li>
              <li>Any failure by community administrators to properly moderate their communities</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">12. Indemnification</h2>
            <p className="text-white/80 leading-relaxed">
              You agree to indemnify and hold harmless C-Point and its officers, directors, employees, 
              and agents from any claims, damages, or expenses arising from your use of the Service 
              or violation of these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">13. Termination</h2>
            <p className="text-white/80 leading-relaxed">
              We may terminate or suspend your account at any time, with or without cause, with or 
              without notice. Upon termination, your right to use the Service will immediately cease.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">14. Changes to Terms</h2>
            <p className="text-white/80 leading-relaxed">
              We reserve the right to modify these Terms at any time. We will notify users of 
              significant changes. Continued use of the Service after changes constitutes acceptance 
              of the new Terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">15. Governing Law</h2>
            <p className="text-white/80 leading-relaxed">
              These Terms shall be governed by and construed in accordance with the laws of the 
              European Union. Any disputes shall be resolved in the courts of the applicable jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">16. Contact Us</h2>
            <p className="text-white/80 leading-relaxed">
              If you have questions about these Terms, please contact us:
            </p>
            <ul className="list-none text-white/80 space-y-2 mt-4">
              <li>Email: <a href="mailto:legal@c-point.co" className="text-[#4db6ac] hover:underline">legal@c-point.co</a></li>
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

export default Terms;
