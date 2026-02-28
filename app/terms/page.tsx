import BackButton from "../components/BackButton";

export default function Terms({
  searchParams,
}: {
  searchParams?: { from?: string };
}) {
  const from = searchParams?.from;
  const backTo = from === "landing" ? "/" : from === "settings" ? "/settings" : "/app";

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6 space-y-6 text-sm">
      <BackButton to={backTo} />

      <h1 className="text-2xl font-bold">Terms & Conditions</h1>


      <p className="text-sm text-gray-600 dark:text-white/60">
        Last updated: {new Date().toLocaleDateString()}
      </p>

      <section className="space-y-3 text-sm leading-relaxed">
        <p>
          These Terms & Conditions govern your use of the PayCore application.
          By using the app, you agree to these terms.
        </p>

        <h2 className="font-semibold text-base">1. App purpose</h2>
        <p>
          PayCore is designed to help users estimate worked hours, premiums,
          overtime and pay based on the information entered. The results are
          provided for guidance only and should not be relied upon as a
          substitute for official payroll, employer records, or financial
          advice.
        </p>

        <h2 className="font-semibold text-base">2. Accuracy of information</h2>
        <p>
          You are responsible for ensuring that all data entered into the app is
          correct. PayCore is not responsible for incorrect calculations caused
          by inaccurate or incomplete input.
        </p>

        <h2 className="font-semibold text-base">3. No employment relationship</h2>
        <p>
          PayCore is an independent tool and is not affiliated with any employer,
          payroll provider, union, or government body.
        </p>

        <h2 className="font-semibold text-base">4. Data storage</h2>
        <p>
          Your data is stored locally on your device. PayCore does not transmit,
          store, or have access to your personal shift or pay data on external
          servers.
        </p>

        <h2 className="font-semibold text-base">5. Pro features</h2>
        <p>
          Pro features are unlocked using a valid Pro code. Pro access enables
          additional functionality but does not change how calculations are
          performed. Pro access may be revoked if the app is modified,
          redistributed, or used in a way not intended.
        </p>

        <h2 className="font-semibold text-base">6. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul className="list-disc ml-5 space-y-1">
          <li>Attempt to reverse engineer or copy the app</li>
          <li>Use the app for unlawful purposes</li>
          <li>Distribute modified versions of the app</li>
        </ul>

        <h2 className="font-semibold text-base">7. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, PayCore shall not be liable for
          any loss, including loss of earnings, disputes with employers, tax
          issues, or financial decisions made based on the app’s calculations.
        </p>

        <h2 className="font-semibold text-base">8. Updates</h2>
        <p>
          These terms may be updated from time to time. Continued use of the app
          after changes means you accept the updated terms.
        </p>

        <h2 className="font-semibold text-base">9. Contact</h2>
        <p>
          If you have any questions about these Terms & Conditions, please use
          the Help section within the app.
        </p>
      </section>
    </main>
  );
}