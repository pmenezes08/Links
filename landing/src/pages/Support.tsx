import { Link } from "react-router-dom";
import { useState } from "react";

const Support = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In production, this would send to your backend
    const mailtoLink = `mailto:support@c-point.co?subject=${encodeURIComponent(formData.subject)}&body=${encodeURIComponent(`Name: ${formData.name}\nEmail: ${formData.email}\n\n${formData.message}`)}`;
    window.location.href = mailtoLink;
    setSubmitted(true);
  };

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
        <h1 className="text-4xl font-bold mb-4">Support</h1>
        <p className="text-white/60 mb-12">We're here to help. Get in touch with us.</p>

        <div className="grid md:grid-cols-2 gap-12">
          {/* Contact Information */}
          <div>
            <h2 className="text-2xl font-semibold mb-6 text-[#4db6ac]">Contact Us</h2>
            
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[#4db6ac]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium mb-1">Email Support</h3>
                  <a href="mailto:support@c-point.co" className="text-[#4db6ac] hover:underline">
                    support@c-point.co
                  </a>
                  <p className="text-white/60 text-sm mt-1">We typically respond within 24 hours</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[#4db6ac]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium mb-1">FAQ</h3>
                  <p className="text-white/60 text-sm">Check our frequently asked questions below</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[#4db6ac]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium mb-1">App Issues</h3>
                  <p className="text-white/60 text-sm">
                    For technical issues with the iOS app, please include your device model and iOS version
                  </p>
                </div>
              </div>
            </div>

            {/* FAQ Section */}
            <div className="mt-12">
              <h2 className="text-2xl font-semibold mb-6 text-[#4db6ac]">Frequently Asked Questions</h2>
              
              <div className="space-y-4">
                <details className="group bg-white/5 rounded-lg">
                  <summary className="flex justify-between items-center cursor-pointer p-4 font-medium">
                    How do I create a community?
                    <span className="text-[#4db6ac] group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="px-4 pb-4 text-white/70">
                    Tap the "+" button on the Communities tab, fill in your community details, 
                    and invite members using the QR code or share link.
                  </div>
                </details>

                <details className="group bg-white/5 rounded-lg">
                  <summary className="flex justify-between items-center cursor-pointer p-4 font-medium">
                    How do I delete my account?
                    <span className="text-[#4db6ac] group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="px-4 pb-4 text-white/70">
                    Go to Settings → Account → Delete Account. This will permanently delete 
                    your account and all associated data. This action cannot be undone.
                  </div>
                </details>

                <details className="group bg-white/5 rounded-lg">
                  <summary className="flex justify-between items-center cursor-pointer p-4 font-medium">
                    How do I report inappropriate content?
                    <span className="text-[#4db6ac] group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="px-4 pb-4 text-white/70">
                    Long-press on any post or message and select "Report" from the menu. 
                    Our team reviews all reports within 24 hours.
                  </div>
                </details>

                <details className="group bg-white/5 rounded-lg">
                  <summary className="flex justify-between items-center cursor-pointer p-4 font-medium">
                    Why am I not receiving notifications?
                    <span className="text-[#4db6ac] group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="px-4 pb-4 text-white/70">
                    Make sure notifications are enabled in your iPhone Settings → C-Point → Notifications. 
                    Also check that Do Not Disturb is turned off.
                  </div>
                </details>

                <details className="group bg-white/5 rounded-lg">
                  <summary className="flex justify-between items-center cursor-pointer p-4 font-medium">
                    How do I change my username?
                    <span className="text-[#4db6ac] group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="px-4 pb-4 text-white/70">
                    Go to your Profile → Edit Profile → tap on your username to change it. 
                    Note: Usernames must be unique.
                  </div>
                </details>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div>
            <h2 className="text-2xl font-semibold mb-6 text-[#4db6ac]">Send us a Message</h2>
            
            {submitted ? (
              <div className="bg-[#4db6ac]/20 border border-[#4db6ac]/30 rounded-lg p-6 text-center">
                <svg className="w-12 h-12 text-[#4db6ac] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <h3 className="text-xl font-medium mb-2">Message Sent!</h3>
                <p className="text-white/70">We'll get back to you as soon as possible.</p>
                <button 
                  onClick={() => setSubmitted(false)}
                  className="mt-4 text-[#4db6ac] hover:underline"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium mb-2">Name</label>
                  <input
                    type="text"
                    id="name"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-[#4db6ac] transition-colors"
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-2">Email</label>
                  <input
                    type="email"
                    id="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-[#4db6ac] transition-colors"
                    placeholder="your@email.com"
                  />
                </div>

                <div>
                  <label htmlFor="subject" className="block text-sm font-medium mb-2">Subject</label>
                  <select
                    id="subject"
                    required
                    value={formData.subject}
                    onChange={(e) => setFormData({...formData, subject: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-[#4db6ac] transition-colors"
                  >
                    <option value="">Select a topic</option>
                    <option value="Technical Issue">Technical Issue</option>
                    <option value="Account Help">Account Help</option>
                    <option value="Report Content">Report Content</option>
                    <option value="Feature Request">Feature Request</option>
                    <option value="Privacy Concern">Privacy Concern</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="message" className="block text-sm font-medium mb-2">Message</label>
                  <textarea
                    id="message"
                    required
                    rows={5}
                    value={formData.message}
                    onChange={(e) => setFormData({...formData, message: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-[#4db6ac] transition-colors resize-none"
                    placeholder="Describe your issue or question..."
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-[#4db6ac] text-black font-medium py-3 rounded-lg hover:bg-[#45a99c] transition-colors"
                >
                  Send Message
                </button>
              </form>
            )}
          </div>
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

export default Support;
