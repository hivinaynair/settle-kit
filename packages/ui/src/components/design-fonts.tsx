/** Load once in the host layout; typography tokens live in globals.css. */
export function DesignFonts() {
  return (
    <link
      rel="stylesheet"
      href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap"
    />
  );
}
