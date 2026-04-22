import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bible Search API - ReDoc</title>
    <style>
      html, body { margin: 0; padding: 0; min-height: 100%; }
      #redoc-container { min-height: 100vh; }
    </style>
  </head>
  <body>
    <div id="redoc-container"></div>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script>
    <script>
      window.addEventListener('load', function () {
        if (!window.Redoc || !window.Redoc.init) {
          document.getElementById('redoc-container').innerHTML = 'Failed to load ReDoc bundle.';
          return;
        }

        window.Redoc.init('/openapi.json', {
          hideDownloadButton: false,
          expandResponses: '200,400,404,429,500'
        }, document.getElementById('redoc-container'));
      });
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
