import BackButton from "../components/BackButton";

export default function Privacy() {
  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6 space-y-6 text-sm">
        <BackButton />
      

      <h1 className="text-2xl font-bold">Privacy Policy</h1>

      <p>Last updated: {new Date().getFullYear()}</p>

      <p>
        PayCore is designed to respect and protect your privacy. This
        application does <strong>not collect, store, or transmit any personal
        data</strong>.
      </p>

      <h2 className="text-lg font-semibold">Data Storage</h2>
      <p>
        All shift data, pay calculations, settings, and history are stored
        locally on your device using your browser’s local storage.
      </p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Your data never leaves your device</li>
        <li>No account is required</li>
        <li>No cloud sync is used</li>
        <li>No external database is connected</li>
      </ul>

      <h2 className="text-lg font-semibold">Personal Data</h2>
      <p>
        PayCore does not collect personal information such as your name, email
        address, location, or employer details.
      </p>

      <h2 className="text-lg font-semibold">Tracking & Analytics</h2>
      <p>
        PayCore does not use analytics, tracking tools, advertising cookies, or
        any third-party data collection services.
      </p>

      <h2 className="text-lg font-semibold">Data Control</h2>
      <p>You are in full control of your data at all times.</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Clearing your browser storage will remove all saved data</li>
        <li>Uninstalling the app will permanently delete all stored data</li>
      </ul>

      <h2 className="text-lg font-semibold">Security</h2>
      <p>
        Because all information is stored locally on your device, your data
        remains private and is not accessible by the developer or any third
        party.
      </p>

      <h2 className="text-lg font-semibold">Changes to This Policy</h2>
      <p>
        This policy may be updated in the future if new features are introduced
        that require data processing.
      </p>

      <h2 className="text-lg font-semibold">Contact</h2>
      <p>
        Created by Phil Crompton.  
        If you have any questions about this policy, please contact the
        developer via the official PayCore website or app support page.
      </p>
    </main>
  );
}