export default function Head() {
  return (
    <>
      {/* iOS PWA extras */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="apple-mobile-web-app-title" content="Phil's Wage App" />

      {/* This is your splash image in /public */}
      <link rel="apple-touch-startup-image" href="/apple-splash-1290-2796.png" />
    </>
  );
}