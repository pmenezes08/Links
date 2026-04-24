import { Link } from "react-router-dom";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10">
        <div className="container mx-auto px-4 py-4">
          <Link to="/" className="text-2xl font-bold text-[#4db6ac]">
            C-Point
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
        <p className="text-white/60 mb-8">Last updated: April 24, 2026</p>

        <div className="prose prose-invert prose-lg max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">1. Scope and who we are</h2>
            <p className="text-white/80 leading-relaxed">
              This Privacy Policy describes how C-Point (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) collects, uses, stores, and
              shares personal information when you use our websites, mobile applications, and related services
              (collectively, the &quot;Service&quot;). It applies to users worldwide unless a stricter local rule applies
              where you live.
            </p>
            <p className="text-white/80 leading-relaxed mt-4">
              For data protection law, we are typically the <strong>controller</strong> of personal information we decide
              how and why to process. Some vendors we use process data on our behalf as <strong>processors</strong> under
              their own terms; see Section 6.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">2. Information we collect</h2>

            <h3 className="text-xl font-medium mb-3 mt-6">2.1 Account and profile</h3>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Email address, username, display name</li>
              <li>Password (stored using secure hashing; we do not store plaintext passwords)</li>
              <li>Profile photo and other optional profile fields you choose to provide</li>
              <li>Subscription and billing-related identifiers when you pay (handled primarily by our payment provider)</li>
            </ul>

            <h3 className="text-xl font-medium mb-3 mt-6">2.2 Content you create</h3>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Posts, comments, replies, direct messages, and group messages</li>
              <li>Photos, videos, documents, and voice recordings</li>
              <li>Community memberships, reactions, poll votes, events, and similar activity</li>
            </ul>

            <h3 className="text-xl font-medium mb-3 mt-6">2.3 Technical, usage, and device data</h3>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Device type, operating system, app version, and general locale or language settings</li>
              <li>Push notification tokens (e.g. Firebase Cloud Messaging) and, where applicable, web push credentials</li>
              <li>IP address and approximate location derived from it</li>
              <li>Diagnostic, security, and usage logs needed to run and protect the Service</li>
            </ul>

            <h3 className="text-xl font-medium mb-3 mt-6">2.4 AI-related and derived data (Steve and related features)</h3>
            <p className="text-white/80 leading-relaxed mb-4">
              When you use Steve (our in-product assistant), voice features, or related automation, we process:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>
                <strong>Prompts and context</strong> you send or that we attach (for example conversation text, thread or
                community context, @mentions, and similar metadata needed to generate a response).
              </li>
              <li>
                <strong>Voice audio</strong> you submit for transcription, and the resulting transcripts.
              </li>
              <li>
                <strong>Synthesized knowledge and profiling outputs</strong> we build from your activity (for example
                structured profile or community insights stored in our systems) to personalize Steve and related
                features, subject to our access rules between members.
              </li>
              <li>
                <strong>Embeddings</strong> — mathematical representations of text derived from your profile-related
                material — used for similarity search and ranking inside the product.
              </li>
              <li>
                <strong>Usage metering</strong> — technical logs of AI requests (for example which feature ran, token
                estimates, success or failure) for billing caps, fairness, and operations.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">3. How we use information</h2>
            <p className="text-white/80 leading-relaxed mb-4">We use personal information to:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>Provide, operate, secure, and improve the Service</li>
              <li>Create and authenticate accounts; display profiles and content</li>
              <li>Facilitate messaging, communities, notifications, and social features</li>
              <li>
                Operate <strong>Steve</strong> and related AI features: generating replies, summarizing posts or voice
                notes, transcribing audio, building and refreshing profile or network insights, community-assisted
                content suggestions, and semantic search over profiles
              </li>
              <li>Process payments and subscriptions; enforce plan limits and entitlements</li>
              <li>Send transactional or service email and push notifications (according to your settings and applicable law)</li>
              <li>Detect, investigate, and prevent abuse, fraud, and security incidents</li>
              <li>Comply with legal obligations and enforce our Terms</li>
              <li>Analyze aggregated or de-identified usage to understand product performance</li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              We do <strong>not</strong> sell your personal information. We do not use your content to train our own
              foundation models (we do not operate a public model-training business); third-party model providers may
              treat API submissions under their own policies, as described in Section 5.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">4. Legal bases (summary)</h2>
            <p className="text-white/80 leading-relaxed">
              Depending on where you live, we rely on one or more of the following: <strong>performance of a contract</strong>
              (providing the Service you asked for); <strong>legitimate interests</strong> (for example security,
              product improvement, and metering), balanced against your rights; <strong>consent</strong> where we
              expressly ask for it (such as certain marketing or optional analytics, where required); and{' '}
              <strong>legal obligation</strong>. EU users will find more detail in Section 10.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">5. AI providers and how they process data</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We send portions of your content and prompts to third-party AI infrastructure so Steve and related
              features can work. We use:
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-3 ml-4">
              <li>
                <strong>xAI (Grok API)</strong> — large-language-model inference for Steve conversations, knowledge
                synthesis, onboarding assistance, and some community content generation. Documentation and policies
                (including how long they may retain API data and whether they use it to train models) are published by
                xAI; see{' '}
                <a href="https://x.ai/legal/privacy-policy" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  x.ai/legal/privacy-policy
                </a>
                ,{' '}
                <a href="https://x.ai/legal/terms-of-service" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  x.ai/legal/terms-of-service
                </a>
                , and their developer documentation. Business or API-specific terms may apply to your data in addition
                to consumer-facing pages.
              </li>
              <li>
                <strong>OpenAI</strong> — speech-to-text (Whisper) for voice transcription; text summarization in some
                flows; and text embeddings for semantic search. See{' '}
                <a href="https://openai.com/policies/privacy-policy" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  openai.com/policies/privacy-policy
                </a>
                , the{' '}
                <a href="https://openai.com/policies/data-processing-addendum" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  Data Processing Addendum
                </a>{' '}
                (for context on how OpenAI positions API processing), and{' '}
                <a href="https://platform.openai.com/docs/guides/your-data" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  platform documentation on API data
                </a>
                .
              </li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              <strong>No individually negotiated DPAs.</strong> We are not party to a custom enterprise agreement or an
              individually signed data processing addendum with these vendors. Our relationship is governed by their
              standard developer or online terms, which may change. If you need contractual guarantees that only a
              negotiated enterprise agreement can provide, please take that into account before putting sensitive
              personal data into the Service or into Steve.
            </p>
            <p className="text-white/80 leading-relaxed mt-4">
              AI outputs may be inaccurate or incomplete. Do not rely on Steve for medical, legal, financial, or other
              professional advice.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">6. Other service providers (sub-processors)</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              We use additional providers to run the Service. They only receive what they need for their function.
            </p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>
                <strong>Google Cloud Platform</strong> — hosting, databases, and related infrastructure (see{' '}
                <a href="https://cloud.google.com/terms/cloud-privacy-notice" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  Google Cloud privacy notice
                </a>
                ).
              </li>
              <li>
                <strong>Cloudflare</strong> — CDN, security, and (where enabled) R2 object storage for media (see{' '}
                <a href="https://www.cloudflare.com/privacypolicy/" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  Cloudflare privacy policy
                </a>
                ).
              </li>
              <li>
                <strong>Google Firebase</strong> — push delivery via Firebase Cloud Messaging (see{' '}
                <a href="https://firebase.google.com/support/privacy" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  Firebase privacy
                </a>
                ).
              </li>
              <li>
                <strong>Resend</strong> — transactional email (see{' '}
                <a href="https://resend.com/legal/privacy-policy" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  Resend privacy policy
                </a>
                ).
              </li>
              <li>
                <strong>Stripe</strong> — payment processing (see{' '}
                <a href="https://stripe.com/privacy" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  Stripe privacy policy
                </a>
                ).
              </li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              We may add or replace providers as the Service evolves; we will update this Policy for material changes
              where appropriate.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">7. Sharing and disclosure</h2>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>
                <strong>Other users:</strong> Content you post or send is shared according to product visibility (for
                example public posts, community members, or chat participants).
              </li>
              <li>
                <strong>Vendors:</strong> As described in Sections 5 and 6.
              </li>
              <li>
                <strong>Legal and safety:</strong> We may disclose information if required by law, legal process, or
                government request, or if we believe disclosure is necessary to protect rights, safety, or security.
              </li>
              <li>
                <strong>Business transfers:</strong> If we are involved in a merger, acquisition, or asset sale, your
                information may be transferred as part of that transaction, subject to this Policy or equivalent notice.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">8. International transfers</h2>
            <p className="text-white/80 leading-relaxed">
              We may process and store information in the European Economic Area, the United Kingdom, the United States,
              and other countries where we or our providers operate. Those countries may have different data protection
              rules than your home country. Where required, we rely on appropriate safeguards described in our
              providers&apos; terms (which may include Standard Contractual Clauses or similar mechanisms they offer) or
              other lawful transfer tools. Because we do not maintain individually negotiated DPAs with AI vendors (see
              Section 5), EU users should read Section 10 carefully before using AI features with sensitive data.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">9. Retention</h2>
            <p className="text-white/80 leading-relaxed">
              We keep personal information for as long as your account is active, as needed to provide the Service, and
              as required by law. When you delete your account or ask us to delete data, we delete or anonymize it within
              a reasonable period, subject to backup rotation, legal holds, and minimal residual logs. Third-party
              retention (for example AI providers&apos; abuse-monitoring windows) is controlled by their policies, not by
              us.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">10. European Economic Area, United Kingdom, and Switzerland</h2>
            <p className="text-white/80 leading-relaxed mb-4">
              If you are in the EEA, the UK, or Switzerland, the following additional disclosures apply in addition to
              the rest of this Policy.
            </p>

            <h3 className="text-xl font-medium mb-3 mt-6">10.1 Controller and contact</h3>
            <p className="text-white/80 leading-relaxed">
              The controller of your personal data is C-Point. For privacy requests, contact{' '}
              <a href="mailto:privacy@c-point.co" className="text-[#4db6ac] hover:underline">privacy@c-point.co</a>.
            </p>

            <h3 className="text-xl font-medium mb-3 mt-6">10.2 Legal bases in more detail</h3>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li>
                <strong>Contract</strong> — account creation, delivering communities, messaging, Steve when it is part of
                the feature you use, and payments.
              </li>
              <li>
                <strong>Legitimate interests</strong> — security, abuse prevention, product analytics that do not
                override your rights, and (where applicable) limited marketing compatible with law.
              </li>
              <li>
                <strong>Consent</strong> — where we rely on consent (for example optional communications or non-essential
                cookies if we use them), you may withdraw consent at any time without affecting earlier processing.
              </li>
              <li>
                <strong>Legal obligation</strong> — where we must retain or disclose data to comply with the law.
              </li>
            </ul>

            <h3 className="text-xl font-medium mb-3 mt-6">10.3 Profiling and automated decisions</h3>
            <p className="text-white/80 leading-relaxed">
              We use automated processing (including AI) to generate suggestions, summaries, embeddings, and profile
              insights. These outputs can affect what you see in the product (for example suggested connections or
              assistant behavior). They do not, by themselves, produce legal or similarly significant effects on you
              within the meaning of GDPR Article 22 without human involvement; if that changes, we will update this
              Policy.
            </p>

            <h3 className="text-xl font-medium mb-3 mt-6">10.4 Your GDPR and UK GDPR rights</h3>
            <p className="text-white/80 leading-relaxed mb-4">You may have the right to:</p>
            <ul className="list-disc list-inside text-white/80 space-y-2 ml-4">
              <li><strong>Access</strong> — obtain confirmation and a copy of your personal data.</li>
              <li><strong>Rectification</strong> — correct inaccurate data.</li>
              <li><strong>Erasure</strong> — request deletion in certain cases.</li>
              <li><strong>Restriction</strong> — limit how we use your data in certain cases.</li>
              <li><strong>Data portability</strong> — receive structured, machine-readable data you provided, where applicable.</li>
              <li><strong>Object</strong> — object to processing based on legitimate interests or to direct marketing.</li>
              <li>
                <strong>Lodge a complaint</strong> with your local supervisory authority. A list of EU authorities is
                available from the{' '}
                <a href="https://edpb.europa.eu/about-edpb/board/members_en" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  European Data Protection Board
                </a>
                . In the UK, contact the{' '}
                <a href="https://ico.org.uk/" className="text-[#4db6ac] hover:underline" target="_blank" rel="noopener noreferrer">
                  ICO
                </a>
                .
              </li>
            </ul>
            <p className="text-white/80 leading-relaxed mt-4">
              These rights cover <strong>your</strong> personal data — including content you authored, account
              metadata, and AI-derived insights we hold <strong>about you</strong>. They do not entitle you to bulk
              export of other members&apos; messages or full community archives; see{' '}
              <Link to="/terms" className="text-[#4db6ac] hover:underline">Terms of Service</Link> §8.3 for personal vs
              community data.
            </p>
            <p className="text-white/80 leading-relaxed mt-4">
              To exercise your rights, use <strong>Settings → Privacy &amp; Security → Request my data</strong> in the
              app, or email{' '}
              <a href="mailto:privacy@c-point.co" className="text-[#4db6ac] hover:underline">privacy@c-point.co</a> from
              the account concerned. We respond within one month as required by GDPR Article 12; complex requests may be
              extended by two further months with notice.
            </p>

            <h3 className="text-xl font-medium mb-3 mt-6">10.5 Transfers outside the EEA/UK/CH</h3>
            <p className="text-white/80 leading-relaxed">
              When data is transferred to countries not subject to an adequacy decision, we rely on appropriate
              safeguards offered by our providers (such as Standard Contractual Clauses in their online terms, where
              applicable) or other lawful mechanisms. The lack of a separately negotiated DPA with certain AI providers
              may limit the contractual guarantees available to you for that leg of processing; see Section 5.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">11. Other regions (brief)</h2>
            <p className="text-white/80 leading-relaxed">
              If local law grants you additional rights (for example in U.S. states with consumer privacy laws), you may
              contact us at{' '}
              <a href="mailto:privacy@c-point.co" className="text-[#4db6ac] hover:underline">privacy@c-point.co</a>. We
              will respond in line with applicable law. We do not &quot;sell&quot; personal information or &quot;share&quot; it for
              cross-context behavioral advertising as those terms are used in the California Consumer Privacy Act, to the
              extent those concepts apply to our current practices.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">12. Link previews and third-party sites</h2>
            <p className="text-white/80 leading-relaxed">
              When you or another user posts a link, our servers may fetch public metadata (for example Open Graph
              title and description) from that URL to show a preview. That request may reveal the link to the third-party
              site. We do not control third-party sites&apos; privacy practices.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">13. Security</h2>
            <p className="text-white/80 leading-relaxed">
              We implement technical and organizational measures appropriate to the risk. No online service is completely
              secure; we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">14. Children</h2>
            <p className="text-white/80 leading-relaxed">
              The Service is not directed at children under 13 (or the higher minimum age stated in our Terms where you
              live). We do not knowingly collect personal information from children under that age. Contact us if you
              believe we have done so.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">15. Changes</h2>
            <p className="text-white/80 leading-relaxed">
              We may update this Policy from time to time. We will post the new version here and change the &quot;Last
              updated&quot; date. Where required, we will provide additional notice.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-[#4db6ac]">16. Contact</h2>
            <p className="text-white/80 leading-relaxed">
              Questions about this Policy or our data practices:
            </p>
            <ul className="list-none text-white/80 space-y-2 mt-4">
              <li>
                Privacy:{' '}
                <a href="mailto:privacy@c-point.co" className="text-[#4db6ac] hover:underline">privacy@c-point.co</a>
              </li>
              <li>
                Website:{' '}
                <a href="https://www.c-point.co" className="text-[#4db6ac] hover:underline">www.c-point.co</a>
              </li>
            </ul>
          </section>
        </div>
      </main>

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
